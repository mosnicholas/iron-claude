/**
 * Context Builder for Coach Agent
 *
 * Pre-loads essential context to include in the system prompt,
 * so the agent has immediate awareness without needing extra tool calls.
 */

import { GitHubStorage } from '../storage/github.js';
import type { AgentContext, PRsData, WorkoutLog, WeeklyPlan, DayPlan } from '../storage/types.js';
import { getCurrentWeek, getToday, formatDateHuman, parseISOWeek, getDayName } from '../utils/date.js';
import { parsePRsYaml } from '../utils/pr-calculator.js';
import YAML from 'yaml';

/**
 * Build context for the coach agent
 */
export async function buildAgentContext(
  storage: GitHubStorage,
  timezone: string
): Promise<AgentContext> {
  const currentWeek = getCurrentWeek(timezone);
  const today = getToday(timezone);

  // Load all context in parallel
  const [
    profileContent,
    learningsContent,
    prsContent,
    weeklyPlanContent,
    inProgressBranch,
    recentWorkoutFiles,
  ] = await Promise.all([
    storage.readProfile(),
    storage.readLearnings(),
    storage.readPRs(),
    storage.readWeeklyPlan(currentWeek),
    storage.findInProgressWorkout(),
    storage.listWorkouts(),
  ]);

  // Parse profile (just pass through the markdown for now)
  const profile = profileContent ? parseProfileBasics(profileContent) : null;

  // Parse learnings (extract recent entries)
  const learnings = learningsContent ? extractRecentLearnings(learningsContent, 15) : [];

  // Parse PRs
  const currentPRs: PRsData = prsContent ? parsePRsYaml(prsContent) : {};

  // Parse weekly plan and find today's workout
  let currentWeekPlan: WeeklyPlan | null = null;
  let todaysPlan: DayPlan | null = null;

  if (weeklyPlanContent) {
    currentWeekPlan = parseWeeklyPlanBasics(weeklyPlanContent, currentWeek);
    todaysPlan = findTodaysPlan(currentWeekPlan, today);
  }

  // Load in-progress workout if exists
  let inProgressWorkout: WorkoutLog | null = null;
  if (inProgressBranch) {
    const inProgressContent = await storage.readFile('workouts/in-progress.md', inProgressBranch);
    if (inProgressContent) {
      inProgressWorkout = parseWorkoutBasics(inProgressContent, inProgressBranch);
    }
  }

  // Load recent workouts (last 5)
  const recentWorkouts: WorkoutLog[] = [];
  const sortedFiles = recentWorkoutFiles
    .filter(f => f.endsWith('.md') && !f.includes('in-progress'))
    .sort()
    .reverse()
    .slice(0, 5);

  for (const file of sortedFiles) {
    const content = await storage.readFile(file);
    if (content) {
      const workout = parseWorkoutBasics(content);
      if (workout) {
        recentWorkouts.push(workout);
      }
    }
  }

  return {
    profile,
    learnings,
    currentWeekPlan,
    inProgressWorkout,
    recentWorkouts,
    currentPRs,
    todaysPlan,
  };
}

/**
 * Format context for inclusion in the system prompt
 */
