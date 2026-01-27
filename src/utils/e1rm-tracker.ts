/**
 * e1RM Tracker
 *
 * Tracks estimated 1RM for compound lifts after each workout.
 * Stores history in analytics/e1rm-history.yaml and flags PRs.
 */

import type {
  LoggedExercise,
  E1RMHistoryData,
  ExerciseE1RMHistory,
  E1RMEntry,
} from "../storage/types.js";
import {
  calculateSetE1RM,
  normalizeToCompoundLift,
  formatE1RMDisplay,
  MAX_REPS_FOR_E1RM,
  type CompoundLift,
} from "./e1rm-calculator.js";

/**
 * Result of processing a workout for e1RM
 */
export interface E1RMWorkoutResult {
  /** Best e1RM for each compound lift in this session */
  sessionE1RMs: Record<CompoundLift, E1RMEntry>;
  /** e1RM PRs hit in this session */
  e1rmPRs: Array<{
    exercise: CompoundLift;
    newE1RM: number;
    previousE1RM: number;
    improvement: number;
  }>;
  /** Formatted summary for workout confirmation */
  summary: string[];
}

/**
 * Extract the best e1RM for each compound lift from a workout's exercises
 */
export function extractSessionE1RMs(exercises: LoggedExercise[]): Record<CompoundLift, E1RMEntry> {
  const sessionE1RMs: Record<string, E1RMEntry> = {};

  for (const exercise of exercises) {
    const compoundName = normalizeToCompoundLift(exercise.name);
    if (!compoundName) continue; // Not a tracked compound lift

    for (const set of exercise.sets) {
      const weight = typeof set.weight === "number" ? set.weight : parseFloat(String(set.weight));
      if (isNaN(weight) || weight <= 0) continue;
      if (set.reps > MAX_REPS_FOR_E1RM) continue; // Skip sets > 10 reps

      const { e1rm, rpeAdjusted } = calculateSetE1RM(weight, set.reps, set.rpe);
      if (e1rm <= 0) continue;

      // Keep the best e1RM for this exercise
      if (!sessionE1RMs[compoundName] || e1rm > sessionE1RMs[compoundName].e1rm) {
        sessionE1RMs[compoundName] = {
          e1rm,
          weight,
          reps: set.reps,
          rpe: set.rpe,
          rpeAdjusted,
        };
      }
    }
  }

  return sessionE1RMs as Record<CompoundLift, E1RMEntry>;
}

/**
 * Parse e1rm-history.yaml content into structured data
 */
export function parseE1RMHistory(yamlContent: string): E1RMHistoryData {
  const data: E1RMHistoryData = {};
  const lines = yamlContent.split("\n");
  let currentExercise: string | null = null;
  let inSessions = false;
  let inCurrentBest = false;
  let currentSession: Record<string, unknown> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Top-level exercise name
    if (!line.startsWith(" ") && trimmed.endsWith(":") && !trimmed.includes(": ")) {
      if (currentExercise && Object.keys(currentSession).length > 0) {
        // Save pending session
        if (inSessions && data[currentExercise]) {
          data[currentExercise].sessions.push(currentSession as ExerciseE1RMHistory["sessions"][0]);
        }
      }
      currentExercise = trimmed.slice(0, -1);
      data[currentExercise] = {
        exercise: currentExercise,
        sessions: [],
        currentBest: { e1rm: 0, date: "", weight: 0, reps: 0 },
      };
      inSessions = false;
      inCurrentBest = false;
      currentSession = {};
      continue;
    }

    if (!currentExercise) continue;

    // Section markers
    if (trimmed === "sessions:") {
      inSessions = true;
      inCurrentBest = false;
      continue;
    }
    if (trimmed === "current_best:" || trimmed === "currentBest:") {
      if (inSessions && Object.keys(currentSession).length > 0) {
        data[currentExercise].sessions.push(currentSession as ExerciseE1RMHistory["sessions"][0]);
        currentSession = {};
      }
      inSessions = false;
      inCurrentBest = true;
      continue;
    }

    // Parse key-value pairs
    const match = trimmed.match(/^-?\s*(\w+):\s*["']?([^"']+)["']?$/);
    if (match) {
      const [, key, value] = match;

      // New list item in sessions
      if (trimmed.startsWith("-") && inSessions) {
        if (Object.keys(currentSession).length > 0) {
          data[currentExercise].sessions.push(currentSession as ExerciseE1RMHistory["sessions"][0]);
        }
        currentSession = {};
      }

      // Parse value based on key
      const parsedValue = ["e1rm", "weight", "reps", "rpe"].includes(key)
        ? parseFloat(value)
        : value;

      if (inCurrentBest) {
        (data[currentExercise].currentBest as Record<string, unknown>)[key] = parsedValue;
      } else if (inSessions) {
        currentSession[key] = parsedValue;
      }
    }
  }

  // Save final pending session
  if (currentExercise && inSessions && Object.keys(currentSession).length > 0) {
    data[currentExercise].sessions.push(currentSession as ExerciseE1RMHistory["sessions"][0]);
  }

  return data;
}

