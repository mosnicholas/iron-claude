/**
 * Estimated 1RM Calculator
 *
 * Uses the Epley formula for calculating estimated one-rep max.
 * Unlike Brzycki (used in pr-calculator.ts), Epley is simpler and works well
 * for sets of 1-10 reps.
 *
 * Formula: weight × (1 + reps/30)
 * With RPE adjustment: weight × (1 + (reps + (10 - RPE))/30)
 */

/**
 * Compound lifts to track e1RM for
 */
export const COMPOUND_LIFTS = [
  "bench_press",
  "squat",
  "deadlift",
  "overhead_press",
  "barbell_row",
  "romanian_deadlift",
  "front_squat",
  "incline_bench",
  "weighted_pull_up",
  "weighted_chin_up",
] as const;

export type CompoundLift = (typeof COMPOUND_LIFTS)[number];

/**
 * Maximum reps for reliable e1RM calculation
 * Beyond 10 reps, the formula becomes unreliable
 */
export const MAX_REPS_FOR_E1RM = 10;

/**
 * Calculate estimated 1RM using the Epley formula
 *
 * @param weight - Weight lifted
 * @param reps - Number of reps completed
 * @returns Estimated 1RM, rounded to nearest integer
 */
export function calculateE1RM(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  if (reps === 1) return Math.round(weight);
  if (reps > MAX_REPS_FOR_E1RM) return 0; // Unreliable beyond 10 reps

  // Epley formula: weight × (1 + reps/30)
  return Math.round(weight * (1 + reps / 30));
}

/**
 * Calculate estimated 1RM with RPE adjustment
 *
 * RPE (Rate of Perceived Exertion) indicates how many reps were left in reserve.
 * RPE 10 = no reps left, RPE 9 = 1 rep left, etc.
 *
 * The adjustment accounts for reps in reserve:
 * Adjusted reps = actual reps + (10 - RPE)
 *
 * @param weight - Weight lifted
 * @param reps - Number of reps completed
 * @param rpe - Rate of Perceived Exertion (1-10)
 * @returns Estimated 1RM adjusted for RPE
 */
export function calculateE1RMWithRPE(weight: number, reps: number, rpe: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  if (reps > MAX_REPS_FOR_E1RM) return 0;

  // Clamp RPE to valid range
  const clampedRPE = Math.max(1, Math.min(10, rpe));

  // Calculate adjusted reps (reps + reps in reserve)
  const adjustedReps = reps + (10 - clampedRPE);

  // For single reps, still apply RPE adjustment
  if (reps === 1 && clampedRPE === 10) return Math.round(weight);

  // Adjusted Epley formula: weight × (1 + adjustedReps/30)
  return Math.round(weight * (1 + adjustedReps / 30));
}

/**
 * Calculate e1RM for a set, using RPE if available
 */
export function calculateSetE1RM(
  weight: number,
  reps: number,
  rpe?: number
): { e1rm: number; rpeAdjusted: boolean } {
  if (reps > MAX_REPS_FOR_E1RM) {
    return { e1rm: 0, rpeAdjusted: false };
  }

  if (rpe !== undefined && rpe >= 1 && rpe <= 10) {
    return {
      e1rm: calculateE1RMWithRPE(weight, reps, rpe),
      rpeAdjusted: true,
    };
  }

  return {
    e1rm: calculateE1RM(weight, reps),
    rpeAdjusted: false,
  };
}

/**
 * Normalize exercise name to canonical form for compound lift matching
 */
export function normalizeToCompoundLift(name: string): CompoundLift | null {
  const lower = name.toLowerCase().trim();

  const aliases: Record<string, CompoundLift> = {
    // Bench press variants
    "bench press": "bench_press",
    bench: "bench_press",
    "flat bench": "bench_press",
    "barbell bench": "bench_press",
    "bb bench": "bench_press",

    // Squat variants
    squat: "squat",
    squats: "squat",
    "back squat": "squat",
    "barbell squat": "squat",
    "bb squat": "squat",

    // Deadlift
    deadlift: "deadlift",
    deadlifts: "deadlift",
    dl: "deadlift",
    "conventional deadlift": "deadlift",

    // Overhead press
    "overhead press": "overhead_press",
    ohp: "overhead_press",
    press: "overhead_press",
    "shoulder press": "overhead_press",
    "military press": "overhead_press",

    // Barbell row
    "barbell row": "barbell_row",
    row: "barbell_row",
    "bent over row": "barbell_row",
    "bb row": "barbell_row",
    "pendlay row": "barbell_row",

    // Romanian deadlift
    rdl: "romanian_deadlift",
    "romanian deadlift": "romanian_deadlift",
    "stiff leg deadlift": "romanian_deadlift",

    // Front squat
    "front squat": "front_squat",
    "front squats": "front_squat",

    // Incline bench
    "incline bench": "incline_bench",
    "incline press": "incline_bench",
    "incline bench press": "incline_bench",

    // Weighted pull-up
    "weighted pull-up": "weighted_pull_up",
    "weighted pull-ups": "weighted_pull_up",
    "weighted pullup": "weighted_pull_up",
    "weighted pullups": "weighted_pull_up",

    // Weighted chin-up
    "weighted chin-up": "weighted_chin_up",
    "weighted chin-ups": "weighted_chin_up",
    "weighted chinup": "weighted_chin_up",
    "weighted chinups": "weighted_chin_up",
  };

  return aliases[lower] || null;
}

/**
 * Check if an exercise is a tracked compound lift
 */
export function isCompoundLift(exerciseName: string): boolean {
  return normalizeToCompoundLift(exerciseName) !== null;
}

/**
 * Format e1RM for display with optional comparison
 */
export function formatE1RMDisplay(
  exercise: string,
  currentE1RM: number,
  previousE1RM?: number
): string {
  const displayName = exercise.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  if (previousE1RM && previousE1RM > 0) {
    const diff = currentE1RM - previousE1RM;
    const sign = diff >= 0 ? "+" : "";
    return `${displayName} e1RM: ${currentE1RM} (${sign}${diff} from last session)`;
  }

  return `${displayName} e1RM: ${currentE1RM}`;
}
