/**
 * Scenario Test Fixtures
 *
 * Canonical seed data for the scenario tests. The text strings (PROFILE,
 * LEARNINGS, the plan body) get stored directly in their text columns; PRs
 * are converted from the legacy yaml shape into rows the storage layer can
 * upsert.
 *
 * Known fixture values that drive the scenarios:
 * - Plan calls for bench 175x5 — matches `bench 175x5` user input.
 * - Bench PR is 170x5 — `bench 175x5` should be detected as a PR.
 * - Profile establishes the athlete context.
 */

export const PROFILE = `# Athlete Profile

## Basic Info
- **Name**: Test Athlete
- **Weight**: 180 lbs
- **Training Age**: 2 years

## Goals
- Build strength in squat, bench, deadlift
- Target bench press: 200 lbs
- Run a sub-25 minute 5K

## Preferences
- Prefers 4-day upper/lower split
- Likes supersets for accessories
- Available: Mon/Tue/Thu/Fri

## Limitations
- Mild lower back tightness — avoid heavy good mornings
`;

/**
 * Structured PR data — stored as rows in the `prs` table. Mirrors the old
 * `prs.yaml` fixture so the scenario assertions keep their identity.
 */
export const PRS = [
  {
    exercise: "Bench Press",
    weight: 170,
    reps: 5,
    date: "2026-02-15",
    estimated1Rm: 197,
  },
  {
    exercise: "Squat",
    weight: 225,
    reps: 5,
    date: "2026-02-10",
    estimated1Rm: 261,
  },
  {
    exercise: "Deadlift",
    weight: 275,
    reps: 5,
    date: "2026-02-08",
    estimated1Rm: 319,
  },
  {
    exercise: "Overhead Press",
    weight: 105,
    reps: 5,
    date: "2026-02-12",
    estimated1Rm: 122,
  },
];

export const LEARNINGS = `# Learnings

*Patterns and preferences discovered through conversation and observation.*

## Preferences

- [2026-02-10] Likes to warm up with the bar, then jump to working weight quickly
- [2026-02-15] Prefers sets across (same weight all sets) over ramping

## Exercise Notes

- [2026-02-08] Responds well to paused reps on bench for technique work
- [2026-02-12] OHP feels better seated than standing due to low back
`;

/**
 * Build a weekly plan body for the given ISO week string. Uses day names so
 * the plan text doesn't depend on the actual dates.
 */
export function buildWeeklyPlan(weekString: string): string {
  return `# Training Plan — ${weekString}

## Overview
Upper/Lower 4-day split. Moderate intensity week.

## Monday — Upper A
- Bench Press: 175 x 5 x 3 (RPE 7-8)
- Overhead Press: 105 x 5 x 3 (RPE 7)
- Barbell Row: 155 x 8 x 3
- Dumbbell Curl: 30 x 12 x 3
- Tricep Pushdown: 40 x 12 x 3

## Tuesday — Lower A
- Squat: 225 x 5 x 3 (RPE 7-8)
- Romanian Deadlift: 185 x 8 x 3
- Leg Press: 270 x 10 x 3
- Leg Curl: 90 x 12 x 3
- Calf Raise: 135 x 15 x 3

## Thursday — Upper B
- Bench Press: 155 x 8 x 3 (RPE 7, volume day)
- Dumbbell OHP: 45 x 10 x 3
- Cable Row: 120 x 10 x 3
- Lateral Raise: 20 x 15 x 3
- Face Pull: 30 x 15 x 3

## Friday — Lower B
- Deadlift: 275 x 5 x 3 (RPE 7-8)
- Front Squat: 155 x 6 x 3
- Walking Lunge: BW x 12 x 3
- Leg Extension: 100 x 12 x 3
- Ab Wheel: BW x 10 x 3

## Notes
- Progressive overload: Add 5 lbs to main lifts if all sets hit target reps at RPE < 8
- Deload next week if RPE consistently > 9
`;
}