/**
 * Serialize e1RM history data to YAML format
 */
export function serializeE1RMHistory(data: E1RMHistoryData): string {
  const lines: string[] = [
    "# Estimated 1RM History",
    "# Tracked using Epley formula: weight × (1 + reps/30)",
    "",
  ];

  const exercises = Object.keys(data).sort();

  for (const exercise of exercises) {
    const history = data[exercise];
    lines.push(`${exercise}:`);

    // Current best
    lines.push("  current_best:");
    lines.push(`    e1rm: ${history.currentBest.e1rm}`);
    lines.push(`    date: "${history.currentBest.date}"`);
    lines.push(`    weight: ${history.currentBest.weight}`);
    lines.push(`    reps: ${history.currentBest.reps}`);

    // Sessions (most recent first, limit to last 20)
    lines.push("  sessions:");
    const recentSessions = history.sessions.slice(-20).reverse();
    for (const session of recentSessions) {
      lines.push(`    - date: "${session.date}"`);
      lines.push(`      e1rm: ${session.e1rm}`);
      lines.push(`      weight: ${session.weight}`);
      lines.push(`      reps: ${session.reps}`);
      if (session.rpe !== undefined) {
        lines.push(`      rpe: ${session.rpe}`);
      }
      lines.push(`      workoutRef: "${session.workoutRef}"`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Get the previous e1RM for an exercise (for comparison)
 */
export function getPreviousE1RM(history: E1RMHistoryData, exercise: CompoundLift): number {
  const exerciseHistory = history[exercise];
  if (!exerciseHistory || exerciseHistory.sessions.length === 0) {
    return 0;
  }
  // Get the most recent session
  return exerciseHistory.sessions[exerciseHistory.sessions.length - 1]?.e1rm || 0;
}

/**
 * Get the best e1RM ever recorded for an exercise
 */
export function getBestE1RM(history: E1RMHistoryData, exercise: CompoundLift): number {
  const exerciseHistory = history[exercise];
  if (!exerciseHistory) return 0;
  return exerciseHistory.currentBest.e1rm;
}

/**
 * Process a completed workout and update e1RM tracking
 *
 * @param exercises - Logged exercises from the workout
 * @param date - Workout date (YYYY-MM-DD)
 * @param workoutRef - Reference to workout file (e.g., weeks/2025-W04/2025-01-24.md)
 * @param existingHistory - Current e1RM history data
 * @returns Updated history and workout result
 */
export function processWorkoutE1RM(
  exercises: LoggedExercise[],
  date: string,
  workoutRef: string,
  existingHistory: E1RMHistoryData
): { updatedHistory: E1RMHistoryData; result: E1RMWorkoutResult } {
  const sessionE1RMs = extractSessionE1RMs(exercises);
  const e1rmPRs: E1RMWorkoutResult["e1rmPRs"] = [];
  const summary: string[] = [];

  // Clone existing history
  const updatedHistory: E1RMHistoryData = JSON.parse(JSON.stringify(existingHistory));

  // Process each exercise e1RM
  for (const [exercise, entry] of Object.entries(sessionE1RMs)) {
    const compoundExercise = exercise as CompoundLift;
    const previousE1RM = getPreviousE1RM(existingHistory, compoundExercise);
    const bestE1RM = getBestE1RM(existingHistory, compoundExercise);

    // Initialize history for new exercises
    if (!updatedHistory[compoundExercise]) {
      updatedHistory[compoundExercise] = {
        exercise: compoundExercise,
        sessions: [],
        currentBest: { e1rm: 0, date: "", weight: 0, reps: 0 },
      };
    }

    // Add session entry
    updatedHistory[compoundExercise].sessions.push({
      date,
      e1rm: entry.e1rm,
      weight: entry.weight,
      reps: entry.reps,
      rpe: entry.rpe,
      workoutRef,
    });

    // Check for e1RM PR
    if (entry.e1rm > bestE1RM) {
      e1rmPRs.push({
        exercise: compoundExercise,
        newE1RM: entry.e1rm,
        previousE1RM: bestE1RM,
        improvement: entry.e1rm - bestE1RM,
      });

      // Update current best
      updatedHistory[compoundExercise].currentBest = {
        e1rm: entry.e1rm,
        date,
        weight: entry.weight,
        reps: entry.reps,
      };
    }

    // Add to summary with comparison to last session
    summary.push(formatE1RMDisplay(compoundExercise, entry.e1rm, previousE1RM));
  }

  return {
    updatedHistory,
    result: {
      sessionE1RMs,
      e1rmPRs,
      summary,
    },
  };
}

/**
 * Format e1RM PRs for celebration message
 */
export function formatE1RMPRCelebration(prs: E1RMWorkoutResult["e1rmPRs"]): string {
  if (prs.length === 0) return "";

  const lines = ["", "📈 **e1RM PRs!**"];

  for (const pr of prs) {
    const displayName = pr.exercise.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    lines.push(
      `• ${displayName}: ${pr.newE1RM} (+${pr.improvement} from previous best of ${pr.previousE1RM})`
    );
  }

  return lines.join("\n");
}

/**
 * Generate e1RM trend analysis for retrospectives
 */
export function generateE1RMTrends(history: E1RMHistoryData, weeksBack: number = 4): string {
  const lines: string[] = ["## e1RM Trends", ""];
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - weeksBack * 7);
  const cutoffStr = cutoffDate.toISOString().split("T")[0];

  const exercises = Object.keys(history).sort();
  let hasData = false;

  lines.push("| Exercise | Current e1RM | 4 Weeks Ago | Change |");
  lines.push("|----------|-------------|-------------|--------|");

  for (const exercise of exercises) {
    const exerciseHistory = history[exercise];
    if (!exerciseHistory || exerciseHistory.sessions.length === 0) continue;

    const currentE1RM = exerciseHistory.currentBest.e1rm;
    if (currentE1RM === 0) continue;

    // Find e1RM from ~4 weeks ago
    const oldSessions = exerciseHistory.sessions.filter((s) => s.date <= cutoffStr);
    const oldE1RM = oldSessions.length > 0 ? oldSessions[oldSessions.length - 1].e1rm : 0;

    const displayName = exercise.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

    if (oldE1RM > 0) {
      const change = currentE1RM - oldE1RM;
      const changeStr = change >= 0 ? `+${change}` : `${change}`;
      const arrow = change > 0 ? "↑" : change < 0 ? "↓" : "→";
      lines.push(`| ${displayName} | ${currentE1RM} | ${oldE1RM} | ${arrow} ${changeStr} |`);
      hasData = true;
    } else if (currentE1RM > 0) {
      lines.push(`| ${displayName} | ${currentE1RM} | — | New |`);
      hasData = true;
    }
  }

  if (!hasData) {
    return "";
  }

  lines.push("");
  return lines.join("\n");
}
