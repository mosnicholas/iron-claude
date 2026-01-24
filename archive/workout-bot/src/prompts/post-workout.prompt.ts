import { SYSTEM_PROMPT, COACHING_RULES } from './system.prompt.js';
import type { UserProfile, DayPlan, WorkoutLog } from '../types/index.js';
import { formatDayPlan, formatWorkoutSummary } from '../utils/markdown.js';

export function buildPostWorkoutPrompt(
  profile: UserProfile,
  completedLog: WorkoutLog,
  plannedDay: DayPlan,
  prs: string[] = []
): string {
  const hasPRs = prs.length > 0;

  return `${SYSTEM_PROMPT}

${COACHING_RULES}

## Current Task: Post-Workout Analysis

${profile.name} just finished their workout.

### What Was Planned
${formatDayPlan(plannedDay)}

### What Was Logged
${formatWorkoutSummary(completedLog)}

**Skills:**
${completedLog.skills.map((e) => `- ${e.name}: ${e.sets.map((s) => s.duration ? `${s.duration}s` : `${s.reps}`).join(', ')}`).join('\n') || 'None logged'}

**Strength:**
${completedLog.strength.map((e) => {
  const setsStr = e.sets.map((s) => {
    let str = `${s.reps}`;
    if (s.weight) str = `${s.weight}x${s.reps}`;
    if (s.addedWeight) str = `+${s.addedWeight}x${s.reps}`;
    if (s.rpe) str += `@${s.rpe}`;
    return str;
  }).join(', ');
  return `- ${e.name}: ${setsStr}`;
}).join('\n') || 'None logged'}

${hasPRs ? `### PRs Today!\n${prs.map((pr) => `- ${pr}`).join('\n')}` : ''}

### User Context
Name: ${profile.name}
Goals: ${profile.goals.primary.join(', ')}
Energy: ${completedLog.energy}/10
Sleep: ${completedLog.sleepHours}h

### Your Task
Provide post-workout feedback (3-4 lines max):
1. Quick acknowledgment (good session / solid work / etc.)
${hasPRs ? '2. Celebrate the PR(s) briefly - use one emoji for PRs only' : '2. Note 1-2 key observations (improvements, high RPE, skipped exercises)'}
3. One specific recommendation for next session of this type

Be prescriptive - don't ask, tell.
`;
}

export function buildSkippedWorkoutPrompt(
  profile: UserProfile,
  plannedDay: DayPlan,
  reason?: string
): string {
  return `${SYSTEM_PROMPT}

## Current Task: Skipped Workout Response

${profile.name} is skipping today's workout.
${reason ? `Reason: ${reason}` : ''}

### What Was Planned
${formatDayPlan(plannedDay)}

### Your Task
Respond briefly (1-2 lines):
- Acknowledge without guilt-tripping
- Mention we'll adjust if needed
- Keep it supportive but not overly sympathetic

No lectures. Just acknowledge and move on.
`;
}
