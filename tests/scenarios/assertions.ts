/**
 * Scenario Test Assertions
 *
 * The pre-DB version of these helpers inspected files in a temp git repo.
 * Since the migration to Postgres-backed storage, they now query the DB
 * through the same `DbStorage` instance the agent uses. The contracts
 * (workout exists for date X, exercise Y was logged, PR was updated) are
 * identical — only the substrate changed.
 */

import { getStorage } from "../../src/storage/db.js";
import type { TestEnv } from "./setup.js";
import type { CoachV2Response as CoachResponse } from "../../src/coach-v2/index.js";

// ============================================================================
// Workout existence
// ============================================================================

/** Assert a workout row exists for the given date. */
export async function expectWorkoutExists(
  env: TestEnv,
  date: string = env.today
): Promise<void> {
  const w = await getStorage().getWorkout(env.userId, date);
  expect(w).not.toBeNull();
}

/** Assert no workout row exists for the given date. */
export async function expectNoWorkout(
  env: TestEnv,
  date: string = env.today
): Promise<void> {
  const w = await getStorage().getWorkout(env.userId, date);
  expect(w).toBeNull();
}

// ============================================================================
// Workout content
// ============================================================================

/** Read a workout and return it (throws if missing). */
export async function readWorkout(
  env: TestEnv,
  date: string = env.today
): Promise<NonNullable<Awaited<ReturnType<typeof getStorage>["getWorkout"]>>> {
  const w = await getStorage().getWorkout(env.userId, date);
  if (!w) {
    throw new Error(`No workout for ${date}`);
  }
  return w;
}

/**
 * Assert the workout for `date` contains an exercise whose name matches the
 * given substring (case-insensitive) AND has at least one set with the given
 * weight. The old file-based assertion did exact substring matching against
 * the rendered markdown; we approximate the same intent against structured
 * rows.
 */
export async function expectExerciseLogged(
  env: TestEnv,
  args: {
    date?: string;
    exercise: string;
    weight?: number | string;
  }
): Promise<void> {
  const w = await readWorkout(env, args.date ?? env.today);
  const ex = w.exercises.find((e) =>
    e.name.toLowerCase().includes(args.exercise.toLowerCase())
  );
  expect(ex).toBeDefined();
  if (args.weight !== undefined) {
    const wantNum = typeof args.weight === "number" ? args.weight : null;
    const wantStr = typeof args.weight === "string" ? args.weight : null;
    const match = ex!.sets.find((s) => {
      if (wantNum !== null) return s.weight === wantNum;
      if (wantStr !== null) return s.weightText === wantStr;
      return false;
    });
    expect(match).toBeDefined();
  }
}

/** Assert workout status (in_progress | completed | abandoned). */
export async function expectWorkoutStatus(
  env: TestEnv,
  expected: "in_progress" | "completed" | "abandoned",
  date: string = env.today
): Promise<void> {
  const w = await readWorkout(env, date);
  expect(w.status).toBe(expected);
}

// ============================================================================
// PRs
// ============================================================================

/** Assert the current PR for an exercise (case-insensitive substring match). */
export async function expectCurrentPR(
  env: TestEnv,
  exercise: string,
  weight: number
): Promise<void> {
  const prs = await getStorage().readPRs(env.userId);
  const matching = prs.filter(
    (p) => p.isCurrent && p.exercise.toLowerCase().includes(exercise.toLowerCase())
  );
  const found = matching.find((p) => p.weight === weight);
  expect(found).toBeDefined();
}

/**
 * Assert the current PR for an exercise is *unchanged* — i.e. the existing
 * record still wins. Useful for "did NOT trigger a PR" cases.
 */
export async function expectCurrentPRUnchanged(
  env: TestEnv,
  exercise: string,
  expectedWeight: number
): Promise<void> {
  const prs = await getStorage().readPRs(env.userId);
  const current = prs.find(
    (p) =>
      p.isCurrent && p.exercise.toLowerCase().includes(exercise.toLowerCase())
  );
  expect(current?.weight).toBe(expectedWeight);
}

// ============================================================================
// Plan
// ============================================================================

/** Read the current plan body (returns empty string if missing). */
export async function readPlanBody(
  env: TestEnv,
  week: string = env.currentWeek
): Promise<string> {
  const p = await getStorage().readWeeklyPlan(env.userId, week);
  return p?.body ?? "";
}

// ============================================================================
// Response assertions
// ============================================================================

export function expectToolUsed(response: CoachResponse, toolName: string): void {
  expect(response.toolsUsed).toContain(toolName);
}

export function expectResponseMentions(
  response: CoachResponse,
  substring: string
): void {
  expect(response.message.toLowerCase()).toContain(substring.toLowerCase());
}
