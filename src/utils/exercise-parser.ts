/**
 * Exercise Parser
 *
 * Parses natural language workout inputs into structured data.
 * Handles various formats people use to log exercises.
 */

import type { ParsedExercise, ParsedSet } from '../storage/types.js';

// Common exercise name aliases
const EXERCISE_ALIASES: Record<string, string> = {
  'bench': 'Bench Press',
  'bp': 'Bench Press',
  'flat bench': 'Bench Press',
  'incline': 'Incline Press',
  'incline bench': 'Incline Bench Press',
  'incline db': 'Incline DB Press',
  'ohp': 'Overhead Press',
  'press': 'Overhead Press',
  'military': 'Military Press',
  'military press': 'Military Press',
  'squat': 'Squat',
  'squats': 'Squat',
  'back squat': 'Back Squat',
  'front squat': 'Front Squat',
  'dl': 'Deadlift',
  'deadlift': 'Deadlift',
  'rdl': 'Romanian Deadlift',
  'romanian': 'Romanian Deadlift',
  'pull-up': 'Pull-up',
  'pull-ups': 'Pull-up',
  'pullup': 'Pull-up',
  'pullups': 'Pull-up',
  'chin-up': 'Chin-up',
  'chin-ups': 'Chin-up',
  'chinup': 'Chin-up',
  'chinups': 'Chin-up',
  'row': 'Barbell Row',
  'rows': 'Barbell Row',
  'bb row': 'Barbell Row',
  'barbell row': 'Barbell Row',
  'db row': 'Dumbbell Row',
  'dumbbell row': 'Dumbbell Row',
  'lat raise': 'Lateral Raise',
  'lateral raise': 'Lateral Raise',
  'lateral raises': 'Lateral Raise',
  'face pull': 'Face Pull',
  'face pulls': 'Face Pull',
  'curl': 'Bicep Curl',
  'curls': 'Bicep Curl',
  'bicep curl': 'Bicep Curl',
  'hammer curl': 'Hammer Curl',
  'hammer curls': 'Hammer Curl',
  'tricep': 'Tricep Extension',
  'triceps': 'Tricep Extension',
  'pushdown': 'Tricep Pushdown',
  'pushdowns': 'Tricep Pushdown',
  'tricep pushdown': 'Tricep Pushdown',
  'dip': 'Dips',
  'dips': 'Dips',
  'lunge': 'Lunges',
  'lunges': 'Lunges',
  'walking lunge': 'Walking Lunges',
  'walking lunges': 'Walking Lunges',
  'leg press': 'Leg Press',
  'calf raise': 'Calf Raises',
  'calf raises': 'Calf Raises',
  'hs': 'Handstand',
  'handstand': 'Handstand',
  'hspu': 'Handstand Push-up',
  'handstand pushup': 'Handstand Push-up',
};

/**
 * Normalize an exercise name using aliases
 */
export function normalizeExerciseName(name: string): string {
  const lower = name.toLowerCase().trim();
  return EXERCISE_ALIASES[lower] || titleCase(name);
}

/**
 * Convert string to title case
 */
