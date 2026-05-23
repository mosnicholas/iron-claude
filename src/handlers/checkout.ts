/**
 * Stripe Checkout — create a Checkout Session for the current user.
 *
 * Gated by `requireSession`. Body: `{ tier: "regular" | "athlete" }`. Returns
 * the Stripe-hosted checkout URL; the client redirects there. On success
 * Stripe POSTs `checkout.session.completed` to our webhook which binds the
 * customer/subscription ids to the user.
 */

import type { RequestHandler } from "express";
import { getStripe, isStripeConfigured } from "./stripe.js";

type CheckoutTier = "regular" | "athlete";

function priceForTier(tier: CheckoutTier): string | null {
  if (tier === "regular") return process.env.STRIPE_PRICE_REGULAR ?? null;
  if (tier === "athlete") return process.env.STRIPE_PRICE_ATHLETE ?? null;
  return null;
}

function checkoutSuccessUrl(): string {
  return process.env.STRIPE_SUCCESS_URL ?? "https://ironclaude.app/billing/success";
}

function checkoutCancelUrl(): string {
  return process.env.STRIPE_CANCEL_URL ?? "https://ironclaude.app/billing/cancel";
}

export const createCheckoutSessionHandler: RequestHandler = async (req, res) => {
  if (!isStripeConfigured()) {
    res.status(503).json({ ok: false, error: "stripe not configured" });
    return;
  }
  const user = req.user;
  if (!user) {
    res.status(401).json({ ok: false, error: "not authenticated" });
    return;
  }
  const tier = req.body?.tier as CheckoutTier | undefined;
  if (tier !== "regular" && tier !== "athlete") {
    res.status(400).json({ ok: false, error: "tier must be 'regular' or 'athlete'" });
    return;
  }
  const price = priceForTier(tier);
  if (!price) {
    res.status(503).json({ ok: false, error: `no Stripe price configured for tier=${tier}` });
    return;
  }

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price, quantity: 1 }],
      // Use phone as a hint only if it looks like a real E.164 number (skip
      // the synthetic +pending:... placeholders Telegram-first users get).
      customer_email: user.phoneE164.startsWith("+pending:") ? undefined : undefined,
      // Stripe doesn't accept phone as `customer_email`; the user_id in
      // metadata is what the webhook uses to bind the customer to our row.
      metadata: { user_id: user.id, tier },
      success_url: checkoutSuccessUrl(),
      cancel_url: checkoutCancelUrl(),
    });

    res.json({ ok: true, url: session.url });
  } catch (err) {
    console.error("[checkout] create session error:", err);
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
