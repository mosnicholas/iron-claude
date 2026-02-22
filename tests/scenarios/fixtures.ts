/**
 * Test Fixtures
 *
 * Minimal, realistic data for scenario tests.
 * Known values so we can write deterministic assertions:
 * - Plan says Bench 175x5 → if user sends "bench 175x5", it matches plan
 * - PR for bench is 170 → 175x5 should trigger PR detection
 * - Profile establishes the athlete context
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

export const PRS_YAML = `# Personal Records
bench_press:
  weight: 170
  reps: 5
  date: "2026-02-15"
  estimated_1rm: 197
squat:
  weight: 225
  reps: 5
  date: "2026-02-10"
  estimated_1rm: 261
deadlift:
  weight: 275
  reps: 5
  date: "2026-02-08"
  estimated_1rm: 319
overhead_press:
  weight: 105
  reps: 5
  date: "2026-02-12"
  estimated_1rm: 122
`;

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
 * Build a weekly plan for the current week.
 * Uses day names so the plan works regardless of actual dates.
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
