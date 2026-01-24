import { SYSTEM_PROMPT } from './system.prompt.js';
import type { UserProfile, DayPlan, ExerciseLog } from '../types/index.js';
import { formatDayPlan, formatExerciseLogs } from '../utils/markdown.js';

export function buildWorkoutPrompt(
  profile: UserProfile,
  todayPlan: DayPlan,
  loggedSoFar: ExerciseLog[],
  latestMessage: string
): string {
  return `${SYSTEM_PROMPT}

## Current Task: During Workout

${profile.name} just sent: "${latestMessage}"

### Today's Plan
${formatDayPlan(todayPlan)}

### Logged So Far
${formatExerciseLogs(loggedSoFar)}

### User Context
Name: ${profile.name}
Goals: ${profile.goals.primary.join(', ')}

### Your Task
Respond briefly (1-2 lines max):
- Acknowledge the set/exercise
- If it was a main lift, note if on target or adjusted
- Prompt next exercise OR ask if wrapping up

They're in the gym - minimize phone time. Keep response SHORT.
`;
}

export function buildPreWorkoutPrompt(
  profile: UserProfile,
  todayPlan: DayPlan
): string {
  return `${SYSTEM_PROMPT}

## Current Task: Pre-Workout Briefing

${profile.name} is heading to the gym.

### Today's Plan
${formatDayPlan(todayPlan)}

### User Context
Name: ${profile.name}
Goals: ${profile.goals.primary.join(', ')}

### Your Task
Send a brief pre-workout message (2-3 lines):
- Quick reminder of today's focus
- Mention the first exercise/skill to start with
- Brief note on any key weights to hit

Keep it actionable and short.
`;
}

export function buildWorkoutStartPrompt(
  profile: UserProfile,
  todayPlan: DayPlan
): string {
  return `${SYSTEM_PROMPT}

## Current Task: Workout Starting

${profile.name} just arrived at the gym and is ready to start.

### Today's Plan
${formatDayPlan(todayPlan)}

### Your Task
Send a quick "let's go" message (1-2 lines):
- Confirm the first thing to do (skill work if applicable)
- Keep it brief and energizing

No pep talks. Just tell them what to start with.
`;
}
