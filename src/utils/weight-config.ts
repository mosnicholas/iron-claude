/**
 * Weight unit configuration
 *
 * Configurable via WEIGHT_UNIT env var (lbs or kg)
 * Defaults to lbs for backwards compatibility
 */

export type WeightUnit = "lbs" | "kg";

// lbs to kg conversion factor
const LBS_TO_KG = 0.453592;

/**
 * Get the configured weight unit
 */
export function getWeightUnit(): WeightUnit {
  const envUnit = process.env.WEIGHT_UNIT?.toLowerCase();
  if (envUnit === "kg") return "kg";
  return "lbs"; // default
}

/**
 * Get the weight unit label for display
 * (Alias for getWeightUnit - useful when the intent is display formatting)
 */
export const getWeightUnitLabel = getWeightUnit;

/**
 * Convert weight to the configured unit (for display)
 * Input is assumed to be in lbs (internal storage format)
 */
export function toDisplayWeight(lbsWeight: number): number {
  if (getWeightUnit() === "kg") {
    return Math.round(lbsWeight * LBS_TO_KG * 10) / 10;
  }
  return lbsWeight;
}

/**
 * Convert from display unit to internal (lbs)
 */
export function fromDisplayWeight(displayWeight: number): number {
  if (getWeightUnit() === "kg") {
    // kg to lbs: divide by the lbs-to-kg factor
    return Math.round((displayWeight / LBS_TO_KG) * 10) / 10;
  }
  return displayWeight;
}

/**
 * Plate milestones in lbs (canonical) and kg equivalents
 * These are the standard "plate club" weights
 */
export const PLATE_MILESTONES_LBS: Record<string, number[]> = {
  bench_press: [135, 185, 225, 275, 315, 365, 405],
  squat: [135, 185, 225, 275, 315, 365, 405, 455, 495, 545],
  deadlift: [135, 225, 315, 405, 495, 585, 635],
  overhead_press: [95, 135, 185, 225],
};

// Kg milestones (20kg plates = ~45 lbs)
export const PLATE_MILESTONES_KG: Record<string, number[]> = {
  bench_press: [60, 80, 100, 120, 140, 160, 180],
  squat: [60, 80, 100, 120, 140, 160, 180, 200, 220, 240],
  deadlift: [60, 100, 140, 180, 220, 260, 280],
  overhead_press: [40, 60, 80, 100],
};

/**
 * Get plate milestones for the configured unit
 */
export function getPlateMilestones(): Record<string, number[]> {
  return getWeightUnit() === "kg" ? PLATE_MILESTONES_KG : PLATE_MILESTONES_LBS;
}

/**
 * Milestone names based on weight unit
 */
export function getMilestoneNames(): Record<number, string> {
  if (getWeightUnit() === "kg") {
    return {
      40: "Green plate club",
      60: "One plate club",
      80: "One plate + 10s",
      100: "Two plate club",
      120: "Two plate + 10s",
      140: "Three plate club",
      160: "Three plate + 10s",
      180: "Four plate club",
      200: "Four plate + 10s",
      220: "Five plate club",
      240: "Five plate + 10s",
      260: "Six plate club",
      280: "Six plate + 10s",
    };
  }
  return {
    95: "Green plate club",
    135: "One plate club",
    185: "One plate + 25s",
    225: "Two plate club",
    275: "Two plate + 25s",
    315: "Three plate club",
    365: "Three plate + 25s",
    405: "Four plate club",
    455: "Four plate + 25s",
    495: "Five plate club",
    545: "Five plate + 25s",
    585: "Six plate club",
    635: "Six plate + 25s",
  };
}
