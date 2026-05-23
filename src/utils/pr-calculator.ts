/**
 * Brzycki 1RM estimator. Used by `complete_workout` when the model passes
 * `prs_hit` so we can populate `prs.estimated_1rm` deterministically.
 */
export function calculate1RM(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return 0;
  if (reps === 1) return weight;
  if (reps > 10) return Math.round(weight * (1 + reps / 30));
  return Math.round(weight * (36 / (37 - reps)));
}
