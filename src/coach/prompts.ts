/**
 * Prompt Management
 *
 * Loads and templates prompt files for the coach agent.
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

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

function getCurrentDateInfo(timezone: string): {
  date: string;
  time: string;
  dayOfWeek: string;
  isoWeek: string;
} {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";

  const year = get("year");
  const month = get("month");
  const day = get("day");
  const dayOfWeek = get("weekday");
  const hour = get("hour");
  const minute = get("minute");

  // Calculate ISO week number
  const date = new Date(`${year}-${month}-${day}T12:00:00`);
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const days = Math.floor((date.getTime() - startOfYear.getTime()) / 86400000);
  const weekNum = Math.ceil((days + startOfYear.getDay() + 1) / 7);
  const isoWeek = `${year}-W${String(weekNum).padStart(2, "0")}`;

  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}`,
    dayOfWeek,
    isoWeek,
  };
}

export interface SystemPromptContext {
  timezone: string;
  repoPath?: string;
  gitBinaryPath?: string;
}

export function buildSystemPrompt(context: SystemPromptContext | string): string {
  // Support legacy string-only call for backwards compatibility
  const { timezone, repoPath, gitBinaryPath } =
    typeof context === "string"
      ? { timezone: context, repoPath: undefined, gitBinaryPath: undefined }
      : context;

  const systemPrompt = loadPrompt("system");

  const exerciseParsing = loadPartial("exercise-parsing");
  const workoutManagement = loadPartial("workout-management");
  const prDetection = loadPartial("pr-detection");

  const dateInfo = getCurrentDateInfo(timezone);

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

- **Today**: ${dateInfo.dayOfWeek}, ${dateInfo.date}
- **Current time**: ${dateInfo.time} (${timezone})
- **Current week**: ${dateInfo.isoWeek}

Use these values when creating file paths and branch names.
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
Current timezone: ${timezone}

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
