/**
 * PR Calculator
 *
 * Handles PR detection, 1RM estimation, and PR history management.
 */

import type { PRRecord, PRsData, LoggedExercise } from '../storage/types.js';

/**
 * Estimate 1RM using the Brzycki formula
 * 1RM = weight × (36 / (37 - reps))
 *
 * Valid for reps 1-10, becomes less accurate above 10 reps
 */
export function calculate1RM(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return 0;
  if (reps === 1) return weight;
  if (reps > 10) {
    // Use a more conservative estimate for high rep sets
    return Math.round(weight * (1 + reps / 30));
  }
  return Math.round(weight * (36 / (37 - reps)));
}

/**
 * Calculate estimated weight for a target rep count given 1RM
 */
export function calculateWeightForReps(oneRM: number, targetReps: number): number {
  if (targetReps <= 0 || oneRM <= 0) return 0;
  if (targetReps === 1) return oneRM;
  // Inverse of Brzycki formula
  return Math.round(oneRM * ((37 - targetReps) / 36));
}

/**
 * Get rep percentage of 1RM
 * Useful for programming
 */
export function getRepPercentage(reps: number): number {
  // Standard percentage chart
  const percentages: Record<number, number> = {
    1: 100,
    2: 95,
    3: 93,
    4: 90,
    5: 87,
    6: 85,
    7: 83,
    8: 80,
    9: 77,
    10: 75,
  };

  if (reps in percentages) {
    return percentages[reps];
  }

  // Estimate for higher reps
  if (reps > 10) {
    return Math.max(50, 75 - (reps - 10) * 2);
  }

  return 100;
}

/**
 * Normalize exercise name for PR tracking
 * Converts variations to base exercise names
 */
export function normalizePRExerciseName(name: string): string {
  const lower = name.toLowerCase().trim();

  // Map variations to canonical names
  const canonicalNames: Record<string, string> = {
    'bench press': 'bench_press',
    'bench': 'bench_press',
    'flat bench': 'bench_press',
    'barbell bench': 'bench_press',
    'squat': 'squat',
    'squats': 'squat',
    'back squat': 'squat',
    'barbell squat': 'squat',
    'deadlift': 'deadlift',
    'conventional deadlift': 'deadlift',
    'overhead press': 'overhead_press',
    'ohp': 'overhead_press',
    'military press': 'overhead_press',
    'press': 'overhead_press',
    'pull-up': 'weighted_pull_up',
    'pull-ups': 'weighted_pull_up',
    'pullup': 'weighted_pull_up',
    'pullups': 'weighted_pull_up',
    'weighted pull-up': 'weighted_pull_up',
    'weighted pull-ups': 'weighted_pull_up',
    'chin-up': 'weighted_chin_up',
    'chin-ups': 'weighted_chin_up',
    'weighted chin-up': 'weighted_chin_up',
    'barbell row': 'barbell_row',
    'row': 'barbell_row',
    'bent over row': 'barbell_row',
    'romanian deadlift': 'romanian_deadlift',
    'rdl': 'romanian_deadlift',
    'front squat': 'front_squat',
    'incline bench': 'incline_bench',
    'incline press': 'incline_bench',
    'incline bench press': 'incline_bench',
    'dumbbell row': 'dumbbell_row',
    'db row': 'dumbbell_row',
  };

  return canonicalNames[lower] || lower.replace(/[^a-z0-9]+/g, '_');
}

/**
 * Check if a set is a potential PR
 */
