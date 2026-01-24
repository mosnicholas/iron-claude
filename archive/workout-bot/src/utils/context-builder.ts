import type { GitHubService } from '../services/github.service.js';
import type {
  UserProfile,
  WeekPlan,
  WorkoutLog,
  BehavioralPattern,
  ExerciseAdherence,
  ProgressionRate,
} from '../types/index.js';

export interface FullContext {
  profile: UserProfile;
  currentPlan: WeekPlan | null;
  recentLogs: WorkoutLog[];
  exerciseRotation: string;
}

export async function buildFullContext(
  github: GitHubService
): Promise<FullContext> {
  const [profile, currentPlan, recentLogs, exerciseRotation] = await Promise.all([
    github.getClaudeContext(),
    github.getCurrentWeekPlan(),
    github.getRecentLogs(2),
    github.getFile('exercise-variations.md'),
  ]);

  return {
    profile,
    currentPlan,
    recentLogs,
    exerciseRotation: exerciseRotation || '',
  };
}

export function analyzeFatigue(logs: WorkoutLog[]): string[] {
  const signals: string[] = [];

  if (logs.length === 0) {
    return signals;
  }

  // Check for consistently low energy
  const recentEnergy = logs.slice(0, 3).map((l) => l.energy);
  const avgEnergy =
    recentEnergy.reduce((sum, e) => sum + e, 0) / recentEnergy.length;
  if (avgEnergy < 6) {
    signals.push(`Low average energy (${avgEnergy.toFixed(1)}/10)`);
  }

  // Check for consistently low sleep
  const recentSleep = logs.slice(0, 3).map((l) => l.sleepHours);
  const avgSleep =
    recentSleep.reduce((sum, s) => sum + s, 0) / recentSleep.length;
  if (avgSleep < 6.5) {
    signals.push(`Low average sleep (${avgSleep.toFixed(1)}h)`);
  }

  // Check for high RPE trends
  const allRPEs: number[] = [];
  for (const log of logs.slice(0, 3)) {
    for (const exercise of [...log.skills, ...log.strength]) {
      for (const set of exercise.sets) {
        if (set.rpe !== undefined) {
          allRPEs.push(set.rpe);
        }
      }
    }
  }

  if (allRPEs.length > 0) {
    const avgRPE = allRPEs.reduce((sum, r) => sum + r, 0) / allRPEs.length;
    if (avgRPE > 8.5) {
      signals.push(`High average RPE (${avgRPE.toFixed(1)})`);
    }
  }

  return signals;
}

export function shouldRecommendDeload(
  profile: UserProfile,
  logs: WorkoutLog[]
): { needsDeload: boolean; reason?: string } {
  const weeksInBlock = profile.currentStatus.programWeek;

  // Check if 4+ weeks since last deload
  if (weeksInBlock < 4) {
    return { needsDeload: false };
  }

  const fatigueSignals = analyzeFatigue(logs);

  if (fatigueSignals.length >= 2) {
    return {
      needsDeload: true,
      reason: `${weeksInBlock} weeks in block with fatigue signals: ${fatigueSignals.join(', ')}`,
    };
  }

  if (weeksInBlock >= 6) {
    return {
      needsDeload: true,
      reason: `${weeksInBlock} weeks without deload - scheduled recovery week`,
    };
  }

  return { needsDeload: false };
}

export function calculateVolumeChange(
  currentLogs: WorkoutLog[],
  previousLogs: WorkoutLog[]
): Record<string, number> {
  const currentVolume: Record<string, number> = {};
  const previousVolume: Record<string, number> = {};

  // Calculate current volume
  for (const log of currentLogs) {
    for (const exercise of [...log.skills, ...log.strength]) {
      const totalReps = exercise.sets.reduce((sum, s) => sum + s.reps, 0);
      currentVolume[exercise.name] =
        (currentVolume[exercise.name] || 0) + totalReps;
    }
  }

  // Calculate previous volume
  for (const log of previousLogs) {
    for (const exercise of [...log.skills, ...log.strength]) {
      const totalReps = exercise.sets.reduce((sum, s) => sum + s.reps, 0);
      previousVolume[exercise.name] =
        (previousVolume[exercise.name] || 0) + totalReps;
    }
  }

  // Calculate change
  const change: Record<string, number> = {};
  for (const name of Object.keys(currentVolume)) {
    const prev = previousVolume[name] || 0;
    const curr = currentVolume[name];
    if (prev > 0) {
      change[name] = Math.round(((curr - prev) / prev) * 100);
    }
  }

  return change;
}

