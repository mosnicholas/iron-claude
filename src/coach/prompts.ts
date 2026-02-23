/**
 * Prompt Management
 *
 * Loads and templates prompt files for the coach agent.
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getConfiguredIntegrations, hasConfiguredIntegrations } from "../integrations/registry.js";
import { getDateInfoTZAware, getWeekDays } from "../utils/date.js";
import { formatRecentMessagesForPrompt } from "../bot/message-history.js";

export interface WorkoutLogSummary {
  date: string; // "2026-02-03"
  type: string; // "upper", "lower", etc.
  status: string; // "completed", "in_progress", "abandoned"
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "../../prompts");

export function loadPrompt(name: string): string {
  const path = join(PROMPTS_DIR, `${name}.md`);

  if (!existsSync(path)) {
    throw new Error(`Prompt file not found: ${path}`);
  }

  return readFileSync(path, "utf-8");
}

function loadPartial(name: string): string {
  const path = join(PROMPTS_DIR, "partials", `${name}.md`);

  if (!existsSync(path)) {
    throw new Error(`Partial prompt not found: ${path}`);
  }

  return readFileSync(path, "utf-8");
}

export interface SystemPromptContext {
  repoPath?: string;
  gitBinaryPath?: string;
  weeklyPlan?: string; // Current week's plan content
  prsYaml?: string; // Personal records YAML content
  learnings?: string; // Learnings/memories about the athlete
  todayWorkout?: string; // Today's workout log if it exists
  weekProgress?: WorkoutLogSummary[]; // Workout logs found for this week
  messageHistoryCount?: number; // Number of recent messages to include (default: 10)
}

/**
 * Build context about connected device integrations.
 */
function buildIntegrationContext(): string {
  if (!hasConfiguredIntegrations()) {
    return "";
  }

  const integrations = getConfiguredIntegrations();
  const integrationNames = integrations.map((i) => i.name).join(", ");

  return `
## Device Integrations

You have access to data from connected fitness devices: **${integrationNames}**

Integration data is stored in the workout file frontmatter under the device name:

\`\`\`yaml
---
date: "2026-01-27"
type: upper
status: in_progress
whoop:
  recovery:
    score: 78
    hrv: 45.2
    restingHeartRate: 52
  sleep:
    durationMinutes: 420
    score: 85
    stages: { rem: 90, deep: 85, light: 200, awake: 45 }
  workouts:
    - type: Weightlifting
      durationMinutes: 45
      strain: 12.5
      calories: 320
---
\`\`\`

### Using Recovery Data

Recovery scores indicate readiness for training:
- **80-100%**: High recovery - good day for intense training or attempting PRs
- **60-79%**: Moderate recovery - standard training intensity recommended
- **40-59%**: Low recovery - consider lighter intensity or active recovery
- **0-39%**: Very low recovery - prioritize rest and recovery

### When to Reference Integration Data

1. **Daily reminders**: Check today's recovery score from frontmatter and mention it
2. **Weekly planning**: Consider the week's recovery trends when setting intensity
3. **Retrospectives**: Include HRV and recovery trends in analysis
4. **Workout feedback**: Compare device-recorded strain/HR with planned intensity

Read the day's workout file (e.g., \`weeks/2026-W05/2026-01-27.md\`) to access integration data.
`;
}

/**
 * Build a summary of this week's actual workout logs vs the week's days.
 */
function buildWeekProgressSection(workouts: WorkoutLogSummary[], isoWeek: string): string {
  if (workouts.length === 0 && !isoWeek) return "";

  const weekDays = getWeekDays(isoWeek);
  const workoutsByDate = new Map(workouts.map((w) => [w.date, w]));

  // List actual workouts found
  const loggedLines = weekDays
    .filter((day) => workoutsByDate.has(day.date))
    .map((day) => {
      const w = workoutsByDate.get(day.date)!;
      return `- **${day.dayName}, ${day.dateHuman}**: ${w.type} (${w.status})`;
    });

  // List days with no workout
  const missingDays = weekDays
    .filter((day) => !workoutsByDate.has(day.date))
    .map((day) => `${day.dayName} (${day.dateHuman})`);

  const completed = workouts.filter((w) => w.status === "completed").length;
  const inProgress = workouts.filter((w) => w.status === "in_progress").length;

  let section = `
## This Week's Workout Logs (${isoWeek})

**These are the ACTUAL workouts recorded this week** (source of truth for what was done):

`;

  if (loggedLines.length > 0) {
    section += loggedLines.join("\n") + "\n\n";
  } else {
    section += "No workouts logged yet this week.\n\n";
  }

  if (missingDays.length > 0) {
    section += `Days with NO workout logged: ${missingDays.join(", ")}\n\n`;
  }

  section += `Completed: ${completed} | In Progress: ${inProgress} | Total logged: ${workouts.length}\n`;

  return section;
}

export function buildSystemPrompt(context?: SystemPromptContext): string {
  const {
    repoPath,
    gitBinaryPath,
    weeklyPlan,
    prsYaml,
    learnings,
    todayWorkout,
    weekProgress = [],
    messageHistoryCount = 10,
  } = context || {};

  const systemPrompt = loadPrompt("system");

  const dateInfo = getDateInfoTZAware();

  // Build environment info section if we have paths
  const envInfo =
    repoPath || gitBinaryPath
      ? `
## Environment

${repoPath ? `- **Fitness data repo**: \`${repoPath}\` (this is your current working directory)` : ""}
${gitBinaryPath ? `- **Git binary**: \`${gitBinaryPath}\` (use this full path for git commands)` : ""}

