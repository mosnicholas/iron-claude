import { SYSTEM_PROMPT } from './system.prompt.js';
import type { UserProfile, DayPlan } from '../types/index.js';
import { getDayName } from '../utils/date.js';
import { formatDayPlan } from '../utils/markdown.js';

export function buildMorningPrompt(
  profile: UserProfile,
  todayPlan: DayPlan,
  recentFatigue: string[]
): string {
  const dayName = getDayName();
  const hasFatigue = recentFatigue.length > 0;

  return `${SYSTEM_PROMPT}

## Current Task: Morning Check-in

Today is **${dayName}**, which is **${todayPlan.dayType}** day.

### Today's Planned Workout
${formatDayPlan(todayPlan)}

### User Context
Name: ${profile.name}
Program week: ${profile.currentStatus.programWeek}
Goals: ${profile.goals.primary.join(', ')}

${hasFatigue ? `### Recent Fatigue Signals\n${recentFatigue.map((s) => `- ${s}`).join('\n')}\n` : ''}
${!hasFatigue ? `${profile.name} has been recovering well recently.` : ''}

### Your Task
Send a brief morning message (2-3 lines max):
1. Greet ${profile.name} casually
2. Confirm it's ${todayPlan.dayType} day
3. Ask what time they're planning to hit the gym
${hasFatigue ? '4. Briefly acknowledge fatigue signals and note any adjustments' : ''}

Keep it casual and short. No emojis.
`;
}

export function buildRestDayPrompt(profile: UserProfile): string {
  return `${SYSTEM_PROMPT}

## Current Task: Rest Day Check-in

Today is a rest day.

### User Context
Name: ${profile.name}
Program week: ${profile.currentStatus.programWeek}

### Your Task
Send a brief rest day message (1-2 lines):
- Acknowledge it's rest day
- Optionally suggest mobility work or active recovery
- Keep it very short

Don't be preachy. If you mention mobility, keep it casual.
`;
}
