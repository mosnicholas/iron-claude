/**
 * Smoke: webhook rejects bogus Telegram secret tokens.
 *
 * The /api/webhook route is "internet-exposed" — anything with a webhook URL
 * can hit it. The first line of defense is the x-telegram-bot-api-secret-token
 * header. A request with the wrong token must 401 with zero side effects on
 * inbox_events.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import { E2EHarness } from "../harness/index.js";
import { getDb } from "../../../src/db/client.js";
import { inboxEvents } from "../../../src/db/schema.js";

describe("e2e smoke / webhook bad signature", () => {
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

  it("rejects requests with a bogus secret-token header", async () => {
    const res = await env.post(
      "/api/webhook",
      {
        update_id: 1,
        message: { message_id: 1, chat: { id: 1 }, text: "hi" },
      },
      { "x-telegram-bot-api-secret-token": "bogus" }
    );
    expect(res.status).toBe(401);

    const db = getDb();
    const rows = await db.select().from(inboxEvents);
    expect(rows).toHaveLength(0);
  });
});
