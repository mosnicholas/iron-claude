/**
 * Tool integration tests — write side.
 *
 * Exercise each write tool against a seeded in-memory DB and assert on
 *  (a) the tool's return string,
 *  (b) the resulting DB rows,
 *  (c) idempotency where applicable.
 * No LLM in the loop.
 */

import { createMemDb, seedUser, getMemDb } from "../helpers/pgmem.js";
import { getStorage } from "../../src/storage/db.js";
import { createTestContext } from "./setup.js";
import { getCurrentWeek, getToday } from "../../src/utils/date.js";
import {
  startWorkout,
  logExercise,
  completeWorkout,
  removeExercise,
  editExercise,
  savePlan,
  amendPlan,
  saveRetro,
  saveLearning,
} from "../../src/coach-v2/tools/writes.js";
import { addReminder } from "../../src/coach-v2/tools/reminders.js";

describe("write tools", () => {
  let userId: string;
  const today = getToday("America/New_York");
  const currentWeek = getCurrentWeek("America/New_York");

  beforeAll(() => {
    createMemDb();
  });
  afterAll(() => {
    getMemDb().close();
  });
  beforeEach(async () => {
    getMemDb().reset();
    userId = await seedUser({ displayName: "Athlete" });
  });

  // ── start_workout ──────────────────────────────────────────────────────────
  describe("start_workout", () => {
    it("creates a new in_progress workout", async () => {
      const ctx = createTestContext(userId);
      const result = await startWorkout.handler({ type: "upper" }, ctx);
      expect(result).toMatch(/Started workout/);
      const w = await getStorage().getWorkout(userId, today);
      expect(w?.status).toBe("in_progress");
      expect(w?.type).toBe("upper");
    });

    it("is idempotent — second call on same day reports already exists", async () => {
      const ctx = createTestContext(userId);
      await startWorkout.handler({ type: "upper" }, ctx);
      const r2 = await startWorkout.handler({ type: "upper" }, ctx);
      expect(r2).toMatch(/already exists/);
      // Still only one workout row.
      const all = await getStorage().listWeekDates(userId, currentWeek);
      expect(all).toHaveLength(1);
    });

    it("schedules a workout-timeout-check reminder for non-back-fills", async () => {
      const ctx = createTestContext(userId);
      await startWorkout.handler({ type: "upper" }, ctx);
      const reminders = await getStorage().getReminders(userId);
      expect(
        reminders.find((r) => r.context === "workout-timeout-check")
      ).toBeTruthy();
    });
  });

  // ── log_exercise ───────────────────────────────────────────────────────────
  describe("log_exercise", () => {
    it("creates a workout if none exists, then logs the exercise", async () => {
      const ctx = createTestContext(userId);
      const result = await logExercise.handler(
        {
          exercise: "Bench Press",
          sets: [{ reps: 5, weight: 175, rpe: 7 }],
        },
        ctx
      );
      expect(result).toMatch(/Logged Bench Press/);
      const w = await getStorage().getWorkout(userId, today);
      expect(w?.exercises).toHaveLength(1);
      expect(w?.exercises[0].sets).toHaveLength(1);
      expect(w?.exercises[0].sets[0].weight).toBe(175);
    });

    it("appends additional sets to an existing exercise", async () => {
      const ctx = createTestContext(userId);
      await logExercise.handler(
        { exercise: "Bench", sets: [{ reps: 5, weight: 175 }] },
        ctx
      );
      await logExercise.handler(
        { exercise: "Bench", sets: [{ reps: 5, weight: 175 }] },
        ctx
      );
      const w = await getStorage().getWorkout(userId, today);
      // Second call with same trailing set is a no-op.
      expect(w?.exercises[0].sets).toHaveLength(1);
    });

    it("creates a new exercise section when the exercise is different", async () => {
      const ctx = createTestContext(userId);
      await logExercise.handler(
        { exercise: "Bench", sets: [{ reps: 5, weight: 175 }] },
        ctx
      );
      await logExercise.handler(
        { exercise: "OHP", sets: [{ reps: 5, weight: 105 }] },
        ctx
      );
      const w = await getStorage().getWorkout(userId, today);
      expect(w?.exercises.map((e) => e.name)).toEqual(["Bench", "OHP"]);
    });

    it("accepts string-weight bodyweight expressions", async () => {
      const ctx = createTestContext(userId);
      await logExercise.handler(
        { exercise: "Pull-up", sets: [{ reps: 8, weight: "BW+25" }] },
        ctx
      );
      const w = await getStorage().getWorkout(userId, today);
      expect(w?.exercises[0].sets[0].weight).toBeNull();
      expect(w?.exercises[0].sets[0].weightText).toBe("BW+25");
    });

    it("returns 'no change' when re-sending the same trailing sets", async () => {
      const ctx = createTestContext(userId);
      const sets = [{ reps: 5, weight: 175, rpe: 7 }];
      await logExercise.handler({ exercise: "Bench", sets }, ctx);
      const r2 = await logExercise.handler({ exercise: "Bench", sets }, ctx);
      expect(r2).toMatch(/No change/);
    });

    it("rejects logging after the workout is completed", async () => {
      const ctx = createTestContext(userId);
      await startWorkout.handler({ type: "upper" }, ctx);
      await logExercise.handler(
        { exercise: "Bench", sets: [{ reps: 5, weight: 175 }] },
        ctx
      );
      await completeWorkout.handler(
        { summary: "done", energy_level: 8 },
        ctx
      );
      const r = await logExercise.handler(
        { exercise: "OHP", sets: [{ reps: 5, weight: 105 }] },
        ctx
      );
      expect(r).toMatch(/already marked complete/);
    });
  });

  // ── complete_workout ───────────────────────────────────────────────────────
  describe("complete_workout", () => {
    it("returns an error when no workout exists", async () => {
      const ctx = createTestContext(userId);
      const r = await completeWorkout.handler(
        { summary: "x", energy_level: 7 },
        ctx
      );
      expect(r).toMatch(/No workout exists/);
    });

    it("marks status completed and writes a summary", async () => {
      const ctx = createTestContext(userId);
      await startWorkout.handler({ type: "upper" }, ctx);
      await logExercise.handler(
        { exercise: "Bench", sets: [{ reps: 5, weight: 175 }] },
        ctx
      );
      const r = await completeWorkout.handler(
        { summary: "Strong session", energy_level: 9 },
        ctx
      );
      expect(r).toMatch(/Completed workout/);
      const w = await getStorage().getWorkout(userId, today);
      expect(w?.status).toBe("completed");
      expect(w?.summary).toBe("Strong session");
      expect(w?.energyLevel).toBe(9);
    });

    it("inserts PRs and marks them current", async () => {
      const ctx = createTestContext(userId);
      await startWorkout.handler({ type: "upper" }, ctx);
      await logExercise.handler(
        { exercise: "Bench", sets: [{ reps: 5, weight: 200 }] },
        ctx
      );
      await completeWorkout.handler(
        {
          summary: "PR day",
          energy_level: 9,
          prs_hit: [
            {
              exercise: "Bench",
              weight: 200,
              reps: 5,
              achievement: "200x5 (weight PR)",
            },
          ],
        },
        ctx
      );
      const prs = await getStorage().readPRs(userId);
      const current = prs.find((p) => p.isCurrent && p.exercise === "Bench");
      expect(current?.weight).toBe(200);
    });

    it("clears the workout-timeout-check reminder", async () => {
      const ctx = createTestContext(userId);
      await startWorkout.handler({ type: "upper" }, ctx);
      await logExercise.handler(
        { exercise: "Bench", sets: [{ reps: 5, weight: 175 }] },
        ctx
      );
      const r = await completeWorkout.handler(
        { summary: "x", energy_level: 7 },
        ctx
      );
      expect(r).toMatch(/Cleared/);
      const reminders = await getStorage().getReminders(userId);
      expect(
        reminders.find((x) => x.context === "workout-timeout-check")
      ).toBeUndefined();
    });

    it("supports status='abandoned'", async () => {
      const ctx = createTestContext(userId);
      await startWorkout.handler({ type: "upper" }, ctx);
      await logExercise.handler(
        { exercise: "Bench", sets: [{ reps: 5, weight: 175 }] },
        ctx
      );
      await completeWorkout.handler(
        { summary: "cut short", energy_level: 4, status: "abandoned" },
        ctx
      );
      const w = await getStorage().getWorkout(userId, today);
      expect(w?.status).toBe("abandoned");
    });
  });

  // ── remove_exercise / edit_exercise ────────────────────────────────────────
  describe("remove_exercise", () => {
    it("returns 'no workout' when the date has no log", async () => {
      const ctx = createTestContext(userId);
      const r = await removeExercise.handler({ exercise: "Bench" }, ctx);
      expect(r).toMatch(/No workout/);
    });

    it("removes the exercise + sets", async () => {
      const ctx = createTestContext(userId);
      await logExercise.handler(
        { exercise: "Bench", sets: [{ reps: 5, weight: 175 }] },
        ctx
      );
      const r = await removeExercise.handler({ exercise: "Bench" }, ctx);
      expect(r).toMatch(/Removed Bench/);
      const w = await getStorage().getWorkout(userId, today);
      expect(w?.exercises).toHaveLength(0);
    });

    it("returns a 'not found' message when the exercise is missing", async () => {
      const ctx = createTestContext(userId);
      await startWorkout.handler({ type: "upper" }, ctx);
      const r = await removeExercise.handler({ exercise: "Squat" }, ctx);
      expect(r).toMatch(/No "Squat" section/);
    });
  });

  describe("edit_exercise", () => {
    it("overwrites sets", async () => {
      const ctx = createTestContext(userId);
      await logExercise.handler(
        {
          exercise: "Bench",
          sets: [
            { reps: 5, weight: 175 },
            { reps: 5, weight: 175 },
          ],
        },
        ctx
      );
      const r = await editExercise.handler(
        { exercise: "Bench", sets: [{ reps: 3, weight: 200 }] },
        ctx
      );
      expect(r).toMatch(/Edited Bench/);
      const w = await getStorage().getWorkout(userId, today);
      expect(w?.exercises[0].sets).toHaveLength(1);
      expect(w?.exercises[0].sets[0].weight).toBe(200);
    });
  });

  // ── save_plan / amend_plan ─────────────────────────────────────────────────
  describe("save_plan + amend_plan", () => {
    it("saves a plan", async () => {
      const ctx = createTestContext(userId);
      const r = await savePlan.handler(
        { week: currentWeek, content: "# Plan body" },
        ctx
      );
      expect(r).toMatch(/Saved plan/);
      const p = await getStorage().readWeeklyPlan(userId, currentWeek);
      expect(p?.body).toBe("# Plan body");
    });

    it("save_plan upserts (no duplicates)", async () => {
      const ctx = createTestContext(userId);
      await savePlan.handler({ week: currentWeek, content: "v1" }, ctx);
      await savePlan.handler({ week: currentWeek, content: "v2" }, ctx);
      const p = await getStorage().readWeeklyPlan(userId, currentWeek);
      expect(p?.body).toBe("v2");
    });

    it("amend_plan refuses when no plan exists", async () => {
      const ctx = createTestContext(userId);
      const r = await amendPlan.handler(
        { week: currentWeek, amendment: "shifted" },
        ctx
      );
      expect(r).toMatch(/No plan exists/);
    });

    it("amend_plan appends an Amendments section", async () => {
      const ctx = createTestContext(userId);
      await savePlan.handler({ week: currentWeek, content: "# Plan" }, ctx);
      await amendPlan.handler(
        { week: currentWeek, amendment: "Friday → Saturday" },
        ctx
      );
      const p = await getStorage().readWeeklyPlan(userId, currentWeek);
      expect(p?.body).toMatch(/Amendments/);
      expect(p?.body).toMatch(/Friday → Saturday/);
    });
  });

  // ── save_retro ─────────────────────────────────────────────────────────────
  describe("save_retro", () => {
    it("writes a retro", async () => {
      const ctx = createTestContext(userId);
      const r = await saveRetro.handler(
        { week: currentWeek, content: "# Retro body" },
        ctx
      );
      expect(r).toMatch(/Saved retro/);
      const got = await getStorage().readWeeklyRetro(userId, currentWeek);
      expect(got?.body).toBe("# Retro body");
    });
  });

  // ── save_learning ──────────────────────────────────────────────────────────
  describe("save_learning", () => {
    it("appends a categorized learning", async () => {
      const ctx = createTestContext(userId);
      const r = await saveLearning.handler(
        { category: "preference", content: "Likes supersets" },
        ctx
      );
      expect(r).toMatch(/Saved learning/);
      const l = await getStorage().readLearnings(userId);
      expect(l).toMatch(/Likes supersets/);
      expect(l).toMatch(/preference/);
    });

    it("multiple calls accumulate", async () => {
      const ctx = createTestContext(userId);
      await saveLearning.handler(
        { category: "preference", content: "A" },
        ctx
      );
      await saveLearning.handler(
        { category: "preference", content: "B" },
        ctx
      );
      const l = await getStorage().readLearnings(userId);
      expect(l).toMatch(/A/);
      expect(l).toMatch(/B/);
    });
  });

  // ── add_reminder ───────────────────────────────────────────────────────────
  describe("add_reminder", () => {
    it("schedules a reminder", async () => {
      const ctx = createTestContext(userId);
      const r = await addReminder.handler(
        {
          triggerDate: "2026-05-21",
          triggerHour: 9,
          message: "drink water",
        },
        ctx
      );
      expect(r).toMatch(/Scheduled reminder/);
      const all = await getStorage().getReminders(userId);
      expect(all.find((x) => x.message === "drink water")).toBeTruthy();
    });
  });
});
