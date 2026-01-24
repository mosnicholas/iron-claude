import type {
  WorkoutLog,
  ExerciseLog,
  ExerciseSet,
  DayPlan,
  WeekPlan,
  PlannedExercise,
} from '../types/index.js';
import { getDayName, formatISODate } from './date.js';

export function formatWorkoutLogMarkdown(log: WorkoutLog): string {
  const lines: string[] = [];
  const date = new Date(log.date);

  lines.push(`# ${getDayName(date)} - ${log.dayType}`);
  lines.push('');
  lines.push(`Date: ${log.date}`);
  lines.push(`Type: ${log.dayType}`);
  lines.push(`Energy: ${log.energy}/10`);
  lines.push(`Sleep: ${log.sleepHours}h`);
  lines.push('');

  if (log.skills.length > 0) {
    lines.push('## Skills');
    lines.push('');
    for (const exercise of log.skills) {
      lines.push(formatExerciseLogLine(exercise));
    }
    lines.push('');
  }

  if (log.strength.length > 0) {
    lines.push('## Strength');
    lines.push('');
    for (const exercise of log.strength) {
      lines.push(formatExerciseLogLine(exercise));
    }
    lines.push('');
  }

  if (log.notes.length > 0) {
    lines.push('## Notes');
    lines.push('');
    for (const note of log.notes) {
      lines.push(`- ${note}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function formatExerciseLogLine(exercise: ExerciseLog): string {
  const setsStr = exercise.sets.map(formatSetStr).join(', ');
  let line = `- **${exercise.name}**: ${setsStr}`;

  if (exercise.notes) {
    line += ` - ${exercise.notes}`;
  }

  return line;
}

function formatSetStr(set: ExerciseSet): string {
  if (set.duration) {
    return `${set.duration}s`;
  }

  let str = `${set.reps}`;

  if (set.weight) {
    str = `${set.weight} x ${set.reps}`;
  } else if (set.addedWeight) {
    str = `+${set.addedWeight} x ${set.reps}`;
  }

  if (set.rpe) {
    str += ` @${set.rpe}`;
  }

  return str;
}

export function formatDayPlan(plan: DayPlan): string {
  const lines: string[] = [];

  lines.push(`**${plan.dayType.toUpperCase()}**`);
  lines.push('');

  if (plan.skills.length > 0) {
    lines.push('*Skills:*');
    for (const exercise of plan.skills) {
      lines.push(formatPlannedExerciseLine(exercise));
    }
    lines.push('');
  }

  if (plan.strength.length > 0) {
    lines.push('*Strength:*');
    for (const exercise of plan.strength) {
      lines.push(formatPlannedExerciseLine(exercise));
    }
  }

  return lines.join('\n');
}

function formatPlannedExerciseLine(exercise: PlannedExercise): string {
  const weight =
    exercise.targetWeight === 'BW'
      ? 'BW'
      : exercise.targetWeight === 'TBD'
        ? 'TBD'
        : `${exercise.targetWeight} lbs`;

  let line = `- ${exercise.name}: ${exercise.targetSets}x${exercise.targetReps} @ ${weight}`;

  if (exercise.notes) {
    line += ` (${exercise.notes})`;
  }

  return line;
}

export function formatWeekPlanMarkdown(plan: WeekPlan): string {
  const lines: string[] = [];

  lines.push(`# Week ${plan.weekNumber}`);
  lines.push('');
  lines.push(`Start: ${plan.startDate}`);
  lines.push(`End: ${plan.endDate}`);
  lines.push('');

  if (plan.focus.length > 0) {
    lines.push('## Focus');
    for (const focus of plan.focus) {
      lines.push(`- ${focus}`);
    }
    lines.push('');
  }

  if (plan.deloadStatus.needsDeload) {
    lines.push('## Deload Notice');
    lines.push(
      `Weeks in block: ${plan.deloadStatus.weeksInBlock}`
    );
    if (plan.deloadStatus.reason) {
      lines.push(`Reason: ${plan.deloadStatus.reason}`);
    }
    if (plan.deloadStatus.action) {
      lines.push(`Action: ${plan.deloadStatus.action}`);
    }
    lines.push('');
  }

  lines.push('## Daily Plans');
  lines.push('');

  const dayOrder = [
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
  ];

  for (const day of dayOrder) {
    const dayPlan = plan.days[day];
    if (dayPlan) {
      lines.push(`### ${day.charAt(0).toUpperCase() + day.slice(1)}`);
      lines.push('');
      lines.push(formatDayPlan(dayPlan));
      lines.push('');
    }
  }

  return lines.join('\n');
}

export function formatExerciseLogs(logs: ExerciseLog[]): string {
  if (logs.length === 0) {
    return 'No exercises logged yet.';
  }

  return logs.map(formatExerciseLogLine).join('\n');
}

export function formatWorkoutSummary(log: WorkoutLog): string {
  const lines: string[] = [];

  lines.push(`**${log.dayType}** - ${log.date}`);
  lines.push(`Energy: ${log.energy}/10 | Sleep: ${log.sleepHours}h`);

  const totalSets =
    log.skills.reduce((sum, ex) => sum + ex.sets.length, 0) +
    log.strength.reduce((sum, ex) => sum + ex.sets.length, 0);

  lines.push(`Total sets: ${totalSets}`);

  return lines.join('\n');
}
