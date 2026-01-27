/**
 * Fatigue Detection & Deload Recommendation System
 *
 * Tracks warning signs and recommends deloads before burnout:
 * - RPE creep: same weight/reps but RPE trending up over 2-3 sessions
 * - Missed reps: failing to hit planned reps
 * - Weeks since last deload (most need one every 4-6 weeks)
 *
 * Stores signals in analytics/fatigue-signals.yaml with a rolling fatigue score (1-10).
 * When score hits 7+, proactively suggests a deload.
 */

import type { WorkoutLog, WeeklyPlan, PlannedExercise, LoggedExercise } from "../storage/types.js";
import { RPEDataPoint, groupByExercise, isIncreasingTrend } from "./rpe-analyzer.js";
import { getWeightUnitLabel } from "./weight-config.js";

// ============================================================================
// Types
// ============================================================================

export interface FatigueSignal {
  type:
    | "rpe_creep"
    | "missed_reps"
    | "weeks_since_deload"
    | "high_average_rpe"
    | "declining_performance";
  exercise?: string;
  description: string;
  severity: "low" | "medium" | "high";
  data?: Record<string, number | string>;
  detectedAt: string;
}

export interface DeloadRecord {
  week: string;
  type: "planned" | "manual" | "recommended";
  reason?: string;
  markedAt: string;
}

export interface FatigueSignals {
  currentScore: number; // 1-10
  signals: FatigueSignal[];
  lastUpdated: string;
  weeksSinceDeload: number;
  lastDeload: DeloadRecord | null;
  deloadHistory: DeloadRecord[];
  dismissedWarnings: Array<{
    dismissedAt: string;
    reason?: string;
    fatigueScoreAtDismissal: number;
  }>;
}

export interface FatigueAnalysisResult {
  score: number;
  signals: FatigueSignal[];
  weeksSinceDeload: number;
  shouldRecommendDeload: boolean;
  recommendation?: string;
}

export interface RPECreepResult {
  exercise: string;
  weight: number;
  sessions: number;
  rpeStart: number;
  rpeEnd: number;
  creepAmount: number;
}

export interface MissedRepsResult {
  exercise: string;
  plannedReps: number;
  actualReps: number;
  deficit: number;
  date: string;
}

// ============================================================================
// Core Analysis Functions
// ============================================================================

/**
 * Analyze fatigue signals from workout data
 *
 * @param recentWorkouts - Last 2-4 weeks of workout logs
 * @param recentPlans - Last 2-4 weeks of plans (for missed reps comparison)
 * @param lastDeloadWeek - The week string of the last deload (e.g., "2026-W03")
 * @param currentWeek - The current week string (e.g., "2026-W05")
 */
