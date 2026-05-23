/**
 * Smoke: paid Stripe webhook upgrades a user's tier and dedupes on replay.
 *
 * Exercises the full /api/stripe/webhook path against real signature
 * verification (the harness signs with the same secret the server checks),
 * the stripe_events idempotency table, and the per-user tier write.
 *
 * No LLM involvement.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import { eq } from "drizzle-orm";
import { E2EHarness } from "../harness/index.js";
import { seedUser, reloadUser } from "../harness/builders.js";
import { getDb } from "../../../src/db/client.js";
import { users } from "../../../src/db/schema.js";
import { __resetStripeCache } from "../../../src/handlers/stripe.js";

describe("e2e smoke / stripe webhook (paid)", () => {
  let env: E2EHarness;
  const ORIG_STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  const ORIG_PRICE_ATHLETE = process.env.STRIPE_PRICE_ATHLETE;

  beforeAll(async () => {
    // Configure Stripe BEFORE booting the harness so isStripeConfigured() returns
    // true at request time. Any dummy key works — we don't hit Stripe's API,
    // only run constructEvent locally against our test webhook secret.
    process.env.STRIPE_SECRET_KEY = "sk_test_e2e_smoke";
    process.env.STRIPE_PRICE_ATHLETE = "price_athlete";
    __resetStripeCache();
    env = await E2EHarness.start();
  });

  afterAll(async () => {
    await env.stop();
    if (ORIG_STRIPE_KEY === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = ORIG_STRIPE_KEY;
    if (ORIG_PRICE_ATHLETE === undefined) delete process.env.STRIPE_PRICE_ATHLETE;
    else process.env.STRIPE_PRICE_ATHLETE = ORIG_PRICE_ATHLETE;
    __resetStripeCache();
  });

  beforeEach(async () => {
    await env.beforeEach();
  });

  it("upgrades the user to athlete and dedupes a replayed event id", async () => {
    const user = await seedUser({
      phoneE164: "+15555550100",
      tier: "trial",
    });
    const db = getDb();
    await db
      .update(users)
      .set({ stripeCustomerId: "cus_test_paid" })
      .where(eq(users.id, user.id));

    const eventId = "evt_smoke_paid_1";
    const created = 1_700_000_000;
    const subscriptionData = {
      id: "sub_test",
      customer: "cus_test_paid",
      status: "active",
      items: { data: [{ price: { id: "price_athlete" } }] },
    };

    const first = await env.sendStripeWebhook({
      type: "customer.subscription.created",
      id: eventId,
      created,
      data: subscriptionData,
    });
    expect(first.status).toBe(200);

    const afterUpgrade = await reloadUser(user.id);
    expect(afterUpgrade.tier).toBe("athlete");

    // Force the tier to "regular" so we can detect whether a replay re-writes
    // it. The idempotency table should short-circuit the replay and leave
    // the tier alone.
    await db.update(users).set({ tier: "regular" }).where(eq(users.id, user.id));

    const replay = await env.sendStripeWebhook({
      type: "customer.subscription.created",
      id: eventId,
      created,
      data: subscriptionData,
    });
    expect(replay.status).toBe(200);

    const afterReplay = await reloadUser(user.id);
    expect(afterReplay.tier).toBe("regular");
  });
});