export function identifyPRs(
  currentLog: WorkoutLog,
  previousLogs: WorkoutLog[]
): string[] {
  const prs: string[] = [];

  // Build map of previous best weights for each exercise
  const previousBests: Record<string, number> = {};
  for (const log of previousLogs) {
    for (const exercise of [...log.skills, ...log.strength]) {
      for (const set of exercise.sets) {
        const weight = set.weight || set.addedWeight || 0;
        if (weight > (previousBests[exercise.name] || 0)) {
          previousBests[exercise.name] = weight;
        }
      }
    }
  }

  // Check current log for PRs
  for (const exercise of [...currentLog.skills, ...currentLog.strength]) {
    for (const set of exercise.sets) {
      const weight = set.weight || set.addedWeight || 0;
      if (weight > (previousBests[exercise.name] || 0) && weight > 0) {
        prs.push(`${exercise.name}: ${weight} lbs`);
        break; // Only count once per exercise
      }
    }
  }

  return prs;
}

/**
 * Analyzes behavioral patterns from workout logs to compare stated vs actual behavior.
 * Used to make planning more adaptive and realistic.
 */
export function analyzeBehavioralPatterns(
  logs: WorkoutLog[],
  profile: UserProfile,
  weeksBack: number = 4
): BehavioralPattern {
  const insights: string[] = [];

  // Group logs by week
  const logsByWeek = groupLogsByWeek(logs);
  const weeksAnalyzed = Object.keys(logsByWeek).length;

  // Calculate actual days per week
  const totalDays = logs.length;
  const actualDaysPerWeek =
    weeksAnalyzed > 0 ? totalDays / weeksAnalyzed : 0;
  const statedDaysPerWeek = profile.preferences.trainingDays;
  const frequencyDelta = actualDaysPerWeek - statedDaysPerWeek;

  if (Math.abs(frequencyDelta) >= 1) {
    if (frequencyDelta < 0) {
      insights.push(
        `Training ${Math.abs(frequencyDelta).toFixed(1)} fewer days/week than planned (${actualDaysPerWeek.toFixed(1)} vs ${statedDaysPerWeek})`
      );
    } else {
      insights.push(
        `Training ${frequencyDelta.toFixed(1)} more days/week than planned (${actualDaysPerWeek.toFixed(1)} vs ${statedDaysPerWeek})`
      );
    }
  }

  // Calculate RPE stats
  const allRPEs: number[] = [];
  for (const log of logs) {
    for (const exercise of [...log.skills, ...log.strength]) {
      for (const set of exercise.sets) {
        if (set.rpe !== undefined) {
          allRPEs.push(set.rpe);
        }
      }
    }
  }

  const avgRPE =
    allRPEs.length > 0
      ? allRPEs.reduce((sum, r) => sum + r, 0) / allRPEs.length
      : 0;
  const rpeRange = {
    min: allRPEs.length > 0 ? Math.min(...allRPEs) : 0,
    max: allRPEs.length > 0 ? Math.max(...allRPEs) : 0,
  };

  if (avgRPE > 8.5) {
    insights.push(`Consistently high intensity (avg RPE ${avgRPE.toFixed(1)})`);
  } else if (avgRPE < 7 && avgRPE > 0) {
    insights.push(`Lower intensity training (avg RPE ${avgRPE.toFixed(1)}) - room for progression`);
  }

  // Calculate exercise adherence by category
  const exerciseAdherence = calculateExerciseAdherence(logs);

  if (exerciseAdherence.mainLifts > 90) {
    insights.push('Excellent main lift adherence');
  }
  if (exerciseAdherence.accessories < 70) {
    insights.push('Accessories often get cut - prioritize critical work in main lifts');
  }
  if (exerciseAdherence.conditioning < 50) {
    insights.push('Conditioning days frequently skipped');
  }

  // Calculate progression rates
  const progressionRates = calculateProgressionRates(logs);

  // Analyze consistency by day of week
  const consistency = analyzeConsistency(logs);

  if (consistency.bestDays.length > 0) {
    insights.push(`Most consistent on ${consistency.bestDays.join(', ')}`);
  }
  if (consistency.worstDays.length > 0) {
    insights.push(`Often misses ${consistency.worstDays.join(', ')}`);
  }

  // Calculate set completion (simplified - would need plan data for accurate comparison)
  const avgSetsCompleted = calculateAverageSetsPerSession(logs);

  return {
    actualDaysPerWeek: Math.round(actualDaysPerWeek * 10) / 10,
    statedDaysPerWeek,
    frequencyDelta: Math.round(frequencyDelta * 10) / 10,
    avgSetsCompleted: Math.round(avgSetsCompleted * 10) / 10,
    avgSetsPlanned: 0, // Would need plan data to calculate
    setCompletionRate: 0, // Would need plan data to calculate
    avgRPE: Math.round(avgRPE * 10) / 10,
    rpeRange,
    exerciseAdherence,
    progressionRates,
    consistency: {
      ...consistency,
      weeksAnalyzed,
    },
    insights,
  };
}