export function analyzeFatigue(
  recentWorkouts: WorkoutLog[],
  recentPlans: WeeklyPlan[],
  lastDeloadWeek: string | null,
  currentWeek: string
): FatigueAnalysisResult {
  const signals: FatigueSignal[] = [];
  const now = new Date().toISOString();

  // 1. Calculate weeks since last deload
  const weeksSinceDeload = calculateWeeksSinceDeload(lastDeloadWeek, currentWeek);
  if (weeksSinceDeload >= 5) {
    signals.push({
      type: "weeks_since_deload",
      description: `${weeksSinceDeload} weeks since last deload (recommended every 4-6 weeks)`,
      severity: weeksSinceDeload >= 6 ? "high" : "medium",
      data: { weeks: weeksSinceDeload },
      detectedAt: now,
    });
  }

  // 2. Detect RPE creep
  const rpeCreepSignals = detectRPECreep(recentWorkouts);
  for (const creep of rpeCreepSignals) {
    const unit = getWeightUnitLabel();
    signals.push({
      type: "rpe_creep",
      exercise: creep.exercise,
      description: `${creep.exercise} at ${creep.weight} ${unit}: RPE increased from ${creep.rpeStart} to ${creep.rpeEnd} over ${creep.sessions} sessions`,
      severity: creep.creepAmount >= 1.5 ? "high" : creep.creepAmount >= 1 ? "medium" : "low",
      data: {
        weight: creep.weight,
        rpeStart: creep.rpeStart,
        rpeEnd: creep.rpeEnd,
        sessions: creep.sessions,
        creepAmount: creep.creepAmount,
      },
      detectedAt: now,
    });
  }

  // 3. Detect missed reps
  const missedRepsSignals = detectMissedReps(recentWorkouts, recentPlans);
  for (const missed of missedRepsSignals) {
    signals.push({
      type: "missed_reps",
      exercise: missed.exercise,
      description: `${missed.exercise}: hit ${missed.actualReps} reps vs ${missed.plannedReps} planned (${missed.deficit} short) on ${missed.date}`,
      severity: missed.deficit >= 3 ? "high" : missed.deficit >= 2 ? "medium" : "low",
      data: {
        plannedReps: missed.plannedReps,
        actualReps: missed.actualReps,
        deficit: missed.deficit,
        date: missed.date,
      },
      detectedAt: now,
    });
  }

  // 4. Check for high average RPE across recent sessions
  const avgRPE = calculateAverageRPE(recentWorkouts);
  if (avgRPE !== null && avgRPE > 8.5) {
    signals.push({
      type: "high_average_rpe",
      description: `Average RPE across recent sessions is ${avgRPE.toFixed(1)} (above 8.5 threshold)`,
      severity: avgRPE >= 9 ? "high" : "medium",
      data: { averageRPE: avgRPE },
      detectedAt: now,
    });
  }

  // 5. Calculate fatigue score (1-10)
  const score = calculateFatigueScore(signals, weeksSinceDeload, avgRPE);

  // 6. Generate recommendation if needed
  const shouldRecommendDeload = score >= 7;
  let recommendation: string | undefined;

  if (shouldRecommendDeload) {
    recommendation = generateDeloadRecommendation(score, signals, weeksSinceDeload);
  }

  return {
    score,
    signals,
    weeksSinceDeload,
    shouldRecommendDeload,
    recommendation,
  };
}

/**
 * Detect RPE creep: same weight/reps but RPE trending up over 2-3 sessions
 */
export function detectRPECreep(workouts: WorkoutLog[]): RPECreepResult[] {
  const results: RPECreepResult[] = [];

  // Extract all RPE data points from workouts
  const dataPoints: RPEDataPoint[] = [];
  for (const workout of workouts) {
    for (const exercise of workout.exercises) {
      for (const set of exercise.sets) {
        if (set.rpe !== undefined && typeof set.weight === "number") {
          dataPoints.push({
            date: workout.date,
            exercise: exercise.name.toLowerCase(),
            weight: set.weight,
            reps: set.reps,
            rpe: set.rpe,
            estimated1RM: 0, // Not needed for this analysis
          });
        }
      }
    }
  }

  // Group by exercise
  const byExercise = groupByExercise(dataPoints);

  for (const [exercise, points] of Object.entries(byExercise)) {
    // Group by weight within this exercise
    const byWeight: Record<number, RPEDataPoint[]> = {};
    for (const point of points) {
      if (!byWeight[point.weight]) {
        byWeight[point.weight] = [];
      }
      byWeight[point.weight].push(point);
    }

    // Check for RPE creep at each weight
    for (const [weightStr, weightPoints] of Object.entries(byWeight)) {
      if (weightPoints.length >= 2) {
        // Sort by date
        const sorted = [...weightPoints].sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
        );

        // Take last 2-3 sessions
        const recent = sorted.slice(-3);
        if (recent.length >= 2) {
          const rpeValues = recent.map((p) => p.rpe);

          // Check if RPE is trending up
          if (isIncreasingTrend(rpeValues)) {
            const creepAmount = rpeValues[rpeValues.length - 1] - rpeValues[0];
            if (creepAmount >= 0.5) {
              results.push({
                exercise,
                weight: Number(weightStr),
                sessions: recent.length,
                rpeStart: rpeValues[0],
                rpeEnd: rpeValues[rpeValues.length - 1],
                creepAmount,
              });
            }
          }
        }
      }
    }
  }

  return results;
}

