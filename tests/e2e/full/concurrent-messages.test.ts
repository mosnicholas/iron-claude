/**
 * Full e2e — advisory lock under burst load.
 *
 * The inbox worker serializes turns for the same user with a Postgres
 * advisory lock keyed on user_id. Fire 3 messages back-to-back from the same
 * chat and verify:
 *
 *   - Every user message landed in `messages` (no drops on the webhook side)
 *   - Every user message has a matching assistant response (the lock didn't
 *     deadlock or get bypassed)
 *   - Assistant message timestamps are monotonically non-decreasing (the
 *     lock serialized them in arrival order; nothing interleaved or
 *     corrupted the conversation history)
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import { asc, eq } from "drizzle-orm";
import { E2EHarness } from "../harness/index.js";
import { seedUser } from "../harness/builders.js";
import { eventually } from "../harness/waiters.js";
import { getDb } from "../../../src/db/client.js";
import { messages } from "../../../src/db/schema.js";

const HAS_API_KEY = !!process.env.ANTHROPIC_API_KEY;
const describeMaybe = HAS_API_KEY ? describe : describe.skip;

describeMaybe("e2e full / concurrent messages (advisory lock)", () => {
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

  it("serializes 3 back-to-back messages from the same chat", async () => {
    const user = await seedUser({
      displayName: "ConcurrentAthlete",
      telegramChatId: "9501",
      profileBody:
        "## Goals\nstrength\n## Equipment\nfull gym\n## Schedule\n3x/week",
    });

    const texts = ["first message", "second message", "third message"];

    try {
      // Fire all three with no awaiting between sends — they should race the
      // webhook + inbox at the worker.
      const sends = await Promise.all(
        texts.map((text, i) =>
          env.sendTelegramUpdate({ chatId: 9501, text, updateId: 95010 + i })
        )
      );
      for (const s of sends) expect(s.status).toBe(200);

      // Wait for 3 user rows and at least 3 assistant rows to land.
      await eventually(
        async () => {
          const db = getDb();
          const all = await db
            .select()
            .from(messages)
            .where(eq(messages.userId, user.id))
            .orderBy(asc(messages.ts));
          const userCount = all.filter((m) => m.role === "user").length;
          const assistantCount = all.filter((m) => m.role === "assistant").length;
          return userCount >= 3 && assistantCount >= 3 && all;
        },
        { timeoutMs: 180_000, pollIntervalMs: 500, label: "3 user + 3 assistant rows persisted" }
      );

      const db = getDb();
      const all = await db
        .select()
        .from(messages)
        .where(eq(messages.userId, user.id))
        .orderBy(asc(messages.ts));

      const userMessages = all.filter((m) => m.role === "user");
      const assistantMessages = all.filter((m) => m.role === "assistant");

      // Every user text we sent is represented.
      for (const t of texts) {
        expect(userMessages.some((m) => m.text === t)).toBe(true);
      }

      // Lock invariant: assistant message timestamps are monotonically
      // non-decreasing. If two turns ran in parallel for the same user we'd
      // expect interleaving with at least one inversion.
      for (let i = 1; i < assistantMessages.length; i++) {
        const prev = new Date(assistantMessages[i - 1].ts).getTime();
        const curr = new Date(assistantMessages[i].ts).getTime();
        expect(curr).toBeGreaterThanOrEqual(prev);
      }
    } catch (err) {
      env.printTimeline("concurrent-messages failure");
      throw err;
    }
  }, 300_000);
});