function groupLogsByWeek(logs: WorkoutLog[]): Record<string, WorkoutLog[]> {
  const grouped: Record<string, WorkoutLog[]> = {};

  for (const log of logs) {
    // Extract week from date (YYYY-MM-DD format)
    const date = new Date(log.date);
    const weekStart = getWeekStart(date);
    const weekKey = weekStart.toISOString().split('T')[0];

    if (!grouped[weekKey]) {
      grouped[weekKey] = [];
    }
    grouped[weekKey].push(log);
  }

  return grouped;
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  return new Date(d.setDate(diff));
}

function calculateExerciseAdherence(logs: WorkoutLog[]): ExerciseAdherence {
  let mainLiftSessions = 0;
  let mainLiftWithExercises = 0;
  let accessorySessions = 0;
  let accessoryWithExercises = 0;
  let conditioningSessions = 0;
  let conditioningWithExercises = 0;
  let skillSessions = 0;
  let skillWithExercises = 0;

  // Main lifts: OHP, Squat, Deadlift, Bench, Row, Pull-ups
  const mainLiftPatterns = [
    /ohp|overhead press/i,
    /squat/i,
    /deadlift|dl$/i,
    /bench/i,
    /row/i,
    /pull-?up|chin-?up/i,
  ];

  for (const log of logs) {
    const allExercises = [...log.skills, ...log.strength];
    const exerciseNames = allExercises.map((e) => e.name);

    // Check for main lifts
    if (
      log.dayType === 'upper-push' ||
      log.dayType === 'upper-pull' ||
      log.dayType === 'lower' ||
      log.dayType === 'full-body'
    ) {
      mainLiftSessions++;
      const hasMainLift = mainLiftPatterns.some((pattern) =>
        exerciseNames.some((name) => pattern.test(name))
      );
      if (hasMainLift) mainLiftWithExercises++;

      // Check for accessories (non-main-lift strength exercises)
      accessorySessions++;
      const accessoryCount = log.strength.filter(
        (e) => !mainLiftPatterns.some((p) => p.test(e.name))
      ).length;
      if (accessoryCount > 0) accessoryWithExercises++;
    }

    // Check for conditioning
    if (log.dayType === 'conditioning') {
      conditioningSessions++;
      if (allExercises.length > 0) conditioningWithExercises++;
    }

    // Check for skills
    if (log.skills.length > 0) {
      skillSessions++;
      skillWithExercises++;
    } else if (
      log.dayType === 'upper-push' ||
      log.dayType === 'upper-pull' ||
      log.dayType === 'lower' ||
      log.dayType === 'full-body'
    ) {
      // Expected to have skills but didn't
      skillSessions++;
    }
  }

  return {
    mainLifts:
      mainLiftSessions > 0
        ? Math.round((mainLiftWithExercises / mainLiftSessions) * 100)
        : 100,
    accessories:
      accessorySessions > 0
        ? Math.round((accessoryWithExercises / accessorySessions) * 100)
        : 100,
    conditioning:
      conditioningSessions > 0
        ? Math.round((conditioningWithExercises / conditioningSessions) * 100)
        : 100,
    skills:
      skillSessions > 0
        ? Math.round((skillWithExercises / skillSessions) * 100)
        : 100,
  };
}

