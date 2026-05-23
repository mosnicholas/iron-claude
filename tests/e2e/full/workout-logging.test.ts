/**
 * Full e2e — multi-turn workout session.
 *
 * Drives a complete workout through the agent across four Telegram turns:
 *   1. "starting upper body workout" → start_workout creates a workouts row
 *   2. "bench 175 for 5 reps"        → log_exercise inserts a workout_sets row
 *   3. "and 175 for 4 more"          → second set on the same exercise
 *   4. "I'm done"                    → complete_workout flips status=completed
 *
 * We don't assert on the model's wording — we assert on the structural facts
 * (DB rows, statuses, set counts) that prove each tool fired.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import { and, eq } from "drizzle-orm";
import { E2EHarness } from "../harness/index.js";
import { seedUser } from "../harness/builders.js";
import { eventually } from "../harness/waiters.js";
import { getDb } from "../../../src/db/client.js";
import { workouts, workoutExercises, workoutSets } from "../../../src/db/schema.js";

const HAS_API_KEY = !!process.env.ANTHROPIC_API_KEY;
const describeMaybe = HAS_API_KEY ? describe : describe.skip;

describeMaybe("e2e full / workout logging (multi-turn)", () => {
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

  it("drives a full workout: start → log → log → complete", async () => {
    const user = await seedUser({
      displayName: "MultiTurnAthlete",
      timezone: "America/New_York",
      telegramChatId: "9001",
      profileBody:
        "## Goals\nbuild strength (bench, squat, deadlift)\n## Equipment\nfull commercial gym\n## Schedule\n4x/week",
    });

    try {
      // ── Turn 1: start the workout ───────────────────────────────────────
      const r1 = await env.sendTelegramUpdate({
        chatId: 9001,
        text: "starting upper body workout",
        updateId: 90011,
      });
      expect(r1.status).toBe(200);

      const workout = await eventually(
        async () => {
          const db = getDb();
          const rows = await db.select().from(workouts).where(eq(workouts.userId, user.id));
          return rows[0] ?? null;
        },
        { timeoutMs: 45_000, label: "workout row created by start_workout" }
      );
      expect(workout.status).toBe("in_progress");

      // ── Turn 2: first set ───────────────────────────────────────────────
      const r2 = await env.sendTelegramUpdate({
        chatId: 9001,
        text: "bench 175 for 5 reps",
        updateId: 90012,
      });
      expect(r2.status).toBe(200);

      await eventually(
        async () => {
          const db = getDb();
          const sets = await db.select().from(workoutSets);
          return sets.length >= 1 && sets;
        },
        { timeoutMs: 45_000, label: "first workout_sets row" }
      );

      // ── Turn 3: second set, same exercise ───────────────────────────────
      const r3 = await env.sendTelegramUpdate({
        chatId: 9001,
        text: "and 175 for 4 more",
        updateId: 90013,
      });
      expect(r3.status).toBe(200);

      await eventually(
        async () => {
          const db = getDb();
          const sets = await db.select().from(workoutSets);
          return sets.length >= 2 && sets;
        },
        { timeoutMs: 45_000, label: "second workout_sets row" }
      );

      // ── Turn 4: complete ────────────────────────────────────────────────
      const r4 = await env.sendTelegramUpdate({
        chatId: 9001,
        text: "I'm done",
        updateId: 90014,
      });
      expect(r4.status).toBe(200);

      const completed = await eventually(
        async () => {
          const db = getDb();
          const rows = await db
            .select()
            .from(workouts)
            .where(and(eq(workouts.userId, user.id), eq(workouts.status, "completed")));
          return rows[0] ?? null;
        },
        { timeoutMs: 45_000, label: "workout marked completed" }
      );
      expect(completed.status).toBe("completed");
      expect(completed.summary).toBeTruthy();

      // ── Final structural check: the same workout has at least one exercise
      // and at least two sets attached.
      const db = getDb();
      const exercises = await db
        .select()
        .from(workoutExercises)
        .where(eq(workoutExercises.workoutId, completed.id));
      expect(exercises.length).toBeGreaterThanOrEqual(1);
      const allSets = await db.select().from(workoutSets);
      expect(allSets.length).toBeGreaterThanOrEqual(2);
    } catch (err) {
      env.printTimeline("workout-logging failure");
      throw err;
    }
  }, 240_000);
});