function titleCase(str: string): string {
  return str
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Parse a weight string into a number or formatted string
 * Handles: "175", "175lbs", "BW", "+45", "20s" (dumbbells)
 */
export function parseWeight(weight: string): number | string {
  const trimmed = weight.trim().toLowerCase();

  // Bodyweight
  if (trimmed === 'bw' || trimmed === 'bodyweight') {
    return 'BW';
  }

  // Added weight (for pull-ups, dips, etc.)
  if (trimmed.startsWith('+')) {
    const num = parseFloat(trimmed.slice(1).replace(/lbs?|kg/gi, ''));
    return isNaN(num) ? trimmed : `+${num}`;
  }

  // Dumbbell notation (e.g., "20s" means pair of 20s)
  if (trimmed.endsWith('s') && !trimmed.endsWith('lbs')) {
    const num = parseFloat(trimmed.slice(0, -1));
    return isNaN(num) ? trimmed : num;
  }

  // Regular weight
  const num = parseFloat(trimmed.replace(/lbs?|kg/gi, ''));
  return isNaN(num) ? trimmed : num;
}

/**
 * Parse reps - handles numbers and time-based (e.g., "30s")
 */
export function parseReps(reps: string): number | string {
  const trimmed = reps.trim().toLowerCase();

  // Time-based (seconds)
  if (trimmed.endsWith('s') || trimmed.endsWith('sec')) {
    return trimmed.endsWith('sec') ? trimmed : trimmed;
  }

  // Regular reps
  const num = parseInt(trimmed, 10);
  return isNaN(num) ? trimmed : num;
}

/**
 * Parse RPE (Rate of Perceived Exertion)
 */
export function parseRPE(str: string): number | undefined {
  // Look for @RPE or @number pattern
  const match = str.match(/@\s*(?:rpe\s*)?(\d+(?:\.\d+)?)/i);
  if (match) {
    const rpe = parseFloat(match[1]);
    if (rpe >= 1 && rpe <= 10) {
      return rpe;
    }
  }
  return undefined;
}

/**
 * Parse a workout entry string into structured data
 *
 * Supported formats:
 * - "bench 175x5" -> Bench Press, 175 lbs, 5 reps, 1 set
 * - "175x5, 175x5, 170x6" -> 3 sets (inferred from context)
 * - "squats 225 5x5" -> Squats, 225 lbs, 5 sets of 5 reps
 * - "pull-ups +45 x 6" -> Weighted pull-ups, +45 lbs added, 6 reps
 * - "3x12 lateral raises 20s" -> Lateral raises, 20 lb DBs, 3 sets of 12
 * - "OHP 115: 6, 5, 5 @8" -> OHP, 115 lbs, 3 sets (6,5,5 reps), RPE 8
 * - "HS: 30s, 25s" -> Handstand holds, 2 sets (30s, 25s)
 */
export function parseWorkoutEntry(input: string): ParsedExercise | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Extract RPE first
  const rpe = parseRPE(trimmed);
  const withoutRPE = trimmed.replace(/@\s*(?:rpe\s*)?\d+(?:\.\d+)?/gi, '').trim();

  // Try different parsing patterns
  let result: ParsedExercise | null = null;

  // Pattern 1: "Exercise Weight: reps, reps, reps" (e.g., "OHP 115: 6, 5, 5")
  result = parseColonFormat(withoutRPE);
  if (result) {
    result.rpe = rpe;
    return result;
  }

  // Pattern 2: "Exercise WeightxReps" (e.g., "bench 175x5")
  result = parseCompactFormat(withoutRPE);
  if (result) {
    result.rpe = rpe;
    return result;
  }

  // Pattern 3: "SetsxReps Exercise Weight" (e.g., "3x12 lateral raises 20s")
  result = parseSetsFirstFormat(withoutRPE);
  if (result) {
    result.rpe = rpe;
    return result;
  }

  // Pattern 4: "Exercise Weight SetsxReps" (e.g., "squats 225 5x5")
  result = parseWeightSetsFormat(withoutRPE);
  if (result) {
    result.rpe = rpe;
    return result;
  }

  // Pattern 5: Continuation line "175x5, 175x5, 170x6" (multiple sets, no exercise name)
  result = parseMultipleSets(withoutRPE);
  if (result) {
    result.rpe = rpe;
    return result;
  }

  return null;
}

/**
 * Parse "Exercise Weight: reps, reps, reps" format
 */
function parseColonFormat(input: string): ParsedExercise | null {
  const match = input.match(/^(.+?)\s+([\d.]+|BW|\+[\d.]+)\s*:\s*(.+)$/i);
  if (!match) return null;

  const [, exercisePart, weightStr, repsPart] = match;
  const exerciseName = normalizeExerciseName(exercisePart);
  const weight = parseWeight(weightStr);

  // Parse comma-separated reps
  const repStrings = repsPart.split(/[,\s]+/).filter(Boolean);
  const sets: ParsedSet[] = repStrings.map(repStr => ({
    reps: parseReps(repStr) as number,
    weight,
  }));

  return {
    name: exerciseName,
    weight,
    sets,
  };
}

/**
 * Parse "Exercise WeightxReps" or "Exercise Weight x Reps" format
 */
