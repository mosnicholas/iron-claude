/**
 * Stripe webhook integration tests.
 *
 * - 503 when STRIPE_SECRET_KEY is unset
 * - 400 when the stripe-signature header is missing
 * - 400 when constructEvent rejects (we mock the SDK to throw)
 * - 200 + tier update on customer.subscription.created
 * - admin override blocks tier downgrade
 */

import { eq } from "drizzle-orm";
import type { Request } from "express";
import type Stripe from "stripe";
import { createMemDb, getMemDb, seedUser } from "../helpers/realpg.js";
import { getDb } from "../../src/db/client.js";
import { users } from "../../src/db/schema.js";
import {
  stripeWebhookHandler,
  __resetStripeCache,
  __setStripeForTests,
} from "../../src/handlers/stripe.js";

interface FakeRes {
  statusCode: number;
  jsonBody: unknown;
  status(code: number): FakeRes;
  json(body: unknown): FakeRes;
}

function mkRes(): FakeRes {
  const r: FakeRes = {
    statusCode: 200,
    jsonBody: undefined,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.jsonBody = b;
      return this;
    },
  };
  return r;
}

async function call(req: Partial<Request>, res: FakeRes): Promise<void> {
  await (stripeWebhookHandler as unknown as (
    req: Partial<Request>,
    res: unknown,
    next: () => void
  ) => Promise<void> | void)(req, res as unknown, () => undefined);
}

