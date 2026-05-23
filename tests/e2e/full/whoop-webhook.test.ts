/**
 * Full e2e — Whoop webhook intake.
 *
 * The Whoop webhook handler resolves the user from `payload.user_id` →
 * `integration_tokens.external_user_id`, then asynchronously enriches the
 * event by calling the Whoop REST API. In tests there's no real Whoop API,
 * so the enrichment will fail — but the webhook MUST still return 200
 * synchronously after signature verification (the handler returns 200 before
 * the async work runs).
 *
 * Once we wire up a fake Whoop API server, we can extend this to assert on
 * the resulting integration_metrics row. For now: 200 + no crash.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import { E2EHarness } from "../harness/index.js";
import { seedUser } from "../harness/builders.js";
import { getStorage } from "../../../src/storage/db.js";
import { encryptSecret } from "../../../src/crypto/secrets.js";

describe("e2e full / whoop webhook", () => {
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

  it("accepts a signed whoop recovery.updated event without crashing", async () => {
    const user = await seedUser({ displayName: "WhoopAthlete", tier: "athlete" });

    // Bind external_user_id=12345 to this IronClaude user so the handler can
    // resolve the user from the webhook payload. We have to encrypt the
    // tokens since the prod path expects the v1: AES-GCM format.
    await getStorage().upsertIntegrationToken(user.id, "whoop", {
      accessTokenEnc: encryptSecret("test-access-token"),
      refreshTokenEnc: encryptSecret("test-refresh-token"),
      expiresAt: new Date(Date.now() + 3600_000),
      externalUserId: "12345",
      scopes: "read:recovery read:sleep",
    });

    const res = await env.sendWhoopWebhook("whoop", {
      type: "recovery.updated",
      whoopUserId: 12345,
      resourceId: "rec_1",
    });

    // Whoop integration returns 200 immediately after signature verification.
    // Anything that happens during the async enrichment (which WILL fail
    // since there's no real Whoop API) is logged but doesn't change the HTTP
    // response.
    expect(res.status).toBe(200);
  });
});
