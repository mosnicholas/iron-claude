/**
 * Checkout endpoint integration tests.
 *
 * Drives `createCheckoutSessionHandler` directly with a stubbed req/res — we
 * don't have supertest, and we don't need it for these cases. The real Stripe
 * SDK is never invoked: we test the early-return paths (no session, no
 * Stripe config) and the happy path with a mock Stripe.
 */

import type { Request } from "express";
import type Stripe from "stripe";
import { createCheckoutSessionHandler } from "../../src/handlers/checkout.js";
import { __resetStripeCache, __setStripeForTests } from "../../src/handlers/stripe.js";
import type { User } from "../../src/db/schema.js";

function mkUser(overrides: Partial<User> = {}): User {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    supabaseUserId: null,
    phoneE164: "+15555550111",
    displayName: null,
    timezone: "America/New_York",
    active: true,
    tier: "trial",
    trialStartedAt: new Date(),
    trialEndsAt: new Date(Date.now() + 86_400_000),
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    tierOverriddenByAdmin: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as User;
}

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

function callHandler(req: Partial<Request>, res: FakeRes): Promise<void> {
  return new Promise<void>((resolve) => {
    // The handler returns a Promise; resolve once res.json/status has been
    // called by inspecting the next tick.
    void Promise.resolve(
      (createCheckoutSessionHandler as unknown as (
        req: Partial<Request>,
        res: unknown,
        next: () => void
      ) => Promise<void> | void)(req, res as unknown, () => undefined)
    ).then(() => resolve());
  });
}

describe("POST /api/checkout/create-session", () => {
  const ORIG_ENV = { ...process.env };

  beforeEach(() => {
    __resetStripeCache();
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PRICE_REGULAR;
    delete process.env.STRIPE_PRICE_ATHLETE;
  });

  afterAll(() => {
    process.env = ORIG_ENV;
    __resetStripeCache();
  });

  it("returns 503 when Stripe is not configured", async () => {
    const res = mkRes();
    await callHandler(
      {
        user: mkUser(),
        body: { tier: "regular" },
      } as Partial<Request>,
      res
    );
    expect(res.statusCode).toBe(503);
    expect((res.jsonBody as { error: string }).error).toMatch(/stripe not configured/i);
  });

  it("returns 401 when there is no session (req.user is null)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    const res = mkRes();
    await callHandler(
      {
        user: null as unknown as User,
        body: { tier: "regular" },
      } as Partial<Request>,
      res
    );
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 when tier is invalid", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    const res = mkRes();
    await callHandler(
      {
        user: mkUser(),
        body: { tier: "freebie" },
      } as Partial<Request>,
      res
    );
    expect(res.statusCode).toBe(400);
  });

  it("creates a session and returns its URL on the happy path", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.STRIPE_PRICE_REGULAR = "price_regular_abc";

    const stub = {
      checkout: {
        sessions: {
          create: async (params: Stripe.Checkout.SessionCreateParams) => {
            expect(params.mode).toBe("subscription");
            expect(params.line_items?.[0]?.price).toBe("price_regular_abc");
            expect(params.metadata?.user_id).toBe("11111111-1111-1111-1111-111111111111");
            return { url: "https://stripe.test/session/123" } as Stripe.Checkout.Session;
          },
        },
      },
    } as unknown as Stripe;
    __setStripeForTests(stub);

    const res = mkRes();
    await callHandler(
      {
        user: mkUser(),
        body: { tier: "regular" },
      } as Partial<Request>,
      res
    );

    expect(res.statusCode).toBe(200);
    expect((res.jsonBody as { url: string }).url).toBe("https://stripe.test/session/123");
  });
});
