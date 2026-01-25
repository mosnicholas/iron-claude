/**
 * PR Calculator
 * Simplified to core functions only.
 */

import type { PRRecord, PRsData } from '../storage/types.js';

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
    'bench press': 'bench_press', 'bench': 'bench_press',
    'squat': 'squat', 'squats': 'squat', 'back squat': 'squat',
    'deadlift': 'deadlift', 'dl': 'deadlift',
    'overhead press': 'overhead_press', 'ohp': 'overhead_press', 'press': 'overhead_press',
    'pull-up': 'weighted_pull_up', 'pull-ups': 'weighted_pull_up', 'pullups': 'weighted_pull_up',
    'barbell row': 'barbell_row', 'row': 'barbell_row',
    'rdl': 'romanian_deadlift', 'romanian deadlift': 'romanian_deadlift',
  };
  return aliases[lower] || lower.replace(/[^a-z0-9]+/g, '_');
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
    return { isPR: true, prType: 'weight', details: `First recorded: ${weight} x ${reps}` };
  }

  if (weight > existing.current.weight) {
    return { isPR: true, prType: 'weight', details: `New weight PR: ${weight}` };
  }

  if (est1RM > existing.current.estimated1RM) {
    return { isPR: true, prType: 'estimated_1rm', details: `New est 1RM: ${est1RM}` };
  }

  return { isPR: false, prType: null, details: '' };
}

/**
 * Parse PRs from YAML string
 */
export function parsePRsYaml(yamlContent: string): PRsData {
  const lines = yamlContent.split('\n');
  const prs: PRsData = {};
  let currentExercise: string | null = null;
  let inHistory = false;
  let currentRecord: Partial<PRRecord> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed) continue;

    if (!line.startsWith(' ') && trimmed.endsWith(':')) {
      currentExercise = trimmed.slice(0, -1);
      prs[currentExercise] = { current: {} as PRRecord, history: [] };
      inHistory = false;
      currentRecord = {};
      continue;
    }

    if (!currentExercise) continue;

    if (trimmed === 'current:') { inHistory = false; currentRecord = {}; continue; }
    if (trimmed === 'history:') { inHistory = true; continue; }

    const match = trimmed.match(/^-?\s*(\w+):\s*(.+)$/);
    if (match) {
      const [, key, value] = match;
      if (trimmed.startsWith('-')) {
        if (Object.keys(currentRecord).length > 0 && inHistory) {
          prs[currentExercise].history.push(currentRecord as PRRecord);
        }
        currentRecord = {};
      }

      const clean = value.replace(/['"]/g, '');
      if (key === 'weight' || key === 'reps') currentRecord[key] = parseFloat(clean);
      else if (key === 'estimated_1rm') currentRecord.estimated1RM = parseFloat(clean);
      else if (key === 'date') currentRecord.date = clean;
    }
  }

  if (currentExercise && Object.keys(currentRecord).length > 0) {
    if (inHistory) prs[currentExercise].history.push(currentRecord as PRRecord);
    else prs[currentExercise].current = currentRecord as PRRecord;
  }

  return prs;
}
