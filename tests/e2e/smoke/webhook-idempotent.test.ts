/**
 * Smoke: idempotent Telegram webhook ingestion.
 *
 * Telegram retries the same update_id when its delivery times out (or when
 * two ingress instances race). The webhook handler must INSERT into
 * `inbox_events` with ON CONFLICT DO NOTHING on (channel, external_update_id)
 * so the second delivery becomes a no-op.
 *
 * We assert at the queue layer — no LLM involved.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import { and, eq } from "drizzle-orm";
import { E2EHarness } from "../harness/index.js";
import { seedUser } from "../harness/builders.js";
import { getDb } from "../../../src/db/client.js";
import { inboxEvents } from "../../../src/db/schema.js";

describe("e2e smoke / webhook idempotent", () => {
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

  it("collapses duplicate update_ids into a single inbox row", async () => {
    await seedUser({ telegramChatId: "999" });

    const updateId = 42424242;
    const [r1, r2] = await Promise.all([
      env.sendTelegramUpdate({ chatId: 999, text: "first", updateId }),
      env.sendTelegramUpdate({ chatId: 999, text: "first", updateId }),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const db = getDb();
    const rows = await db
      .select()
      .from(inboxEvents)
      .where(
        and(
          eq(inboxEvents.channel, "telegram"),
          eq(inboxEvents.externalUpdateId, String(updateId))
        )
      );
    expect(rows).toHaveLength(1);
  });
});
