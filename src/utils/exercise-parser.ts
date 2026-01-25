/**
 * Exercise Parser
 * Parses natural language workout inputs into structured data.
 */

import type { ParsedExercise } from '../storage/types.js';

const EXERCISE_ALIASES: Record<string, string> = {
  'bench': 'Bench Press', 'bp': 'Bench Press',
  'ohp': 'Overhead Press', 'press': 'Overhead Press',
  'squat': 'Squat', 'squats': 'Squat',
  'dl': 'Deadlift', 'deadlift': 'Deadlift',
  'rdl': 'Romanian Deadlift',
  'pull-up': 'Pull-up', 'pull-ups': 'Pull-up', 'pullups': 'Pull-up',
  'chin-up': 'Chin-up', 'chin-ups': 'Chin-up',
  'row': 'Barbell Row', 'rows': 'Barbell Row',
  'dips': 'Dips', 'dip': 'Dips',
  'curl': 'Bicep Curl', 'curls': 'Bicep Curl',
  'hs': 'Handstand', 'hspu': 'Handstand Push-up',
};

function titleCase(str: string): string {
  return str.toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function normalizeExerciseName(name: string): string {
  return EXERCISE_ALIASES[name.toLowerCase().trim()] || titleCase(name);
}

export function parseWeight(weight: string): number | string {
  const w = weight.trim().toLowerCase();
  if (w === 'bw' || w === 'bodyweight') return 'BW';
  if (w.startsWith('+')) return `+${parseFloat(w.slice(1).replace(/lbs?|kg/gi, ''))}`;
  const num = parseFloat(w.replace(/lbs?|kg|s$/gi, ''));
  return isNaN(num) ? w : num;
}

function parseRPE(str: string): number | undefined {
  const match = str.match(/@\s*(?:rpe\s*)?(\d+(?:\.\d+)?)/i);
  return match ? parseFloat(match[1]) : undefined;
}

/**
 * Parse a workout entry string into structured data
 */
export function parseWorkoutEntry(input: string): ParsedExercise | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const rpe = parseRPE(trimmed);
  const clean = trimmed.replace(/@\s*(?:rpe\s*)?\d+(?:\.\d+)?/gi, '').trim();

  // Pattern: "Exercise Weight: reps, reps, reps"
  let match = clean.match(/^(.+?)\s+([\d.]+|BW|\+[\d.]+)\s*:\s*(.+)$/i);
  if (match) {
    const [, ex, wt, reps] = match;
    const weight = parseWeight(wt);
    return {
      name: normalizeExerciseName(ex),
      weight,
      sets: reps.split(/[,\s]+/).filter(Boolean).map(r => ({ reps: parseInt(r) || 0, weight })),
      rpe,
    };
  }

  // Pattern: "Exercise WeightxReps"
  match = clean.match(/^(.+?)\s+([\d.]+|BW|\+[\d.]+)\s*x\s*(\d+)$/i);
  if (match) {
    const [, ex, wt, reps] = match;
    const weight = parseWeight(wt);
    return { name: normalizeExerciseName(ex), weight, sets: [{ reps: parseInt(reps), weight }], rpe };
  }

  // Pattern: "SetsxReps Exercise Weight"
  match = clean.match(/^(\d+)\s*x\s*(\d+)\s+(.+?)\s+([\d.]+s?|BW|\+[\d.]+)$/i);
  if (match) {
    const [, sets, reps, ex, wt] = match;
    const weight = parseWeight(wt);
    return {
      name: normalizeExerciseName(ex),
      weight,
      sets: Array(parseInt(sets)).fill(null).map(() => ({ reps: parseInt(reps), weight })),
      rpe,
    };
  }

  // Pattern: "Exercise Weight SetsxReps"
  match = clean.match(/^(.+?)\s+([\d.]+|BW|\+[\d.]+)\s+(\d+)\s*x\s*(\d+)$/i);
  if (match) {
    const [, ex, wt, sets, reps] = match;
    const weight = parseWeight(wt);
    return {
      name: normalizeExerciseName(ex),
      weight,
      sets: Array(parseInt(sets)).fill(null).map(() => ({ reps: parseInt(reps), weight })),
      rpe,
    };
  }

  // Pattern: Multiple sets "175x5, 175x5, 170x6"
  const setMatches = [...clean.matchAll(/([\d.]+|BW|\+[\d.]+)\s*x\s*(\d+)/gi)];
  if (setMatches.length > 0) {
    const sets = setMatches.map(m => ({ reps: parseInt(m[2]), weight: parseWeight(m[1]) }));
    return { name: '', weight: sets[0].weight, sets, rpe };
  }

  return null;
}