IMPORTANT: Your working directory is already set to the fitness-data repo. Use relative paths like \`profile.md\` or \`weeks/2024-W05/plan.md\`, not absolute paths.
`
      : "";

  // Build integration context (if any devices are connected)
  const integrationContext = buildIntegrationContext();

  // Get recent message history
  const messageHistory = formatRecentMessagesForPrompt(messageHistoryCount);

  // Format the weekly plan if provided
  const weeklyPlanSection = weeklyPlan
    ? `
## This Week's Plan (${dateInfo.isoWeek})

<current-weekly-plan>
${weeklyPlan}
</current-weekly-plan>

Use this plan as context when discussing workouts. Reference the scheduled exercises, weights, and targets.
`
    : "";

  // Format PRs if provided
  const prsSection = prsYaml
    ? `
## Personal Records

<current-prs>
${prsYaml}
</current-prs>

Reference these PRs when discussing progress, setting targets, or detecting new records.
`
    : "";

  // Format learnings/memories if available
  const learningsSection = learnings
    ? `
## Athlete Memories (learnings.md)

<learnings>
${learnings}
</learnings>

These are things you've learned about the athlete across sessions. Reference them when coaching, planning, or giving feedback. Use the \`save_memory\` tool to add new memories during conversation.
`
    : "";

  // Format today's workout if it exists (active or completed)
  const todayWorkoutSection = todayWorkout
    ? `
## Today's Workout Log (${dateInfo.date})

<today-workout>
${todayWorkout}
</today-workout>

This is the current state of today's workout. Use this to track what's been logged.
`
    : "";

  // Build week progress section from actual workout log files
  const weekProgressSection = buildWeekProgressSection(weekProgress, dateInfo.isoWeek);

  // Always load the most common reference guides (workout management + exercise parsing)
  const referenceGuides = [
    `<exercise-parsing>\n${loadPartial("exercise-parsing")}\n</exercise-parsing>`,
    `<workout-management>\n${loadPartial("workout-management")}\n</workout-management>`,
    `<pr-detection>\n${loadPartial("pr-detection")}\n</pr-detection>`,
  ].join("\n\n");

  const contextNote = `
## Current Date & Time

**IMPORTANT: Use this date for all calculations. Do NOT infer the day from plan content.**

- **Today is**: ${dateInfo.dayOfWeek}, ${dateInfo.date} (THIS IS THE CORRECT DAY)
- **Current time**: ${dateInfo.time} (${dateInfo.timezone})
- **Current week**: ${dateInfo.isoWeek}

Use these values when creating file paths and branch names. When asked about "today's workout", use ${dateInfo.dayOfWeek} to find the correct day in the plan.
${envInfo}
${messageHistory ? `\n${messageHistory}\n` : ""}
${weeklyPlanSection}
${prsSection}
${learningsSection}
${todayWorkoutSection}
${weekProgressSection}
## Scheduling Notes

- **Weekly retrospective + next week's plan**: Generated Sunday at 8pm (after user answers planning questions)
- **Daily workout reminder**: Sent at 6am on weekdays
- **Reminders**: Checked hourly, see state/reminders.json

## File Access

You have direct access to the fitness-data repository files:
- profile.md - User profile, goals, preferences
- learnings.md - Patterns discovered about the user
- prs.yaml - Personal records
- weeks/ - Week-based organization (YYYY-WXX folders)
  - weeks/YYYY-WXX/plan.md - Weekly training plan
  - weeks/YYYY-WXX/retro.md - Weekly retrospective
  - weeks/YYYY-WXX/YYYY-MM-DD.md - Workout logs by date

Use Read, Glob, and Grep to explore files. Use Edit/Write to update them.
Current timezone: ${dateInfo.timezone}
${integrationContext}
## Reference Guides

${referenceGuides}
`;

  return systemPrompt.replace("{{CONTEXT}}", contextNote);
}

// ============================================================================
// Exported instruction constants for cron jobs and webhook routing
// ============================================================================

export const RETRO_INSTRUCTIONS = `
Generate the weekly retrospective for the ending week.

Steps:
1. Use Glob to find all workout files in the ending week's folder (weeks/YYYY-WXX/*.md)
2. Read each workout file — note exercises, weights, sets, RPE, PRs hit, energy levels
3. Read the week's plan.md and compare plan vs actual (adherence, modifications, skips, additions)
4. Read prs.yaml for current PR numbers
5. Read learnings.md for existing patterns
6. Write the retrospective to weeks/YYYY-WXX/retro.md covering:
   - Plan adherence summary
   - Key lifts and progression
   - PRs hit this week
   - Energy/recovery trends
   - Patterns or observations for learnings.md
7. If you notice new patterns, append them to learnings.md
8. Commit changes
`;

export const PLAN_GENERATION_INSTRUCTIONS = `
The user is responding to your weekly planning questions. Generate next week's training plan.

Steps:
1. Read profile.md for goals and preferences
2. Read prs.yaml for current numbers
3. Use Glob to read the last 2-3 weeks of workout files for progression context
4. Read learnings.md for coaching observations
5. Incorporate the user's answers to your planning questions (their message above)
6. Apply progressive overload where appropriate, deload if fatigue indicators warrant it
7. Write the plan to weeks/YYYY-WXX/plan.md (for the upcoming week)
8. Commit changes
9. Summarize the plan to the user — highlight key changes from last week and how their input shaped it

After generating the plan, delete the file state/planning-pending.md to signal planning is complete.
`;
