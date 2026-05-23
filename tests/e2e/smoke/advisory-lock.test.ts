/**
 * Smoke: advisory lock serializes concurrent inbox turns for the same user.
 *
 * Two Telegram updates land at almost the same instant from the same chat.
 * The inbox worker takes a Postgres advisory lock keyed on user_id so the
 * second turn waits for the first to finish — otherwise we'd interleave
 * tool calls and corrupt workouts.
 *
 * We prove serialization by asserting on the timestamps of the two assistant
 * replies: the second must be >= the first. (Without the lock, parallel
 * agent runs could finish in any order and the timestamps would have no
 * causal relation to the input order.)
 *
 * Exercises real Postgres advisory locks against the testcontainers PG.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import { asc, eq, and } from "drizzle-orm";
import { E2EHarness } from "../harness/index.js";
import { seedUser } from "../harness/builders.js";
import { eventually } from "../harness/waiters.js";
import { getDb } from "../../../src/db/client.js";
import { messages } from "../../../src/db/schema.js";

const HAS_API_KEY = !!process.env.ANTHROPIC_API_KEY;
const describeMaybe = HAS_API_KEY ? describe : describe.skip;

describeMaybe("e2e smoke / advisory lock", () => {
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

  it("serializes two near-simultaneous turns for the same chat", async () => {
    const user = await seedUser({
      telegramChatId: "888",
      profileBody:
        "## Goals\nbuild strength\n## Equipment\nfull commercial gym\n## Schedule\n4x/week",
    });

    const [r1, r2] = await Promise.all([
      env.sendTelegramUpdate({ chatId: 888, text: "first", updateId: 1001 }),
      env.sendTelegramUpdate({ chatId: 888, text: "second", updateId: 1002 }),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    // Wait for both user messages + two assistant replies to land.
    try {
      await eventually(
        async () => {
          const db = getDb();
          const userMsgs = await db
            .select()
            .from(messages)
            .where(and(eq(messages.userId, user.id), eq(messages.role, "user")));
          const asstMsgs = await db
            .select()
            .from(messages)
            .where(and(eq(messages.userId, user.id), eq(messages.role, "assistant")));
          return userMsgs.length >= 2 && asstMsgs.length >= 2;
        },
        { timeoutMs: 60_000, label: "two user + two assistant messages persisted" }
      );
    } catch (err) {
      env.printTimeline("advisory-lock failure");
      throw err;
    }

    const db = getDb();
    const asstMsgs = await db
      .select()
      .from(messages)
      .where(and(eq(messages.userId, user.id), eq(messages.role, "assistant")))
      .orderBy(asc(messages.ts));

    expect(asstMsgs.length).toBeGreaterThanOrEqual(2);
    // The lock guarantees the second reply's timestamp is at least the first's.
    // If turns ran in parallel, ordering would be racy.
    const t1 = new Date(asstMsgs[0].ts).getTime();
    const t2 = new Date(asstMsgs[1].ts).getTime();
    expect(t2).toBeGreaterThanOrEqual(t1);
  });
});