export function isPotentialPR(
  currentPRs: PRsData,
  exerciseName: string,
  weight: number,
  reps: number
): { isPR: boolean; prType: 'weight' | 'reps' | 'estimated_1rm' | null; details: string } {
  const normalizedName = normalizePRExerciseName(exerciseName);
  const current1RM = calculate1RM(weight, reps);

  const exercisePRs = currentPRs[normalizedName];

  if (!exercisePRs) {
    // First time doing this exercise
    return {
      isPR: true,
      prType: 'weight',
      details: `First recorded: ${weight} x ${reps}`,
    };
  }

  const currentPR = exercisePRs.current;

  // Check for weight PR (heavier than any previous)
  const maxWeight = Math.max(
    currentPR.weight,
    ...exercisePRs.history.map(h => h.weight)
  );

  if (weight > maxWeight) {
    return {
      isPR: true,
      prType: 'weight',
      details: `New weight PR: ${weight} (previous: ${maxWeight})`,
    };
  }

  // Check for rep PR at this weight
  const sameWeightPRs = exercisePRs.history.filter(h => h.weight === weight);
  if (sameWeightPRs.length > 0) {
    const maxRepsAtWeight = Math.max(...sameWeightPRs.map(h => h.reps));
    if (reps > maxRepsAtWeight) {
      return {
        isPR: true,
        prType: 'reps',
        details: `New rep PR at ${weight}: ${reps} reps (previous: ${maxRepsAtWeight})`,
      };
    }
  }

  // Check for estimated 1RM PR
  if (current1RM > currentPR.estimated1RM) {
    return {
      isPR: true,
      prType: 'estimated_1rm',
      details: `New estimated 1RM: ${current1RM} (previous: ${currentPR.estimated1RM})`,
    };
  }

  return {
    isPR: false,
    prType: null,
    details: '',
  };
}

/**
 * Extract PRs from a workout's logged exercises
 */
export function extractPRsFromWorkout(
  exercises: LoggedExercise[],
  currentPRs: PRsData,
  date: string
): { exercise: string; record: PRRecord; prType: string }[] {
  const newPRs: { exercise: string; record: PRRecord; prType: string }[] = [];

  for (const exercise of exercises) {
    // Find the best set for each exercise
    let bestSet: { weight: number; reps: number } | null = null;
    let best1RM = 0;

    for (const set of exercise.sets) {
      // Skip bodyweight or non-numeric weights for PR tracking
      if (typeof set.weight !== 'number') continue;

      const reps = typeof set.reps === 'number' ? set.reps : 0;
      if (reps === 0) continue;

      const estimated1RM = calculate1RM(set.weight, reps);

      if (estimated1RM > best1RM) {
        best1RM = estimated1RM;
        bestSet = { weight: set.weight, reps };
      }
    }

    if (!bestSet) continue;

    const prCheck = isPotentialPR(currentPRs, exercise.name, bestSet.weight, bestSet.reps);

    if (prCheck.isPR && prCheck.prType) {
      newPRs.push({
        exercise: exercise.name,
        record: {
          weight: bestSet.weight,
          reps: bestSet.reps,
          date,
          estimated1RM: best1RM,
        },
        prType: prCheck.prType,
      });
    }
  }

  return newPRs;
}

/**
 * Update PRs data with new records
 */
export function updatePRsData(
  currentPRs: PRsData,
  newPRs: { exercise: string; record: PRRecord }[]
): PRsData {
  const updated = { ...currentPRs };

  for (const { exercise, record } of newPRs) {
    const normalizedName = normalizePRExerciseName(exercise);

    if (!updated[normalizedName]) {
      updated[normalizedName] = {
        current: record,
        history: [record],
      };
    } else {
      // Add to history
      updated[normalizedName].history.unshift(record);
      // Update current if this is better
      if (record.estimated1RM >= updated[normalizedName].current.estimated1RM) {
        updated[normalizedName].current = record;
      }
    }
  }

  return updated;
}

/**
 * Format a PR for display
 */
export function formatPR(
  exerciseName: string,
  record: PRRecord,
  prType: string
): string {
  const typeEmoji = {
    weight: '🏋️',
    reps: '💪',
    estimated_1rm: '📈',
  }[prType] || '🎉';

  const typeLabel = {
    weight: 'Weight PR',
    reps: 'Rep PR',
    estimated_1rm: 'Est. 1RM PR',
  }[prType] || 'PR';

  return `${typeEmoji} **${exerciseName}**: ${record.weight} x ${record.reps} (${typeLabel} - Est 1RM: ${record.estimated1RM})`;
}

/**
 * Get progression recommendation based on PR history
 */