/**
 * Detect missed reps: failing to hit planned reps
 */
export function detectMissedReps(workouts: WorkoutLog[], plans: WeeklyPlan[]): MissedRepsResult[] {
  const results: MissedRepsResult[] = [];

  // Build a map of planned exercises by date
  const plannedByDate: Record<string, PlannedExercise[]> = {};
  for (const plan of plans) {
    for (const day of plan.days) {
      if (day.exercises) {
        plannedByDate[day.date] = day.exercises;
      }
    }
  }

  // Compare actual vs planned for each workout
  for (const workout of workouts) {
    const planned = plannedByDate[workout.date];
    if (!planned) continue;

    for (const loggedExercise of workout.exercises) {
      // Find matching planned exercise (case-insensitive)
      const plannedExercise = planned.find(
        (p) => p.name.toLowerCase() === loggedExercise.name.toLowerCase()
      );
      if (!plannedExercise) continue;

      // Get planned reps (handle string formats like "5-6")
      const plannedReps = parseReps(plannedExercise.reps);
      if (plannedReps === null) continue;

      // Check if any set missed reps significantly
      const missedSets = findMissedRepSets(loggedExercise, plannedReps);
      for (const missed of missedSets) {
        if (missed.deficit >= 2) {
          // Only flag significant misses
          results.push({
            exercise: loggedExercise.name,
            plannedReps: missed.plannedReps,
            actualReps: missed.actualReps,
            deficit: missed.deficit,
            date: workout.date,
          });
        }
      }
    }
  }

  return results;
}

/**
 * Calculate average RPE across recent workouts
 */
export function calculateAverageRPE(workouts: WorkoutLog[]): number | null {
  const allRPEs: number[] = [];

  for (const workout of workouts) {
    for (const exercise of workout.exercises) {
      for (const set of exercise.sets) {
        if (set.rpe !== undefined && set.rpe > 0) {
          allRPEs.push(set.rpe);
        }
      }
    }
  }

  if (allRPEs.length === 0) return null;
  return allRPEs.reduce((a, b) => a + b, 0) / allRPEs.length;
}

/**
 * Calculate weeks since last deload
 */
export function calculateWeeksSinceDeload(
  lastDeloadWeek: string | null,
  currentWeek: string
): number {
  if (!lastDeloadWeek) {
    // No recorded deload, assume it's been a while
    return 8; // Default to 8 weeks if unknown
  }

  const lastWeekNum = parseWeekNumber(lastDeloadWeek);
  const currentWeekNum = parseWeekNumber(currentWeek);

  if (lastWeekNum === null || currentWeekNum === null) {
    return 8;
  }

  // Handle year boundaries
  const lastYear = parseInt(lastDeloadWeek.split("-W")[0]);
  const currentYear = parseInt(currentWeek.split("-W")[0]);

  if (currentYear > lastYear) {
    // Crossed a year boundary
    const weeksInLastYear = 52; // Simplification
    return currentWeekNum + (weeksInLastYear - lastWeekNum);
  }

  return currentWeekNum - lastWeekNum;
}

/**
 * Calculate fatigue score (1-10) from signals
 */
export function calculateFatigueScore(
  signals: FatigueSignal[],
  weeksSinceDeload: number,
  avgRPE: number | null
): number {
  let score = 1; // Base score

  // Weeks since deload contribution (0-3 points)
  if (weeksSinceDeload >= 6) {
    score += 3;
  } else if (weeksSinceDeload >= 5) {
    score += 2;
  } else if (weeksSinceDeload >= 4) {
    score += 1;
  }

  // RPE creep signals (0-3 points)
  const rpeCreepSignals = signals.filter((s) => s.type === "rpe_creep");
  const highSeverityCreep = rpeCreepSignals.filter((s) => s.severity === "high").length;
  const mediumSeverityCreep = rpeCreepSignals.filter((s) => s.severity === "medium").length;
  score += Math.min(3, highSeverityCreep * 1.5 + mediumSeverityCreep * 0.5);

  // Missed reps signals (0-2 points)
  const missedRepsSignals = signals.filter((s) => s.type === "missed_reps");
  const highSeverityMissed = missedRepsSignals.filter((s) => s.severity === "high").length;
  const mediumSeverityMissed = missedRepsSignals.filter((s) => s.severity === "medium").length;
  score += Math.min(2, highSeverityMissed * 1 + mediumSeverityMissed * 0.5);

  // High average RPE (0-2 points)
  if (avgRPE !== null) {
    if (avgRPE >= 9) {
      score += 2;
    } else if (avgRPE >= 8.5) {
      score += 1;
    }
  }

  // Cap at 10
  return Math.min(10, Math.round(score));
}

