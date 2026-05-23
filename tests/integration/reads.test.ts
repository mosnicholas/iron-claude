/**
 * Tool integration tests — read side.
 *
 * Seed canonical data, run each read tool, and assert on the rendered output.
 */

import { createMemDb, seedUser, getMemDb } from "../helpers/pgmem.js";
import { getStorage } from "../../src/storage/db.js";
import { createTestContext } from "./setup.js";
import { getCurrentWeek, getToday } from "../../src/utils/date.js";
import {
  getProfile,
  getLearnings,
  getPRs,
  getPlan,
  getWorkout,
  getWorkouts,
  getExerciseHistory,
} from "../../src/coach-v2/tools/reads.js";
import {
  startWorkout,
  logExercise,
} from "../../src/coach-v2/tools/writes.js";

describe("read tools", () => {
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

  // ── get_profile / get_learnings ────────────────────────────────────────────
  describe("get_profile", () => {
    it("returns 'not found' when no profile is saved", async () => {
      const r = await getProfile.handler({}, createTestContext(userId));
      expect(r).toMatch(/not found/);
    });

    it("returns the profile body when present", async () => {
      await getStorage().writeProfile(userId, "# Alice profile");
      const r = await getProfile.handler({}, createTestContext(userId));
      expect(r).toBe("# Alice profile");
    });
  });

  describe("get_learnings", () => {
    it("returns 'not found' when none", async () => {
      const r = await getLearnings.handler({}, createTestContext(userId));
      expect(r).toMatch(/not found/);
    });

    it("returns the learnings body", async () => {
      await getStorage().writeLearnings(userId, "- Likes paused bench reps");
      const r = await getLearnings.handler({}, createTestContext(userId));
      expect(r).toMatch(/paused bench reps/);
    });
  });

  // ── get_prs ────────────────────────────────────────────────────────────────
  describe("get_prs", () => {
    it("returns 'not found' when no PRs", async () => {
      const r = await getPRs.handler({}, createTestContext(userId));
      expect(r).toMatch(/not found/);
    });

    it("returns YAML-shaped current + history blocks", async () => {
      const s = getStorage();
      await s.upsertPR(userId, {
        exercise: "Bench",
        weight: 170,
        reps: 5,
        date: "2026-02-15",
        estimated1Rm: 197,
      });
      await s.upsertPR(userId, {
        exercise: "Bench",
        weight: 175,
        reps: 5,
        date: "2026-03-01",
        estimated1Rm: 203,
      });
      const r = await getPRs.handler({}, createTestContext(userId));
      expect(r).toMatch(/Bench/);
      expect(r).toMatch(/175/);
      expect(r).toMatch(/current/);
      expect(r).toMatch(/history/);
    });
  });

  // ── get_plan ───────────────────────────────────────────────────────────────
  describe("get_plan", () => {
    it("returns 'no plan' when missing", async () => {
      const r = await getPlan.handler(
        { week: currentWeek },
        createTestContext(userId)
      );
      expect(r).toMatch(/No plan exists/);
    });

    it("returns the plan body", async () => {
      await getStorage().writeWeeklyPlan(userId, currentWeek, "# Plan body");
      const r = await getPlan.handler(
        { week: currentWeek },
        createTestContext(userId)
      );
      expect(r).toBe("# Plan body");
    });

    it("defaults to the current week", async () => {
      await getStorage().writeWeeklyPlan(userId, currentWeek, "# Current");
      const r = await getPlan.handler({}, createTestContext(userId));
      expect(r).toBe("# Current");
    });
  });

  // ── get_workout ────────────────────────────────────────────────────────────
  describe("get_workout", () => {
    it("returns 'no workout' when missing", async () => {
      const r = await getWorkout.handler(
        { date: today },
        createTestContext(userId)
      );
      expect(r).toMatch(/No workout logged/);
    });

    it("renders markdown with frontmatter + exercises", async () => {
      const ctx = createTestContext(userId);
      await startWorkout.handler({ type: "upper" }, ctx);
      await logExercise.handler(
        {
          exercise: "Bench Press",
          sets: [
            { reps: 5, weight: 175, rpe: 7 },
            { reps: 5, weight: 180, rpe: 8 },
          ],
        },
        ctx
      );
      const r = await getWorkout.handler({ date: today }, ctx);
      // Frontmatter present
      expect(r).toMatch(/^---/m);
      // Exercise section
      expect(r).toMatch(/### Bench Press/);
      // Set lines with weight x reps + RPE
      expect(r).toMatch(/175 x 5 \(RPE 7\)/);
      expect(r).toMatch(/180 x 5 \(RPE 8\)/);
    });
  });

  // ── get_workouts ───────────────────────────────────────────────────────────
  describe("get_workouts", () => {
    it("summary returns 'no workouts' when none exist", async () => {
      const r = await getWorkouts.handler(
        { format: "summary" },
        createTestContext(userId)
      );
      expect(r).toMatch(/No workouts/);
    });

    it("adherence returns per-day breakdown", async () => {
      const ctx = createTestContext(userId);
      await startWorkout.handler({ type: "upper" }, ctx);
      const r = await getWorkouts.handler(
        { format: "adherence", week: currentWeek },
        ctx
      );
      // Should contain "no log" for some days and an actual entry for today.
      expect(r).toMatch(/no log/);
      expect(r).toMatch(/upper/);
    });
  });

  // ── get_exercise_history ───────────────────────────────────────────────────
  describe("get_exercise_history", () => {
    it("returns 'no instances' when missing", async () => {
      const r = await getExerciseHistory.handler(
        { exercise: "bench", weeks: 8 },
        createTestContext(userId)
      );
      expect(r).toMatch(/No instances/);
    });

    it("returns JSON hits when matches exist", async () => {
      const ctx = createTestContext(userId);
      await startWorkout.handler({ type: "upper" }, ctx);
      await logExercise.handler(
        {
          exercise: "Bench Press",
          sets: [{ reps: 5, weight: 175, rpe: 7 }],
        },
        ctx
      );
      const r = await getExerciseHistory.handler(
        { exercise: "bench", weeks: 8 },
        ctx
      );
      expect(r).toMatch(/175/);
      expect(r).toMatch(/RPE 7/);
    });

    it("matches case-insensitively on substring", async () => {
      const ctx = createTestContext(userId);
      await startWorkout.handler({ type: "upper" }, ctx);
      await logExercise.handler(
        {
          exercise: "Incline Bench Press",
          sets: [{ reps: 8, weight: 135 }],
        },
        ctx
      );
      const r = await getExerciseHistory.handler(
        { exercise: "BENCH", weeks: 8 },
        ctx
      );
      expect(r).toMatch(/135/);
    });
  });
});