export function getProgressionRecommendation(
  exercisePRs: { current: PRRecord; history: PRRecord[] },
  targetReps: number
): { recommendedWeight: number; reasoning: string } {
  const current1RM = exercisePRs.current.estimated1RM;
  const recommendedWeight = calculateWeightForReps(current1RM, targetReps);

  // Check recent trend (last 4 sessions)
  const recentHistory = exercisePRs.history.slice(0, 4);
  const trend = recentHistory.length >= 2
    ? recentHistory[0].estimated1RM - recentHistory[recentHistory.length - 1].estimated1RM
    : 0;

  let reasoning: string;

  if (trend > 10) {
    reasoning = `Strong progress (est 1RM up ${trend} lbs). Consider testing higher weight.`;
  } else if (trend > 0) {
    reasoning = `Steady progress. Continue current progression.`;
  } else if (trend < -10) {
    reasoning = `Decline in estimated 1RM. Consider deload or recovery.`;
  } else {
    reasoning = `Maintaining strength. May be time to push for new PR.`;
  }

  return { recommendedWeight, reasoning };
}

/**
 * Parse PRs from YAML string
 */
export function parsePRsYaml(yamlContent: string): PRsData {
  // Simple YAML parser for PR data structure
  // In production, use a proper YAML library
  const lines = yamlContent.split('\n');
  const prs: PRsData = {};
  let currentExercise: string | null = null;
  let inHistory = false;
  let currentRecord: Partial<PRRecord> = {};

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (trimmed.startsWith('#') || !trimmed) continue;

    // Exercise name (top level key)
    if (!line.startsWith(' ') && trimmed.endsWith(':')) {
      currentExercise = trimmed.slice(0, -1);
      prs[currentExercise] = { current: {} as PRRecord, history: [] };
      inHistory = false;
      currentRecord = {};
      continue;
    }

    if (!currentExercise) continue;

    // Check for "current:" or "history:" sections
    if (trimmed === 'current:') {
      inHistory = false;
      currentRecord = {};
      continue;
    }

    if (trimmed === 'history:') {
      inHistory = true;
      continue;
    }

    // Parse key-value pairs
    const kvMatch = trimmed.match(/^-?\s*(\w+):\s*(.+)$/);
    if (kvMatch) {
      const [, key, value] = kvMatch;

      // Start of new history item
      if (trimmed.startsWith('-')) {
        if (Object.keys(currentRecord).length > 0 && inHistory) {
          prs[currentExercise].history.push(currentRecord as PRRecord);
        }
        currentRecord = {};
      }

      // Parse value
      const cleanValue = value.replace(/['"]/g, '');
      if (key === 'weight' || key === 'reps' || key === 'estimated_1rm' || key === 'added_weight') {
        currentRecord[key === 'estimated_1rm' ? 'estimated1RM' : key === 'added_weight' ? 'addedWeight' : key] = parseFloat(cleanValue);
      } else if (key === 'date' || key === 'workout_ref' || key === 'bodyweight_note') {
        currentRecord[key === 'workout_ref' ? 'workoutRef' : key === 'bodyweight_note' ? 'bodyweightNote' : key] = cleanValue;
      }
    }
  }

  // Don't forget the last record
  if (currentExercise && Object.keys(currentRecord).length > 0) {
    if (inHistory) {
      prs[currentExercise].history.push(currentRecord as PRRecord);
    } else {
      prs[currentExercise].current = currentRecord as PRRecord;
    }
  }

  return prs;
}

/**
 * Serialize PRs to YAML string
 */
export function serializePRsToYaml(prs: PRsData): string {
  const lines: string[] = ['# Personal Records', '# Auto-updated when new PRs are detected in workouts', ''];

  for (const [exercise, data] of Object.entries(prs)) {
    lines.push(`${exercise}:`);
    lines.push('  current:');
    lines.push(`    weight: ${data.current.weight}`);
    lines.push(`    reps: ${data.current.reps}`);
    lines.push(`    date: "${data.current.date}"`);
    lines.push(`    estimated_1rm: ${data.current.estimated1RM}`);
    if (data.current.workoutRef) {
      lines.push(`    workout_ref: "${data.current.workoutRef}"`);
    }
    if (data.current.addedWeight !== undefined) {
      lines.push(`    added_weight: ${data.current.addedWeight}`);
    }
    if (data.current.bodyweightNote) {
      lines.push(`    bodyweight_note: "${data.current.bodyweightNote}"`);
    }

    lines.push('  history:');
    for (const record of data.history) {
      lines.push(`    - weight: ${record.weight}`);
      lines.push(`      reps: ${record.reps}`);
      lines.push(`      date: "${record.date}"`);
      lines.push(`      estimated_1rm: ${record.estimated1RM}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}
