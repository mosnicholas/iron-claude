/**
 * Stripe webhook + helpers.
 *
 * Events handled:
 *   - customer.subscription.created
 *   - customer.subscription.updated
 *   - customer.subscription.deleted
 *   - checkout.session.completed
 *
 * Tier mapping: STRIPE_PRICE_REGULAR / STRIPE_PRICE_ATHLETE env vars map
 * Stripe price IDs to our local tier names.
 *
 * Override semantics: if a user has `tier_overridden_by_admin = true` (set by
 * scripts/grant-tier.ts), the webhook silently skips the update. Comped users
 * never get downgraded by Stripe.
 *
 * Disabled-state: when STRIPE_SECRET_KEY isn't set, the route returns 503 so
 * self-hosters who don't want billing can still run the rest of the app.
 */

import type { Request, RequestHandler } from "express";
import { and, eq, lt } from "drizzle-orm";
import Stripe from "stripe";
import { getDb } from "../db/client.js";
import { stripeEvents, users } from "../db/schema.js";
import type { Tier } from "../auth/tiers.js";

let cachedStripe: Stripe | null = null;

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function getStripe(): Stripe {
  if (!cachedStripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY is not set");
    }
    cachedStripe = new Stripe(key);
  }
  return cachedStripe;
}

/** Test-only: reset the cached Stripe client so env changes take effect. */
export function __resetStripeCache(): void {
  cachedStripe = null;
}

/** Test-only: inject a Stripe-shaped client (must implement `webhooks.constructEvent`). */
export function __setStripeForTests(client: Stripe | null): void {
  cachedStripe = client;
}

/**
 * Map a Stripe price_id to our local tier. Unknown prices return `null` so the
 * caller can decide whether to ignore or log.
 */
function tierFromPriceId(priceId: string | null | undefined): Tier | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_REGULAR) return "regular";
  if (priceId === process.env.STRIPE_PRICE_ATHLETE) return "athlete";
  return null;
}

/**
 * Update a user's tier from a Stripe event. Honors the
 * `tier_overridden_by_admin` flag (comped users are never downgraded).
 *
 * Reorder guard (option B from the bug report): each user tracks the largest
 * `event.created` epoch we've already applied. If an incoming event's epoch
 * is <= the stored value, it's stale (Stripe doesn't guarantee delivery
 * order) and we skip — this prevents a delayed `customer.subscription.deleted`
 * from clobbering a more recent `customer.subscription.created`. The tier
 * write and epoch bump happen in a single UPDATE with a WHERE clause that
 * also re-checks the epoch, so concurrent webhooks can't race past us.
 */
async function applyTierFromStripe(
  customerId: string,
  newTier: Tier | "expired" | null,
  subscriptionId: string | null,
  eventCreatedEpoch: number
): Promise<void> {
  if (!customerId) return;
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.stripeCustomerId, customerId)).limit(1);
  const user = rows[0];
  if (!user) {
    console.warn(`[stripe] no user for customer ${customerId}; ignoring`);
    return;
  }
  if (user.tierOverriddenByAdmin) {
    console.log(
      `[stripe] user ${user.id} has admin tier override (tier=${user.tier}); ignoring Stripe update`
    );
    return;
  }
  if (eventCreatedEpoch <= user.stripeLastEventEpoch) {
    console.log(
      `[stripe] out-of-order event for user=${user.id} (event=${eventCreatedEpoch} <= last=${user.stripeLastEventEpoch}); skipping`
    );
    return;
  }
  if (!newTier) {
    // Unknown price → no-op rather than guessing.
    console.warn(`[stripe] could not derive tier for customer ${customerId}; skipping`);
    return;
  }
  // Atomic compare-and-set on stripe_last_event_epoch: only writes if the
  // stored epoch is still strictly less than the incoming event's. Guards
  // against a concurrent webhook winning the race between our SELECT above
  // and this UPDATE.
  await db
    .update(users)
    .set({
      tier: newTier,
      stripeSubscriptionId: subscriptionId,
      stripeLastEventEpoch: eventCreatedEpoch,
      updatedAt: new Date(),
    })
    .where(and(eq(users.id, user.id), lt(users.stripeLastEventEpoch, eventCreatedEpoch)));
  console.log(`[stripe] user=${user.id} tier=${newTier} sub=${subscriptionId ?? "none"}`);
}

