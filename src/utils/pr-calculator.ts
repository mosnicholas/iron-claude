/**
 * PR Calculator
 * Simplified to core functions only.
 */

import type { PRRecord, PRsData } from "../storage/types.js";

/**
 * Estimate 1RM using the Brzycki formula
 */
export function calculate1RM(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return 0;
  if (reps === 1) return weight;
  if (reps > 10) return Math.round(weight * (1 + reps / 30));
  return Math.round(weight * (36 / (37 - reps)));
}

/**
 * Normalize exercise name to canonical form
 */
function normalizeExerciseName(name: string): string {
  const lower = name.toLowerCase().trim();
  const aliases: Record<string, string> = {
    "bench press": "bench_press",
    bench: "bench_press",
    squat: "squat",
    squats: "squat",
    "back squat": "squat",
    deadlift: "deadlift",
    dl: "deadlift",
    "overhead press": "overhead_press",
    ohp: "overhead_press",
    press: "overhead_press",
    "pull-up": "weighted_pull_up",
    "pull-ups": "weighted_pull_up",
    pullups: "weighted_pull_up",
    "barbell row": "barbell_row",
    row: "barbell_row",
    rdl: "romanian_deadlift",
    "romanian deadlift": "romanian_deadlift",
  };
  return aliases[lower] || lower.replace(/[^a-z0-9]+/g, "_");
}

/**
 * Check if a set is a potential PR
 */
export function isPotentialPR(
  currentPRs: PRsData,
  exerciseName: string,
  weight: number,
  reps: number
): { isPR: boolean; prType: string | null; details: string } {
  const name = normalizeExerciseName(exerciseName);
  const est1RM = calculate1RM(weight, reps);
  const existing = currentPRs[name];

  if (!existing) {
    return { isPR: true, prType: "weight", details: `First recorded: ${weight} x ${reps}` };
  }

  if (weight > existing.current.weight) {
    return { isPR: true, prType: "weight", details: `New weight PR: ${weight}` };
  }

  if (est1RM > existing.current.estimated1RM) {
    return { isPR: true, prType: "estimated_1rm", details: `New est 1RM: ${est1RM}` };
  }

  return { isPR: false, prType: null, details: "" };
}

/**
 * Parse PRs from YAML string
 */
export function parsePRsYaml(yamlContent: string): PRsData {
  const lines = yamlContent.split("\n");
  const prs: PRsData = {};
  let currentExercise: string | null = null;
  let inHistory = false;
  let currentRecord: Partial<PRRecord> = {};

  function saveCurrentRecord(): void {
    if (!currentExercise || Object.keys(currentRecord).length === 0) return;

    if (inHistory) {
      prs[currentExercise].history.push(currentRecord as PRRecord);
    } else {
      prs[currentExercise].current = currentRecord as PRRecord;
    }
    currentRecord = {};
  }

  function parseValue(key: string, rawValue: string): void {
    const value = rawValue.replace(/['"]/g, "");

    switch (key) {
      case "weight":
      case "reps":
        currentRecord[key] = parseFloat(value);
        break;
      case "estimated_1rm":
        currentRecord.estimated1RM = parseFloat(value);
        break;
      case "date":
        currentRecord.date = value;
        break;
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (trimmed.startsWith("#") || !trimmed) continue;

    // Top-level exercise name (no leading whitespace, ends with colon)
    if (!line.startsWith(" ") && trimmed.endsWith(":")) {
      saveCurrentRecord();
      currentExercise = trimmed.slice(0, -1);
      prs[currentExercise] = { current: {} as PRRecord, history: [] };
      inHistory = false;
      continue;
    }

    if (!currentExercise) continue;

    // Section markers
    if (trimmed === "current:") {
      saveCurrentRecord();
      inHistory = false;
      continue;
    }
    if (trimmed === "history:") {
      saveCurrentRecord();
      inHistory = true;
      continue;
    }

    // Key-value pairs
    const match = trimmed.match(/^-?\s*(\w+):\s*(.+)$/);
    if (match) {
      const [, key, value] = match;

      // New list item in history section
      if (trimmed.startsWith("-") && inHistory) {
        saveCurrentRecord();
      }

      parseValue(key, value);
    }
  }

  // Save any remaining record
  saveCurrentRecord();

  return prs;
}