describe("POST /api/stripe/webhook", () => {
  const ORIG_ENV = { ...process.env };

  beforeAll(() => {
    createMemDb();
  });
  afterAll(async () => {
    process.env = ORIG_ENV;
    __resetStripeCache();
    await getMemDb().close();
  });

  beforeEach(async () => {
    await getMemDb().reset();
    __resetStripeCache();
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_PRICE_REGULAR;
    delete process.env.STRIPE_PRICE_ATHLETE;
  });

  it("returns 503 when Stripe is not configured", async () => {
    const res = mkRes();
    await call(
      {
        headers: { "stripe-signature": "t=0,v1=fake" },
        body: Buffer.from("{}"),
      } as Partial<Request>,
      res
    );
    expect(res.statusCode).toBe(503);
  });

  it("returns 400 when stripe-signature header is missing", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
    const res = mkRes();
    await call(
      {
        headers: {},
        body: Buffer.from("{}"),
      } as Partial<Request>,
      res
    );
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when signature verification fails", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";

    __setStripeForTests({
      webhooks: {
        constructEvent: () => {
          throw new Error("bad signature");
        },
      },
    } as unknown as Stripe);

    const res = mkRes();
    await call(
      {
        headers: { "stripe-signature": "t=0,v1=fake" },
        body: Buffer.from("{}"),
      } as Partial<Request>,
      res
    );
    expect(res.statusCode).toBe(400);
    expect((res.jsonBody as { error: string }).error).toMatch(/webhook signature failed/i);
  });

  it("upgrades tier to 'regular' on customer.subscription.created", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
    process.env.STRIPE_PRICE_REGULAR = "price_reg_xyz";

    const userId = await seedUser({ phoneE164: "+15555550199" });
    const db = getDb();
    await db
      .update(users)
      .set({ stripeCustomerId: "cus_test_1" })
      .where(eq(users.id, userId));

    const fakeEvent = {
      id: "evt_created_1",
      created: 1_700_000_000,
      type: "customer.subscription.created",
      data: {
        object: {
          id: "sub_1",
          customer: "cus_test_1",
          status: "active",
          items: { data: [{ price: { id: "price_reg_xyz" } }] },
        },
      },
    } as unknown as Stripe.Event;

    __setStripeForTests({
      webhooks: {
        constructEvent: () => fakeEvent,
      },
    } as unknown as Stripe);

    const res = mkRes();
    await call(
      {
        headers: { "stripe-signature": "t=0,v1=fake" },
        body: Buffer.from("{}"),
      } as Partial<Request>,
      res
    );

    expect(res.statusCode).toBe(200);
    const after = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    expect(after[0].tier).toBe("regular");
    expect(after[0].stripeSubscriptionId).toBe("sub_1");
  });

  it("does NOT downgrade a tier_overridden_by_admin user", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";

    const userId = await seedUser({ phoneE164: "+15555550144" });
    const db = getDb();
    await db
      .update(users)
      .set({
        stripeCustomerId: "cus_admin_1",
        tier: "comped",
        tierOverriddenByAdmin: true,
      })
      .where(eq(users.id, userId));

    const fakeEvent = {
      id: "evt_admin_del_1",
      created: 1_700_000_500,
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_dead",
          customer: "cus_admin_1",
          status: "canceled",
          items: { data: [] },
        },
      },
    } as unknown as Stripe.Event;

    __setStripeForTests({
      webhooks: {
        constructEvent: () => fakeEvent,
      },
    } as unknown as Stripe);

    const res = mkRes();
    await call(
      {
        headers: { "stripe-signature": "t=0,v1=fake" },
        body: Buffer.from("{}"),
      } as Partial<Request>,
      res
    );

    expect(res.statusCode).toBe(200);
    const after = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    // Comped status preserved despite the cancellation event.
    expect(after[0].tier).toBe("comped");
  });

  it("dedupes a duplicate event_id (replayed delivery is a no-op)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
    process.env.STRIPE_PRICE_REGULAR = "price_reg_xyz";
    process.env.STRIPE_PRICE_ATHLETE = "price_ath_xyz";

    const userId = await seedUser({ phoneE164: "+15555550175" });
    const db = getDb();
    await db
      .update(users)
      .set({ stripeCustomerId: "cus_dup_1" })
      .where(eq(users.id, userId));

    // First event: regular tier at epoch 1_700_000_000.
    const firstEvent = {
      id: "evt_dup_1",
      created: 1_700_000_000,
      type: "customer.subscription.created",
      data: {
        object: {
          id: "sub_dup_1",
          customer: "cus_dup_1",
          status: "active",
          items: { data: [{ price: { id: "price_reg_xyz" } }] },
        },
      },
    } as unknown as Stripe.Event;

    __setStripeForTests({
      webhooks: { constructEvent: () => firstEvent },
    } as unknown as Stripe);

    let res = mkRes();
    await call(
      {
        headers: { "stripe-signature": "t=0,v1=fake" },
        body: Buffer.from("{}"),
      } as Partial<Request>,
      res
    );
    expect(res.statusCode).toBe(200);
    const afterFirst = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    expect(afterFirst[0].tier).toBe("regular");
    expect(afterFirst[0].stripeLastEventEpoch).toBe(1_700_000_000);

    // Manually flip the tier to "athlete" so we can detect if a replay
    // overwrites it. The replay should NOT touch this row.
    await db.update(users).set({ tier: "athlete" }).where(eq(users.id, userId));

    // Replay the SAME event id (Stripe's at-least-once delivery semantics).
    res = mkRes();
    await call(
      {
        headers: { "stripe-signature": "t=0,v1=fake" },
        body: Buffer.from("{}"),
      } as Partial<Request>,
      res
    );
    expect(res.statusCode).toBe(200);
    const afterReplay = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    // Our hand-set "athlete" tier survives — the replay short-circuited on
    // the stripe_events idempotency table and never reran applyTierFromStripe.
    expect(afterReplay[0].tier).toBe("athlete");
  });

  it("ignores an out-of-order 'deleted' that arrives before a newer 'created'", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
    process.env.STRIPE_PRICE_REGULAR = "price_reg_xyz";

    const userId = await seedUser({ phoneE164: "+15555550188" });
    const db = getDb();
    await db
      .update(users)
      .set({ stripeCustomerId: "cus_reorder_1" })
      .where(eq(users.id, userId));

    // Process the newer "created" first (epoch 2_000_000_000) — user is paid.
    const createdEvent = {
      id: "evt_reorder_created",
      created: 2_000_000_000,
      type: "customer.subscription.created",
      data: {
        object: {
          id: "sub_reorder_1",
          customer: "cus_reorder_1",
          status: "active",
          items: { data: [{ price: { id: "price_reg_xyz" } }] },
        },
      },
    } as unknown as Stripe.Event;

    __setStripeForTests({
      webhooks: { constructEvent: () => createdEvent },
    } as unknown as Stripe);

    let res = mkRes();
    await call(
      {
        headers: { "stripe-signature": "t=0,v1=fake" },
        body: Buffer.from("{}"),
      } as Partial<Request>,
      res
    );
    expect(res.statusCode).toBe(200);
    const afterCreated = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    expect(afterCreated[0].tier).toBe("regular");

    // Now an older "deleted" arrives late (epoch 1_999_999_000 — earlier than
    // the created we already applied). This is the exact bug we're guarding
    // against: a delayed cancellation must NOT downgrade the paying user.
    const lateDeletedEvent = {
      id: "evt_reorder_deleted",
      created: 1_999_999_000,
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_reorder_old",
          customer: "cus_reorder_1",
          status: "canceled",
          items: { data: [] },
        },
      },
    } as unknown as Stripe.Event;

    __setStripeForTests({
      webhooks: { constructEvent: () => lateDeletedEvent },
    } as unknown as Stripe);

    res = mkRes();
    await call(
      {
        headers: { "stripe-signature": "t=0,v1=fake" },
        body: Buffer.from("{}"),
      } as Partial<Request>,
      res
    );
    expect(res.statusCode).toBe(200);
    const afterLateDelete = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    // Tier still "regular" — the older event was rejected by the reorder
    // guard. stripe_last_event_epoch should still match the created event.
    expect(afterLateDelete[0].tier).toBe("regular");
    expect(afterLateDelete[0].stripeLastEventEpoch).toBe(2_000_000_000);
  });
});