function deriveTierFromSubscription(sub: Stripe.Subscription): Tier | null {
  // A subscription can carry multiple items but for our flat-pricing setup we
  // pick the first one. `status` filters out incomplete / canceled.
  const item = sub.items?.data?.[0];
  const priceId = item?.price?.id ?? null;
  if (sub.status === "canceled" || sub.status === "unpaid" || sub.status === "incomplete_expired") {
    return null;
  }
  return tierFromPriceId(priceId);
}

/**
 * Bind a Stripe customer to a user (used by checkout.session.completed). If
 * the customer is already bound we just refresh the subscription_id.
 */
async function bindCustomerToUser(
  userId: string,
  customerId: string,
  subscriptionId: string | null
): Promise<void> {
  const db = getDb();
  await db
    .update(users)
    .set({
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

export const stripeWebhookHandler: RequestHandler = async (req: Request, res) => {
  if (!isStripeConfigured()) {
    res.status(503).json({ ok: false, error: "stripe not configured" });
    return;
  }
  const sig = req.headers["stripe-signature"];
  if (typeof sig !== "string") {
    res.status(400).json({ ok: false, error: "missing stripe-signature header" });
    return;
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    res.status(503).json({ ok: false, error: "STRIPE_WEBHOOK_SECRET not set" });
    return;
  }

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    // `express.raw` makes req.body a Buffer on this route.
    event = stripe.webhooks.constructEvent(req.body as Buffer, sig, secret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[stripe] signature verification failed:", msg);
    res.status(400).json({ ok: false, error: `webhook signature failed: ${msg}` });
    return;
  }

  // Idempotency guard: Stripe delivers at-least-once. Record event.id in
  // `stripe_events` with ON CONFLICT DO NOTHING; if no row comes back, this
  // event has already been processed and we short-circuit with 200.
  try {
    const db = getDb();
    const inserted = await db
      .insert(stripeEvents)
      .values({
        id: event.id,
        type: event.type,
        createdEpoch: event.created,
      })
      .onConflictDoNothing({ target: stripeEvents.id })
      .returning({ id: stripeEvents.id });
    if (inserted.length === 0) {
      console.log(`[stripe] duplicate event ${event.id}, skipping`);
      res.json({ received: true });
      return;
    }
  } catch (err) {
    console.error(`[stripe] idempotency insert failed for ${event.id}:`, err);
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    return;
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const tier = deriveTierFromSubscription(sub);
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        await applyTierFromStripe(customerId, tier, sub.id, event.created);
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        // On cancellation, revert to "expired" so the gate kicks in. We don't
        // flip back to "trial" — the trial is one-shot at signup.
        await applyTierFromStripe(customerId, "expired", null, event.created);
        break;
      }
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.user_id;
        const customerId = typeof session.customer === "string" ? session.customer : null;
        const subscriptionId =
          typeof session.subscription === "string" ? session.subscription : null;
        if (userId && customerId) {
          await bindCustomerToUser(userId, customerId, subscriptionId);
        } else {
          console.warn(
            `[stripe] checkout.session.completed missing userId or customer (session=${session.id})`
          );
        }
        break;
      }
      default:
        // Other events (invoice.*, etc.) are accepted but not acted on.
        console.log(`[stripe] ignoring event ${event.type}`);
    }
    res.json({ received: true });
  } catch (err) {
    console.error(`[stripe] handler error for ${event.type}:`, err);
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