function parseCompactFormat(input: string): ParsedExercise | null {
  // Match patterns like "bench 175x5" or "pull-ups +45 x 6"
  const match = input.match(/^(.+?)\s+([\d.]+|BW|\+[\d.]+)\s*x\s*(\d+)$/i);
  if (!match) return null;

  const [, exercisePart, weightStr, repsStr] = match;
  const exerciseName = normalizeExerciseName(exercisePart);
  const weight = parseWeight(weightStr);
  const reps = parseInt(repsStr, 10);

  return {
    name: exerciseName,
    weight,
    sets: [{ reps, weight }],
  };
}

/**
 * Parse "SetsxReps Exercise Weight" format
 */
function parseSetsFirstFormat(input: string): ParsedExercise | null {
  const match = input.match(/^(\d+)\s*x\s*(\d+)\s+(.+?)\s+([\d.]+s?|BW|\+[\d.]+)$/i);
  if (!match) return null;

  const [, setsStr, repsStr, exercisePart, weightStr] = match;
  const exerciseName = normalizeExerciseName(exercisePart);
  const weight = parseWeight(weightStr);
  const setCount = parseInt(setsStr, 10);
  const reps = parseInt(repsStr, 10);

  const sets: ParsedSet[] = Array(setCount).fill(null).map(() => ({
    reps,
    weight,
  }));

  return {
    name: exerciseName,
    weight,
    sets,
  };
}

/**
 * Parse "Exercise Weight SetsxReps" format
 */
function parseWeightSetsFormat(input: string): ParsedExercise | null {
  const match = input.match(/^(.+?)\s+([\d.]+|BW|\+[\d.]+)\s+(\d+)\s*x\s*(\d+)$/i);
  if (!match) return null;

  const [, exercisePart, weightStr, setsStr, repsStr] = match;
  const exerciseName = normalizeExerciseName(exercisePart);
  const weight = parseWeight(weightStr);
  const setCount = parseInt(setsStr, 10);
  const reps = parseInt(repsStr, 10);

  const sets: ParsedSet[] = Array(setCount).fill(null).map(() => ({
    reps,
    weight,
  }));

  return {
    name: exerciseName,
    weight,
    sets,
  };
}

/**
 * Parse multiple sets without exercise name (continuation)
 * "175x5, 175x5, 170x6"
 */
function parseMultipleSets(input: string): ParsedExercise | null {
  // Check if it looks like multiple WeightxReps
  const setPattern = /([\d.]+|BW|\+[\d.]+)\s*x\s*(\d+)/gi;
  const matches = [...input.matchAll(setPattern)];

  if (matches.length === 0) return null;

  const sets: ParsedSet[] = matches.map(match => ({
    reps: parseInt(match[2], 10),
    weight: parseWeight(match[1]),
  }));

  // Use the first weight as the "main" weight
  const weight = sets[0].weight;

  return {
    name: '', // No exercise name - this is a continuation
    weight,
    sets,
  };
}

/**
 * Check if input looks like a workout log entry
 */
export function looksLikeWorkoutEntry(input: string): boolean {
  const trimmed = input.trim().toLowerCase();

  // Contains x pattern (weight x reps)
  if (/\d+\s*x\s*\d+/.test(trimmed)) return true;

  // Contains colon pattern (exercise: reps)
  if (/:\s*\d+/.test(trimmed)) return true;

  // Starts with a known exercise name
  for (const alias of Object.keys(EXERCISE_ALIASES)) {
    if (trimmed.startsWith(alias + ' ') || trimmed.startsWith(alias + ':')) {
      return true;
    }
  }

  return false;
}

/**
 * Parse multiple workout entries (one per line or comma-separated)
 */
export function parseMultipleEntries(input: string): ParsedExercise[] {
  const lines = input.split(/[\n;]+/).filter(line => line.trim());
  const results: ParsedExercise[] = [];

  for (const line of lines) {
    const parsed = parseWorkoutEntry(line);
    if (parsed) {
      results.push(parsed);
    }
  }

  return results;
}

/**
 * Format a parsed exercise back to a human-readable string
 */
export function formatParsedExercise(exercise: ParsedExercise): string {
  const { name, sets, rpe } = exercise;

  // Format sets
  const setsStr = sets.map(s => {
    const weightStr = typeof s.weight === 'number' ? s.weight.toString() : s.weight;
    return `${weightStr} x ${s.reps}`;
  }).join(', ');

  let result = name ? `${name}: ${setsStr}` : setsStr;

  if (rpe !== undefined) {
    result += ` @${rpe}`;
  }

  return result;
}