function calculateProgressionRates(logs: WorkoutLog[]): ProgressionRate[] {
  // Group weights by exercise over time
  const exerciseHistory: Record<
    string,
    { date: string; weight: number }[]
  > = {};

  for (const log of logs) {
    for (const exercise of [...log.skills, ...log.strength]) {
      for (const set of exercise.sets) {
        const weight = set.weight || set.addedWeight;
        if (weight !== undefined && weight > 0) {
          if (!exerciseHistory[exercise.name]) {
            exerciseHistory[exercise.name] = [];
          }
          exerciseHistory[exercise.name].push({
            date: log.date,
            weight,
          });
          break; // Only take first set's weight per session
        }
      }
    }
  }

  const progressionRates: ProgressionRate[] = [];

  for (const [exercise, history] of Object.entries(exerciseHistory)) {
    if (history.length < 2) continue;

    // Sort by date
    history.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    const firstWeight = history[0].weight;
    const lastWeight = history[history.length - 1].weight;
    const firstDate = new Date(history[0].date);
    const lastDate = new Date(history[history.length - 1].date);

    const weeksDiff =
      (lastDate.getTime() - firstDate.getTime()) / (7 * 24 * 60 * 60 * 1000);

    if (weeksDiff > 0) {
      const lbsPerWeek = (lastWeight - firstWeight) / weeksDiff;
      progressionRates.push({
        exercise,
        lbsPerWeek: Math.round(lbsPerWeek * 10) / 10,
        weeksTracked: Math.round(weeksDiff * 10) / 10,
      });
    }
  }

  // Sort by weeks tracked (most data first)
  return progressionRates.sort((a, b) => b.weeksTracked - a.weeksTracked);
}

function analyzeConsistency(logs: WorkoutLog[]): {
  bestDays: string[];
  worstDays: string[];
} {
  const dayOfWeekCount: Record<string, number> = {
    monday: 0,
    tuesday: 0,
    wednesday: 0,
    thursday: 0,
    friday: 0,
    saturday: 0,
    sunday: 0,
  };

  const dayNames = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ];

  for (const log of logs) {
    const date = new Date(log.date);
    const dayName = dayNames[date.getDay()];
    dayOfWeekCount[dayName]++;
  }

  // Find best and worst days (excluding weekends typically)
  const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  const sortedDays = weekdays.sort(
    (a, b) => dayOfWeekCount[b] - dayOfWeekCount[a]
  );

  const maxCount = dayOfWeekCount[sortedDays[0]];
  const minCount = dayOfWeekCount[sortedDays[sortedDays.length - 1]];

  const bestDays = sortedDays
    .filter((d) => dayOfWeekCount[d] === maxCount && maxCount > 0)
    .map((d) => d.charAt(0).toUpperCase() + d.slice(1));

  const worstDays = sortedDays
    .filter((d) => dayOfWeekCount[d] === minCount && maxCount - minCount >= 2)
    .map((d) => d.charAt(0).toUpperCase() + d.slice(1));

  return { bestDays, worstDays };
}

function calculateAverageSetsPerSession(logs: WorkoutLog[]): number {
  if (logs.length === 0) return 0;

  let totalSets = 0;
  for (const log of logs) {
    for (const exercise of [...log.skills, ...log.strength]) {
      totalSets += exercise.sets.length;
    }
  }

  return totalSets / logs.length;
}
