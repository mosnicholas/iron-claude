/**
 * Prompt Management
 *
 * Loads and templates prompt files for the coach agent.
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getDateInfoTZAware } from "../utils/date.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "../../prompts");

export function loadPrompt(name: string): string {
  const path = join(PROMPTS_DIR, `${name}.md`);

  if (!existsSync(path)) {
    throw new Error(`Prompt file not found: ${path}`);
  }

  return readFileSync(path, "utf-8");
}

export function loadPartial(name: string): string {
  const path = join(PROMPTS_DIR, "partials", `${name}.md`);

  if (!existsSync(path)) {
    throw new Error(`Partial prompt not found: ${path}`);
  }

  return readFileSync(path, "utf-8");
}

export interface SystemPromptContext {
  repoPath?: string;
  gitBinaryPath?: string;
}

export function buildSystemPrompt(context?: SystemPromptContext): string {
  const { repoPath, gitBinaryPath } = context || {};

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

  const contextNote = `
## Current Date & Time

**IMPORTANT: Use this date for all calculations. Do NOT infer the day from plan content.**

- **Today is**: ${dateInfo.dayOfWeek}, ${dateInfo.date} (THIS IS THE CORRECT DAY)
- **Current time**: ${dateInfo.time} (${dateInfo.timezone})
- **Current week**: ${dateInfo.isoWeek}

Use these values when creating file paths and branch names. When asked about "today's workout", use ${dateInfo.dayOfWeek} to find the correct day in the plan.
${envInfo}
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

export function buildOnboardingPrompt(): string {
  return loadPrompt("onboarding");
}
