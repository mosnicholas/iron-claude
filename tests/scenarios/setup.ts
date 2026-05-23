/**
 * Test Environment Setup
 *
 * Reuses the testcontainers Postgres booted by jest-global-setup.ts, seeds a
 * user with the canonical fixture data, and returns a `TestEnv` the scenario
 * tests use to drive the real `CoachAgentV2` (Haiku model) without touching
 * the filesystem.
 *
 * Scenario tests run against the real LLM (`claude-haiku-4-5`) — but every
 * persistence call goes through `DbStorage`, so the test asserts on DB rows
 * rather than file side effects.
 */

import { createMemDb, seedUser, getMemDb } from "../helpers/realpg.js";
import { getStorage } from "../../src/storage/db.js";
import { getCurrentWeek, getToday } from "../../src/utils/date.js";
import { PROFILE, PRS, LEARNINGS, buildWeeklyPlan } from "./fixtures.js";

export interface TestEnvOptions {
  /** Override profile body */
  profile?: string;
  /** Override the seeded PRs */
  prs?: Array<{
    exercise: string;
    weight: number;
    reps: number;
    date: string;
    estimated1Rm?: number;
  }>;
  /** Override learnings body */
  learnings?: string;
  /** Override weekly plan body */
  plan?: string;
  /** Pre-seed an existing in-progress workout for today */
  existingWorkout?: {
    type?: string;
    location?: string;
    exercises?: Array<{
      name: string;
      sets: Array<{ reps: number; weight: number | string; rpe?: number }>;
    }>;
  };
  /** Skip creating a weekly plan */
  noPlan?: boolean;
}

export interface TestEnv {
  /** Seeded user id */
  userId: string;
  /** Current ISO week (e.g., "2026-W21") */
  currentWeek: string;
  /** Today's date string (YYYY-MM-DD) */
  today: string;
  /** Tear down the in-memory DB */
  cleanup(): void;
}

let envInitialized = false;

/**
 * Build a fresh test environment. Re-uses one Postgres pool across calls
 * (creating a new container per test would be slow); the async `reset()` step
 * TRUNCATEs every app table back to empty.
 */
export async function setupTestEnv(options: TestEnvOptions = {}): Promise<TestEnv> {
  if (!envInitialized) {
    createMemDb();
    envInitialized = true;
  }
  await getMemDb().reset();
  const userId = await seedUser({ displayName: "Test Athlete" });
  const currentWeek = getCurrentWeek();
  const today = getToday();
  const storage = getStorage();

  await storage.writeProfile(userId, options.profile ?? PROFILE);
  await storage.writeLearnings(userId, options.learnings ?? LEARNINGS);

  for (const pr of options.prs ?? PRS) {
    await storage.upsertPR(userId, { ...pr, date: pr.date });
  }

  if (!options.noPlan) {
    await storage.writeWeeklyPlan(
      userId,
      currentWeek,
      options.plan ?? buildWeeklyPlan(currentWeek)
    );
  }

  if (options.existingWorkout) {
    const w = await storage.startWorkout(userId, {
      date: today,
      isoWeek: currentWeek,
      type: options.existingWorkout.type ?? "upper",
      location: options.existingWorkout.location,
      backFilled: false,
      startedAt: "10:00",
    });
    for (const ex of options.existingWorkout.exercises ?? []) {
      await storage.appendExerciseSets(userId, w.id, ex.name, ex.sets);
    }
  }

  return {
    userId,
    currentWeek,
    today,
    cleanup(): void {
      // The next setupTestEnv call will reset; no per-test cleanup needed.
    },
  };
}
