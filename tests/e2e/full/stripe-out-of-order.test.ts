/**
 * Full e2e — Stripe out-of-order delivery.
 *
 * Stripe doesn't guarantee delivery order. The handler tracks the largest
 * `event.created` epoch we've applied per user (`stripe_last_event_epoch`)
 * and skips any incoming event whose epoch is <= that watermark.
 *
 * Scenario:
 *   1. Send a "regular" subscription.created with epoch=2_000_000_000.
 *      Tier becomes regular, watermark = 2_000_000_000.
 *   2. Send a (delayed, out-of-order) subscription.deleted with
 *      epoch=1_999_999_000. The handler must skip it.
 *   3. Tier stays "regular", watermark unchanged.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import { eq } from "drizzle-orm";

process.env.STRIPE_SECRET_KEY ??= "sk_test_e2e";
process.env.STRIPE_PRICE_REGULAR ??= "price_e2e_regular";
process.env.STRIPE_PRICE_ATHLETE ??= "price_e2e_athlete";

import { E2EHarness } from "../harness/index.js";
import { seedUser, reloadUser } from "../harness/builders.js";
import { getDb } from "../../../src/db/client.js";
import { users } from "../../../src/db/schema.js";

describe("e2e full / stripe out-of-order delivery", () => {
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

  it("ignores a stale delete arriving after a newer create", async () => {
    const user = await seedUser({ displayName: "OOOAthlete", tier: "trial" });
    const db = getDb();
    const customerId = "cus_e2e_ooo";
    await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, user.id));

    // 1. Newer event arrives first — sets tier=regular, epoch=2_000_000_000.
    const r1 = await env.sendStripeWebhook({
      id: "evt_ooo_create",
      type: "customer.subscription.created",
      created: 2_000_000_000,
      data: {
        id: "sub_ooo",
        customer: customerId,
        status: "active",
        items: { data: [{ price: { id: process.env.STRIPE_PRICE_REGULAR } }] },
      },
    });
    expect(r1.status).toBe(200);

    let after = await reloadUser(user.id);
    expect(after.tier).toBe("regular");
    expect(after.stripeLastEventEpoch).toBe(2_000_000_000);

    // 2. Older subscription.deleted arrives second — must be skipped.
    const r2 = await env.sendStripeWebhook({
      id: "evt_ooo_delete_stale",
      type: "customer.subscription.deleted",
      created: 1_999_999_000,
      data: {
        id: "sub_ooo",
        customer: customerId,
        status: "canceled",
        items: { data: [] },
      },
    });
    expect(r2.status).toBe(200);

    after = await reloadUser(user.id);
    expect(after.tier).toBe("regular");
    expect(after.stripeLastEventEpoch).toBe(2_000_000_000);
  });
});
