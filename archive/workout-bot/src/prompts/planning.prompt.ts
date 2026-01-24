import { SYSTEM_PROMPT, COACHING_RULES, ADAPTIVE_COACHING_RULES } from './system.prompt.js';
import type { UserProfile, WeekPlan, WorkoutLog, BehavioralPattern } from '../types/index.js';
import { formatWeekPlanMarkdown, formatWorkoutSummary } from '../utils/markdown.js';
import { getNextWeekNumber, getWeekStartDate, getWeekEndDate, formatISODate } from '../utils/date.js';

export function buildPlanningPrompt(
  profile: UserProfile,
  lastWeekLogs: WorkoutLog[],
  lastWeekPlan: WeekPlan | null,
  exerciseVariations: string,
  behavioralPatterns?: BehavioralPattern,
  fatigueSignals?: string[]
): string {
  const nextWeek = getNextWeekNumber();
  const startDate = formatISODate(getWeekStartDate(nextWeek));
  const endDate = formatISODate(getWeekEndDate(nextWeek));

  // Build behavioral reality check section
  const behavioralSection = behavioralPatterns
    ? buildBehavioralSection(profile, behavioralPatterns)
    : '';

  // Build fatigue section
  const fatigueSection =
    fatigueSignals && fatigueSignals.length > 0
      ? `### Current Fatigue Signals\n${fatigueSignals.map((s) => `- ${s}`).join('\n')}\n\nConsider reducing volume or intensity based on these signals.\n`
      : '';

  return `${SYSTEM_PROMPT}

${COACHING_RULES}

${ADAPTIVE_COACHING_RULES}

## Current Task: Weekly Planning (Sunday)

Generate next week's training plan based on last week's performance AND observed behavioral patterns.

${behavioralSection}

${fatigueSection}

### User Profile
Name: ${profile.name}
Experience: ${profile.experience}
Goals: ${profile.goals.primary.join(', ')}
Session length: ${profile.preferences.sessionLength}
Training days: ${profile.preferences.trainingDays} (stated preference)
Current program week: ${profile.currentStatus.programWeek}
Skill-first preference: ${profile.preferences.skillFirst}

### Last Week's Plan
${lastWeekPlan ? formatWeekPlanMarkdown(lastWeekPlan) : 'No previous plan available'}

### Last Week's Actual Logs
${lastWeekLogs.length > 0 ? lastWeekLogs.map(formatWorkoutSummary).join('\n\n') : 'No logs from last week'}

### Exercise Rotation Reference
${exerciseVariations || 'No rotation reference available'}

### Analysis Required
1. Compare planned vs actual for each day
2. Calculate volume (total working sets)
3. Track main lift progression (weight changes)
4. Identify fatigue signals (RPE trends, declining reps)
5. Note skill improvements

### Next Week Details
Week: ${nextWeek}
Start: ${startDate}
End: ${endDate}

### Output Format
Generate TWO things:

**1. PLAN MARKDOWN** (between <plan> tags)
Full week plan in markdown format for committing to GitHub.
Include:
- Week number and dates
- Focus areas for the week
- Daily plans with specific exercises, sets, reps, weights
- Any deload notes if applicable

**2. TELEGRAM SUMMARY** (between <telegram> tags)
Brief summary for the user (4-5 lines max):
- One line on last week's highlights
- One line on any concerns/adjustments
- Key focus areas for the week
- Ask if any schedule changes (travel, etc.)

<plan>
[Your full markdown plan here]
</plan>

<telegram>
[Your brief Telegram message here]
</telegram>
`;
}

export function parsePlanningResponse(response: string): {
  planMarkdown: string;
  telegramSummary: string;
} {
  const planMatch = response.match(/<plan>([\s\S]*?)<\/plan>/);
  const telegramMatch = response.match(/<telegram>([\s\S]*?)<\/telegram>/);

  return {
    planMarkdown: planMatch ? planMatch[1].trim() : response,
    telegramSummary: telegramMatch
      ? telegramMatch[1].trim()
      : 'New week plan is ready. Check the repo for details.',
  };
}

function buildBehavioralSection(
  profile: UserProfile,
  patterns: BehavioralPattern
): string {
  const lines: string[] = ['### Behavioral Reality Check'];
  lines.push('');
  lines.push('Before planning, acknowledge the gap between stated preferences and actual behavior:');
  lines.push('');

  // Frequency comparison
  lines.push('**Training Frequency:**');
  lines.push(`- Stated: ${patterns.statedDaysPerWeek} days/week`);
  lines.push(`- Actual: ${patterns.actualDaysPerWeek} days/week`);
  if (Math.abs(patterns.frequencyDelta) >= 1) {
    lines.push(
      `- Gap: ${patterns.frequencyDelta > 0 ? '+' : ''}${patterns.frequencyDelta} days`
    );
  }
  lines.push('');

  // Exercise adherence
  lines.push('**Exercise Adherence:**');
  lines.push(`- Main lifts: ${patterns.exerciseAdherence.mainLifts}% completed`);
  lines.push(`- Accessories: ${patterns.exerciseAdherence.accessories}% completed`);
  lines.push(`- Conditioning: ${patterns.exerciseAdherence.conditioning}% completed`);
  lines.push(`- Skills: ${patterns.exerciseAdherence.skills}% completed`);
  lines.push('');

  // RPE patterns
  if (patterns.avgRPE > 0) {
    lines.push('**Intensity:**');
    lines.push(`- Average RPE: ${patterns.avgRPE}`);
    lines.push(`- RPE range: ${patterns.rpeRange.min} - ${patterns.rpeRange.max}`);
    lines.push('');
  }

  // Progression rates (top 3)
  if (patterns.progressionRates.length > 0) {
    lines.push('**Progression Rates (lbs/week):**');
    const topProgressions = patterns.progressionRates.slice(0, 5);
    for (const p of topProgressions) {
      const direction = p.lbsPerWeek >= 0 ? '+' : '';
      lines.push(
        `- ${p.exercise}: ${direction}${p.lbsPerWeek} lbs/week (${p.weeksTracked} weeks data)`
      );
    }
    lines.push('');
  }

  // Consistency
  if (
    patterns.consistency.bestDays.length > 0 ||
    patterns.consistency.worstDays.length > 0
  ) {
    lines.push('**Consistency Patterns:**');
    if (patterns.consistency.bestDays.length > 0) {
      lines.push(`- Most reliable: ${patterns.consistency.bestDays.join(', ')}`);
    }
    if (patterns.consistency.worstDays.length > 0) {
      lines.push(`- Often missed: ${patterns.consistency.worstDays.join(', ')}`);
    }
    lines.push('');
  }

  // Insights summary
  if (patterns.insights.length > 0) {
    lines.push('**Key Insights:**');
    for (const insight of patterns.insights) {
      lines.push(`- ${insight}`);
    }
    lines.push('');
  }

  // Coaching implication
  lines.push('**Coaching Implication:**');
  lines.push(
    'Plan for the ACTUAL person, not the aspirational one. ' +
      `If they average ${patterns.actualDaysPerWeek} days, plan an effective ${Math.round(patterns.actualDaysPerWeek)}-day program. ` +
      'If accessories get skipped, put critical work in main lifts.'
  );
  lines.push('');

  return lines.join('\n');
}
