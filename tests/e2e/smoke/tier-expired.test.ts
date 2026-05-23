/**
 * Smoke: tier-gate blocks expired users before the agent runs.
 *
 * Expired-trial users hitting the inbox should receive the subscribe block
 * message — no LLM call, no model attribution on the persisted assistant
 * message. This guards against accidentally billing inference for users we
 * already turned off.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import { and, eq, isNotNull } from "drizzle-orm";
import { E2EHarness } from "../harness/index.js";
import { seedExpiredTrial } from "../harness/builders.js";
import { eventually } from "../harness/waiters.js";
import { getDb } from "../../../src/db/client.js";
import { messages } from "../../../src/db/schema.js";

describe("e2e smoke / tier gate (expired)", () => {
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

  it("blocks expired-trial users with a subscribe message and never invokes the agent", async () => {
    const user = await seedExpiredTrial({
      telegramChatId: "777",
      profileBody: "## Goals\nx",
    });

    const res = await env.sendTelegramUpdate({ chatId: 777, text: "hi coach" });
    expect(res.status).toBe(200);

    // The gate sends the block synchronously via the inbox worker.
    await eventually(
      () => {
        const text = env.telegram.sentText().toLowerCase();
        return text.includes("subscribe") || undefined;
      },
      { timeoutMs: 10_000, label: "subscribe block message sent" }
    );

    // The agent never ran — no assistant message has a non-null model.
    const db = getDb();
    const withModel = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.userId, user.id),
          eq(messages.role, "assistant"),
          isNotNull(messages.model)
        )
      );
    expect(withModel).toHaveLength(0);
  });
});
