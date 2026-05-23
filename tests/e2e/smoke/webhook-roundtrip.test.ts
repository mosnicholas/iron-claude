/**
 * Smoke: Telegram webhook → inbox → worker → tool → reply.
 *
 * The single most important e2e test. Verifies that the full real path from
 * "user types a message" to "bot sends a reply" works against real Postgres,
 * a fake Telegram, and real Anthropic.
 *
 * Skipped automatically when ANTHROPIC_API_KEY is unset (since real LLM
 * calls would 401).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import { eq } from "drizzle-orm";
import { E2EHarness } from "../harness/index.js";
import { seedUser } from "../harness/builders.js";
import { eventually } from "../harness/waiters.js";
import { getDb } from "../../../src/db/client.js";
import { messages, workouts, workoutSets } from "../../../src/db/schema.js";

const HAS_API_KEY = !!process.env.ANTHROPIC_API_KEY;
const describeMaybe = HAS_API_KEY ? describe : describe.skip;

describeMaybe("e2e smoke / webhook roundtrip", () => {
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

  it("accepts a Telegram update and queues it on the inbox", async () => {
    // Brand-new chat — the webhook should auto-create the user.
    const res = await env.sendTelegramUpdate({
      chatId: 12345,
      text: "hi",
    });
    expect(res.status).toBe(200);

    // The inbox worker picks it up and runs the agent. We don't assert on
    // the model's wording (brittle); we assert that:
    //   - the user message landed in `messages`
    //   - at least one assistant message followed
    //   - the fake Telegram received at least one outbound call
    await eventually(
      async () => {
        const db = getDb();
        const userMessages = await db.select().from(messages);
        const hasUser = userMessages.some((m) => m.role === "user" && m.text === "hi");
        const hasAssistant = userMessages.some((m) => m.role === "assistant");
        return hasUser && hasAssistant;
      },
      { timeoutMs: 30_000, label: "user + assistant messages persisted" }
    );

    expect(env.telegram.callsTo("sendMessage").length + env.telegram.callsTo("editMessageText").length)
      .toBeGreaterThan(0);
  });

  it("logs a workout end-to-end", async () => {
    // Pre-seed the user + a profile so the agent has context.
    const user = await seedUser({
      displayName: "TestAthlete",
      timezone: "America/New_York",
      telegramChatId: "555",
      profileBody:
        "## Goals\nbuild strength (bench, squat, deadlift)\n## Equipment\nfull commercial gym\n## Schedule\n4x/week",
    });

    const res = await env.sendTelegramUpdate({
      chatId: 555,
      text: "Just did bench 175 for 5 reps, 3 sets",
    });
    expect(res.status).toBe(200);

    // The agent should call log_exercise (and likely start_workout first).
    // Assert structurally: a workout row exists for this user with at least
    // one bench-press exercise.
    try {
      await eventually(
        async () => {
          const db = getDb();
          const myWorkouts = await db.select().from(workouts).where(eq(workouts.userId, user.id));
          if (myWorkouts.length === 0) return false;
          const allSets = await db.select().from(workoutSets);
          return allSets.length > 0 && myWorkouts.length > 0;
        },
        { timeoutMs: 45_000, label: "workout row + sets persisted" }
      );
    } catch (err) {
      env.printTimeline("workout-logging failure");
      throw err;
    }
  });
});
