/**
 * Prompt Management
 *
 * Loads and templates prompt files for the coach agent.
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getConfiguredIntegrations, hasConfiguredIntegrations } from "../integrations/registry.js";
import { getDateInfoTZAware } from "../utils/date.js";
import { formatRecentMessagesForPrompt } from "../bot/message-history.js";

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
  todayWorkout?: string; // Today's workout log if it exists
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

Integration data is stored alongside workout logs in the weekly folders:
- \`weeks/YYYY-WXX/integrations/YYYY-MM-DD-{device}-sleep.json\` - Sleep data
- \`weeks/YYYY-WXX/integrations/YYYY-MM-DD-{device}-recovery.json\` - Recovery data
- \`weeks/YYYY-WXX/integrations/YYYY-MM-DD-{device}-workout-{type}.json\` - Device workouts

### Using Recovery Data

Recovery scores indicate readiness for training:
- **80-100%**: High recovery - good day for intense training or attempting PRs
- **60-79%**: Moderate recovery - standard training intensity recommended
- **40-59%**: Low recovery - consider lighter intensity or active recovery
- **0-39%**: Very low recovery - prioritize rest and recovery

### When to Reference Integration Data

1. **Daily reminders**: Check today's recovery score and mention it if available
2. **Weekly planning**: Consider the week's recovery trends when setting intensity
3. **Retrospectives**: Include HRV and recovery trends in analysis
4. **Workout feedback**: Compare device-recorded strain/HR with planned intensity

### Data Format Examples

**Recovery JSON** (weeks/2026-W05/integrations/2026-01-27-whoop-recovery.json):
\`\`\`json
{
  "source": "whoop",
  "date": "2026-01-27",
  "score": 78,
  "hrv": 45.2,
  "restingHeartRate": 52
}
\`\`\`

**Sleep JSON** (weeks/2026-W05/integrations/2026-01-27-whoop-sleep.json):
\`\`\`json
{
  "source": "whoop",
  "date": "2026-01-27",
  "durationMinutes": 420,
  "score": 85,
  "stages": { "rem": 90, "deep": 85, "light": 200, "awake": 45 }
}
\`\`\`

Use Glob with pattern \`weeks/*/integrations/*-recovery.json\` to find recovery data.
`;
}

export function buildSystemPrompt(context?: SystemPromptContext): string {
  const {
    repoPath,
    gitBinaryPath,
    weeklyPlan,
    prsYaml,
    todayWorkout,
    messageHistoryCount = 10,
  } = context || {};

  const systemPrompt = loadPrompt("system");

  const exerciseParsing = loadPartial("exercise-parsing");
  const workoutManagement = loadPartial("workout-management");
  const prDetection = loadPartial("pr-detection");

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
${todayWorkoutSection}
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

<exercise-parsing>
${exerciseParsing}
</exercise-parsing>

<workout-management>
${workoutManagement}
</workout-management>

<pr-detection>
${prDetection}
</pr-detection>
`;

  return systemPrompt.replace("{{CONTEXT}}", contextNote);
}

export function buildWeeklyPlanningPrompt(): string {
  return loadPrompt("weekly-planning");
}

export function buildRetrospectivePrompt(): string {
  return loadPrompt("retrospective");
}
