/**
 * Full e2e — Stripe replay attack / idempotency guard.
 *
 * Stripe delivers at-least-once. If we replay the same event.id after a
 * manual DB tweak, the second delivery MUST NOT re-execute the handler logic
 * (or our handler would clobber legitimate state on every retry).
 *
 * Scenario:
 *   1. Send evt_attack (subscription.created → athlete). Tier set.
 *   2. Manually downgrade the user back to "trial" in the DB.
 *   3. Replay evt_attack with the SAME id. The handler must short-circuit on
 *      the unique-id insert and leave tier="trial".
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import { eq } from "drizzle-orm";

process.env.STRIPE_SECRET_KEY ??= "sk_test_e2e";
process.env.STRIPE_PRICE_REGULAR ??= "price_e2e_regular";
process.env.STRIPE_PRICE_ATHLETE ??= "price_e2e_athlete";

import { E2EHarness } from "../harness/index.js";
import { seedUser, reloadUser } from "../harness/builders.js";
import { getDb } from "../../../src/db/client.js";
import { users, stripeEvents } from "../../../src/db/schema.js";

describe("e2e full / stripe replay attack", () => {
  let env: E2EHarness;

  beforeAll(async () => {
    env = await E2EHarness.start();
  });

  afterAll(async () => {
    await env.stop();
  });

  beforeEach(async () => {
    await env.beforeEach();
  });

  it("ignores a replayed event id, preserving the manually-downgraded tier", async () => {
    const user = await seedUser({ displayName: "ReplayAthlete", tier: "trial" });
    const db = getDb();
    const customerId = "cus_e2e_replay";
    await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, user.id));

    const eventPayload = {
      id: "evt_attack",
      type: "customer.subscription.created",
      created: 1_900_500_000,
      data: {
        id: "sub_replay_1",
        customer: customerId,
        status: "active" as const,
        items: { data: [{ price: { id: process.env.STRIPE_PRICE_ATHLETE } }] },
      },
    };

    // 1. First delivery — tier flips to athlete.
    const r1 = await env.sendStripeWebhook(eventPayload);
    expect(r1.status).toBe(200);
    let after = await reloadUser(user.id);
    expect(after.tier).toBe("athlete");

    // 2. Operator downgrades the user manually (simulating a refund flow,
    //    fraud cleanup, whatever).
    await db.update(users).set({ tier: "trial" }).where(eq(users.id, user.id));
    after = await reloadUser(user.id);
    expect(after.tier).toBe("trial");

    // 3. Replay the SAME event.id. The handler must short-circuit on the
    //    stripe_events idempotency insert and leave tier="trial".
    const r2 = await env.sendStripeWebhook(eventPayload);
    expect(r2.status).toBe(200);

    after = await reloadUser(user.id);
    expect(after.tier).toBe("trial");

    // Only ONE row should exist in stripe_events for this id — the second
    // insert hit ON CONFLICT DO NOTHING.
    const rows = await db.select().from(stripeEvents).where(eq(stripeEvents.id, "evt_attack"));
    expect(rows.length).toBe(1);
  });
});