export function formatContextForPrompt(context: AgentContext, timezone: string): string {
  const sections: string[] = [];
  const today = new Date();
  const todayStr = formatDateHuman(today);

  sections.push(`## Current Context\n`);
  sections.push(`**Today:** ${todayStr}`);
  sections.push(`**Timezone:** ${timezone}`);

  // Profile summary
  if (context.profile) {
    sections.push(`\n### Client Profile\n`);
    sections.push(`- **Name:** ${context.profile.name}`);
    if (context.profile.goals?.primary?.length) {
      sections.push(`- **Primary Goals:** ${context.profile.goals.primary.join(', ')}`);
    }
    if (context.profile.schedule?.targetSessionsPerWeek) {
      sections.push(`- **Target Sessions:** ${context.profile.schedule.targetSessionsPerWeek}/week`);
    }
    if (context.profile.preferences?.sessionLength) {
      sections.push(`- **Session Length:** ${context.profile.preferences.sessionLength.ideal} min ideal`);
    }
    if (context.profile.medical?.current?.length) {
      sections.push(`- **Current Limitations:** ${context.profile.medical.current.map(l => l.area).join(', ')}`);
    }
  }

  // Today's plan
  if (context.todaysPlan) {
    sections.push(`\n### Today's Plan\n`);
    if (context.todaysPlan.type === 'rest') {
      sections.push(`**Rest Day**`);
      if (context.todaysPlan.options?.length) {
        sections.push(`Options: ${context.todaysPlan.options.join(', ')}`);
      }
    } else if (context.todaysPlan.type === 'optional') {
      sections.push(`**Optional Day**`);
      if (context.todaysPlan.options?.length) {
        sections.push(`Options: ${context.todaysPlan.options.join(', ')}`);
      }
    } else {
      sections.push(`**${context.todaysPlan.workoutType || 'Workout'}**`);
      if (context.todaysPlan.targetDuration) {
        sections.push(`Duration: ~${context.todaysPlan.targetDuration} min`);
      }
      if (context.todaysPlan.exercises?.length) {
        sections.push(`\nExercises:`);
        for (const ex of context.todaysPlan.exercises.slice(0, 6)) {
          const weightStr = typeof ex.weight === 'number' ? `${ex.weight} lbs` : ex.weight;
          sections.push(`- ${ex.name}: ${ex.sets}x${ex.reps} @ ${weightStr}`);
        }
        if (context.todaysPlan.exercises.length > 6) {
          sections.push(`- ... and ${context.todaysPlan.exercises.length - 6} more`);
        }
      }
    }
  } else {
    sections.push(`\n### Today's Plan\n`);
    sections.push(`No plan loaded for today. May need to generate weekly plan.`);
  }

  // In-progress workout
  if (context.inProgressWorkout) {
    sections.push(`\n### In-Progress Workout\n`);
    sections.push(`**Started:** ${context.inProgressWorkout.started}`);
    sections.push(`**Type:** ${context.inProgressWorkout.type}`);
    sections.push(`**Branch:** ${context.inProgressWorkout.branch}`);
    if (context.inProgressWorkout.exercises.length > 0) {
      sections.push(`**Exercises logged:** ${context.inProgressWorkout.exercises.length}`);
      const lastEx = context.inProgressWorkout.exercises[context.inProgressWorkout.exercises.length - 1];
      sections.push(`**Last logged:** ${lastEx.name}`);
    }
  }

  // Current PRs (main lifts)
  const mainLifts = ['bench_press', 'squat', 'deadlift', 'overhead_press', 'weighted_pull_up'];
  const prEntries = mainLifts
    .filter(lift => context.currentPRs[lift])
    .map(lift => {
      const pr = context.currentPRs[lift].current;
      const name = lift.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      return `- **${name}:** ${pr.weight} x ${pr.reps} (est 1RM: ${pr.estimated1RM})`;
    });

  if (prEntries.length > 0) {
    sections.push(`\n### Current PRs\n`);
    sections.push(prEntries.join('\n'));
  }

  // Recent learnings
  if (context.learnings.length > 0) {
    sections.push(`\n### Recent Learnings\n`);
    for (const learning of context.learnings.slice(0, 5)) {
      sections.push(`- ${learning}`);
    }
  }

  // Recent workouts summary
  if (context.recentWorkouts.length > 0) {
    sections.push(`\n### Recent Workouts\n`);
    for (const workout of context.recentWorkouts.slice(0, 3)) {
      const status = workout.status === 'completed' ? '✓' : '⚠️';
      sections.push(`- ${status} ${workout.date}: ${workout.type}`);
    }
  }

  return sections.join('\n');
}

/**
 * Parse basic profile info from markdown
 */