/**
 * Generate a human-friendly deload recommendation
 */
export function generateDeloadRecommendation(
  score: number,
  signals: FatigueSignal[],
  weeksSinceDeload: number
): string {
  const reasons: string[] = [];

  // Add specific reasons based on signals
  const rpeCreepSignals = signals.filter((s) => s.type === "rpe_creep");
  if (rpeCreepSignals.length > 0) {
    reasons.push("RPE creeping up on your lifts");
  }

  const missedRepsSignals = signals.filter((s) => s.type === "missed_reps");
  if (missedRepsSignals.length > 0) {
    reasons.push("missing planned reps");
  }

  if (weeksSinceDeload >= 5) {
    reasons.push(`been pushing hard for ${weeksSinceDeload} weeks`);
  }

  const highRPE = signals.find((s) => s.type === "high_average_rpe");
  if (highRPE) {
    reasons.push("average RPE running high");
  }

  // Build the message
  let message = `Fatigue indicators are elevated (score: ${score}/10)`;

  if (reasons.length > 0) {
    message += "—" + reasons.slice(0, 2).join(" and ");
  }

  message += ". Want a recovery week?";

  return message;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse week number from week string (e.g., "2026-W05" -> 5)
 */
function parseWeekNumber(weekStr: string): number | null {
  const match = weekStr.match(/\d{4}-W(\d{2})/);
  if (!match) return null;
  return parseInt(match[1], 10);
}

/**
 * Parse reps from plan format (handles "5", "5-6", etc.)
 */
function parseReps(reps: number | string): number | null {
  if (typeof reps === "number") return reps;

  // Handle range format like "5-6"
  const match = reps.match(/(\d+)/);
  if (match) return parseInt(match[1], 10);

  return null;
}

/**
 * Find sets where reps were missed
 */
function findMissedRepSets(
  logged: LoggedExercise,
  plannedReps: number
): Array<{ plannedReps: number; actualReps: number; deficit: number }> {
  const results: Array<{ plannedReps: number; actualReps: number; deficit: number }> = [];

  for (const set of logged.sets) {
    const deficit = plannedReps - set.reps;
    if (deficit > 0) {
      results.push({
        plannedReps,
        actualReps: set.reps,
        deficit,
      });
    }
  }

  return results;
}

// ============================================================================
// Fatigue Signals YAML Serialization
// ============================================================================

/**
 * Serialize fatigue signals to YAML format
 */
export function serializeFatigueSignals(data: FatigueSignals): string {
  const lines: string[] = [];

  lines.push("# Fatigue Detection Signals");
  lines.push(`# Last updated: ${data.lastUpdated}`);
  lines.push("");
  lines.push(`current_score: ${data.currentScore}`);
  lines.push(`weeks_since_deload: ${data.weeksSinceDeload}`);
  lines.push(`last_updated: "${data.lastUpdated}"`);
  lines.push("");

  // Last deload
  lines.push("last_deload:");
  if (data.lastDeload) {
    lines.push(`  week: "${data.lastDeload.week}"`);
    lines.push(`  type: "${data.lastDeload.type}"`);
    if (data.lastDeload.reason) {
      lines.push(`  reason: "${data.lastDeload.reason}"`);
    }
    lines.push(`  marked_at: "${data.lastDeload.markedAt}"`);
  } else {
    lines.push("  # No deload recorded");
  }
  lines.push("");

  // Current signals
  lines.push("signals:");
  if (data.signals.length === 0) {
    lines.push("  # No active fatigue signals");
  } else {
    for (const signal of data.signals) {
      lines.push(`  - type: "${signal.type}"`);
      if (signal.exercise) {
        lines.push(`    exercise: "${signal.exercise}"`);
      }
      lines.push(`    description: "${signal.description}"`);
      lines.push(`    severity: "${signal.severity}"`);
      lines.push(`    detected_at: "${signal.detectedAt}"`);
      if (signal.data) {
        lines.push("    data:");
        for (const [key, value] of Object.entries(signal.data)) {
          lines.push(`      ${key}: ${typeof value === "string" ? `"${value}"` : value}`);
        }
      }
    }
  }
  lines.push("");

  // Deload history
  lines.push("deload_history:");
  if (data.deloadHistory.length === 0) {
    lines.push("  # No deload history");
  } else {
    for (const deload of data.deloadHistory) {
      lines.push(`  - week: "${deload.week}"`);
      lines.push(`    type: "${deload.type}"`);
      if (deload.reason) {
        lines.push(`    reason: "${deload.reason}"`);
      }
      lines.push(`    marked_at: "${deload.markedAt}"`);
    }
  }
  lines.push("");

  // Dismissed warnings
  lines.push("dismissed_warnings:");
  if (data.dismissedWarnings.length === 0) {
    lines.push("  # No dismissed warnings");
  } else {
    for (const dismissed of data.dismissedWarnings) {
      lines.push(`  - dismissed_at: "${dismissed.dismissedAt}"`);
      if (dismissed.reason) {
        lines.push(`    reason: "${dismissed.reason}"`);
      }
      lines.push(`    fatigue_score_at_dismissal: ${dismissed.fatigueScoreAtDismissal}`);
    }
  }

  return lines.join("\n");
}

/**
 * Parse fatigue signals from YAML format
 * (Basic parser - handles the format we produce)
 */
export function parseFatigueSignals(yaml: string): FatigueSignals | null {
  try {
    const lines = yaml.split("\n");
    const data: FatigueSignals = {
      currentScore: 1,
      signals: [],
      lastUpdated: new Date().toISOString(),
      weeksSinceDeload: 0,
      lastDeload: null,
      deloadHistory: [],
      dismissedWarnings: [],
    };

    let currentSection = "";
    let currentItem: Record<string, unknown> | null = null;
    let currentData: Record<string, unknown> | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      // Top-level values
      if (trimmed.startsWith("current_score:")) {
        data.currentScore = parseInt(trimmed.split(":")[1].trim());
      } else if (trimmed.startsWith("weeks_since_deload:")) {
        data.weeksSinceDeload = parseInt(trimmed.split(":")[1].trim());
      } else if (trimmed.startsWith("last_updated:")) {
        data.lastUpdated = trimmed.split(":").slice(1).join(":").trim().replace(/"/g, "");
      }

      // Section markers
      else if (trimmed === "last_deload:") {
        currentSection = "last_deload";
        currentItem = {};
      } else if (trimmed === "signals:") {
        currentSection = "signals";
      } else if (trimmed === "deload_history:") {
        currentSection = "deload_history";
      } else if (trimmed === "dismissed_warnings:") {
        currentSection = "dismissed_warnings";
      } else if (trimmed === "data:") {
        currentData = {};
      }

      // List items
      else if (trimmed.startsWith("- ")) {
        // Save previous item if any
        if (currentItem && currentSection === "signals") {
          if (currentData) {
            currentItem.data = currentData;
            currentData = null;
          }
          data.signals.push(currentItem as unknown as FatigueSignal);
        } else if (currentItem && currentSection === "deload_history") {
          data.deloadHistory.push(currentItem as unknown as DeloadRecord);
        } else if (currentItem && currentSection === "dismissed_warnings") {
          data.dismissedWarnings.push(
            currentItem as unknown as FatigueSignals["dismissedWarnings"][0]
          );
        }

        currentItem = {};
        const keyValue = trimmed.substring(2);
        const colonIdx = keyValue.indexOf(":");
        if (colonIdx !== -1) {
          const key = keyValue.substring(0, colonIdx).trim();
          const value = keyValue
            .substring(colonIdx + 1)
            .trim()
            .replace(/"/g, "");
          currentItem[snakeToCamel(key)] = isNaN(Number(value)) ? value : Number(value);
        }
      }

      // Nested values
      else if (line.startsWith("    ") && currentItem) {
        const colonIdx = trimmed.indexOf(":");
        if (colonIdx !== -1) {
          const key = trimmed.substring(0, colonIdx).trim();
          const value = trimmed
            .substring(colonIdx + 1)
            .trim()
            .replace(/"/g, "");

          if (currentData !== null) {
            currentData[snakeToCamel(key)] = isNaN(Number(value)) ? value : Number(value);
          } else {
            currentItem[snakeToCamel(key)] = isNaN(Number(value)) ? value : Number(value);
          }
        }
      }

      // last_deload section values (2-space indent)
      else if (
        line.startsWith("  ") &&
        currentSection === "last_deload" &&
        !trimmed.startsWith("-")
      ) {
        const colonIdx = trimmed.indexOf(":");
        if (colonIdx !== -1) {
          const key = trimmed.substring(0, colonIdx).trim();
          const value = trimmed
            .substring(colonIdx + 1)
            .trim()
            .replace(/"/g, "");
          if (currentItem) {
            currentItem[snakeToCamel(key)] = isNaN(Number(value)) ? value : Number(value);
          }
        }
      }
    }

    // Save last item
    if (currentItem) {
      if (currentSection === "signals") {
        if (currentData) {
          currentItem.data = currentData;
        }
        data.signals.push(currentItem as unknown as FatigueSignal);
      } else if (currentSection === "deload_history") {
        data.deloadHistory.push(currentItem as unknown as DeloadRecord);
      } else if (currentSection === "dismissed_warnings") {
        data.dismissedWarnings.push(
          currentItem as unknown as FatigueSignals["dismissedWarnings"][0]
        );
      } else if (currentSection === "last_deload" && Object.keys(currentItem).length > 0) {
        data.lastDeload = currentItem as unknown as DeloadRecord;
      }
    }

    return data;
  } catch {
    return null;
  }
}

/**
 * Convert snake_case to camelCase
 */
function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Create empty/initial fatigue signals
 */
export function createInitialFatigueSignals(): FatigueSignals {
  return {
    currentScore: 1,
    signals: [],
    lastUpdated: new Date().toISOString(),
    weeksSinceDeload: 0,
    lastDeload: null,
    deloadHistory: [],
    dismissedWarnings: [],
  };
}

/**
 * Update fatigue signals with new analysis results
 */
export function updateFatigueSignals(
  existing: FatigueSignals,
  analysis: FatigueAnalysisResult
): FatigueSignals {
  return {
    ...existing,
    currentScore: analysis.score,
    signals: analysis.signals,
    weeksSinceDeload: analysis.weeksSinceDeload,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Mark a deload week
 */
export function markDeloadWeek(
  existing: FatigueSignals,
  week: string,
  type: DeloadRecord["type"],
  reason?: string
): FatigueSignals {
  const now = new Date().toISOString();
  const deloadRecord: DeloadRecord = {
    week,
    type,
    reason,
    markedAt: now,
  };

  return {
    ...existing,
    currentScore: Math.max(1, existing.currentScore - 3), // Reduce score after deload
    weeksSinceDeload: 0,
    lastDeload: deloadRecord,
    deloadHistory: [...existing.deloadHistory, deloadRecord],
    lastUpdated: now,
  };
}

/**
 * Dismiss a deload warning
 */
export function dismissDeloadWarning(existing: FatigueSignals, reason?: string): FatigueSignals {
  const now = new Date().toISOString();

  return {
    ...existing,
    dismissedWarnings: [
      ...existing.dismissedWarnings,
      {
        dismissedAt: now,
        reason,
        fatigueScoreAtDismissal: existing.currentScore,
      },
    ],
    lastUpdated: now,
  };
}
