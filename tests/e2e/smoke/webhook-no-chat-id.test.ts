/**
 * Smoke: webhook acks-and-drops updates with no chat.id.
 *
 * Telegram occasionally sends update shapes our handler can't act on (edited
 * messages without a chat, channel posts we don't subscribe to, etc.). The
 * handler should 200 (so Telegram stops retrying) but NOT enqueue anything.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import { E2EHarness } from "../harness/index.js";
import { getDb } from "../../../src/db/client.js";
import { inboxEvents } from "../../../src/db/schema.js";

describe("e2e smoke / webhook missing chat id", () => {
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

  it("returns 200 without enqueueing when message.chat.id is missing", async () => {
    const res = await env.post(
      "/api/webhook",
      {
        update_id: 7777,
        message: { message_id: 1 },
      },
      { "x-telegram-bot-api-secret-token": process.env.TELEGRAM_WEBHOOK_SECRET! }
    );
    expect(res.status).toBe(200);

    const db = getDb();
    const rows = await db.select().from(inboxEvents);
    expect(rows).toHaveLength(0);
  });
});