function parseProfileBasics(content: string): AgentContext['profile'] {
  const frontmatter = extractFrontmatter(content);

  return {
    name: (frontmatter.name as string) || 'Client',
    timezone: (frontmatter.timezone as string) || 'America/New_York',
    telegramChatId: (frontmatter.telegram_chat_id as string) || '',
    primaryGym: (frontmatter.primary_gym as string) || '',
    goals: {
      primary: extractListSection(content, 'Primary') || [],
      secondary: extractListSection(content, 'Secondary') || [],
    },
    schedule: {
      targetSessionsPerWeek: (frontmatter.target_sessions as number) || 0,
      preferredRestDay: (frontmatter.preferred_rest_day as string) || '',
    },
    medical: {
      current: [],
    },
    preferences: {
      sessionLength: { ideal: 45 },
    },
  };
}

/**
 * Parse basic weekly plan info
 */
function parseWeeklyPlanBasics(content: string, week: string): WeeklyPlan {
  const frontmatter = extractFrontmatter(content);
  const { start, end } = parseISOWeek(week);

  return {
    week,
    startDate: start.toISOString().split('T')[0],
    endDate: end.toISOString().split('T')[0],
    generatedAt: (frontmatter.generated_at as string) || '',
    status: (frontmatter.status as 'active' | 'completed' | 'archived') || 'active',
    plannedSessions: (frontmatter.planned_sessions as number) || 0,
    theme: frontmatter.theme as string | undefined,
    days: parseDayPlans(content),
  };
}

/**
 * Parse day plans from weekly plan content
 */
function parseDayPlans(content: string): DayPlan[] {
  const days: DayPlan[] = [];

  // Split by day headers (## Day, Month DD — Type)
  const dayPattern = /## (\w+), (\w+ \d+) — (.+)/g;
  let match;

  while ((match = dayPattern.exec(content)) !== null) {
    const [, dayName, dateStr, typeStr] = match;
    const isRest = typeStr.toLowerCase().includes('rest');
    const isOptional = typeStr.toLowerCase().includes('optional');

    days.push({
      day: `${dayName}, ${dateStr}`,
      date: '', // Would need proper parsing
      type: isRest ? 'rest' : isOptional ? 'optional' : 'workout',
      workoutType: isRest || isOptional ? undefined : typeStr,
      exercises: [], // Would need detailed parsing
    });
  }

  return days;
}

/**
 * Find today's plan from the weekly plan
 */
function findTodaysPlan(plan: WeeklyPlan, todayDate: string): DayPlan | null {
  const today = new Date(todayDate);
  const dayName = getDayName(today);

  for (const day of plan.days) {
    if (day.day.startsWith(dayName)) {
      return day;
    }
  }

  return null;
}

/**
 * Parse basic workout info
 */
function parseWorkoutBasics(content: string, branch?: string): WorkoutLog {
  const frontmatter = extractFrontmatter(content);

  return {
    date: (frontmatter.date as string) || '',
    type: (frontmatter.type as string) || '',
    started: (frontmatter.started as string) || '',
    finished: frontmatter.finished as string | undefined,
    durationMinutes: frontmatter.duration_minutes as number | undefined,
    location: (frontmatter.location as string) || '',
    energyLevel: frontmatter.energy_level as number | undefined,
    status: (frontmatter.status as 'in_progress' | 'completed' | 'abandoned') || 'in_progress',
    planReference: (frontmatter.plan_reference as string) || '',
    branch: branch || (frontmatter.branch as string | undefined),
    prsHit: (frontmatter.prs_hit as { exercise: string; achievement: string }[]) || [],
    exercises: [],
  };
}

/**
 * Extract YAML frontmatter from markdown
 */
function extractFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  try {
    return YAML.parse(match[1]) || {};
  } catch {
    return {};
  }
}

/**
 * Extract a list section from markdown
 */
function extractListSection(content: string, sectionName: string): string[] {
  const pattern = new RegExp(`### ${sectionName}\\s*\\n([\\s\\S]*?)(?=###|$)`, 'i');
  const match = content.match(pattern);
  if (!match) return [];

  const items = match[1].match(/^- .+$/gm);
  return items ? items.map(item => item.replace(/^- /, '').trim()) : [];
}

/**
 * Extract recent learnings from the learnings file
 */
function extractRecentLearnings(content: string, count: number): string[] {
  const items = content.match(/^- .+$/gm);
  if (!items) return [];

  return items
    .map(item => item.replace(/^- /, '').trim())
    .slice(0, count);
}
