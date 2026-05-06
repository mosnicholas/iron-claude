/**
 * Context loader — builds the dynamic portion of the system prompt
 * for each handler. Stable parts (profile, coaching priorities) are
 * marked for prompt caching; volatile parts (today's workout state,
 * date) sit below the cache breakpoint.
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import type { SystemBlock } from "./llm-client.js";
import { getCurrentWeek, getDateInfoTZAware, getToday, getWeekDays } from "../utils/date.js";
import { parseFrontmatter } from "../integrations/storage.js";
import { formatRecentMessagesForPrompt } from "../bot/message-history.js";

export interface CoachContext {
  /** profile.md content, or null if absent */
  profile: string | null;
  /** Extracted from profile — block of one-line coaching priorities */
  coachingPriorities: string;
  /** Today's workout file content, or null */
  todayWorkout: string | null;
  /** Plan for the current week, or null */
  currentPlan: string | null;
  /** Brief bulleted week progress */
  weekProgress: string;
  /** Recent message history block */
  messageHistory: string;
  /** Carry-forward summary from the nightly compaction job, or null */
  conversationSummary: string | null;
  /** Date info */
  dateInfo: ReturnType<typeof getDateInfoTZAware>;
}

export function loadCoachContext(repoPath: string, timezone: string): CoachContext {
  const dateInfo = getDateInfoTZAware();
  const week = getCurrentWeek(timezone);
  const today = getToday(timezone);

  const profilePath = join(repoPath, "profile.md");
  const profile = existsSync(profilePath) ? readFileSync(profilePath, "utf-8") : null;

  const planPath = join(repoPath, "weeks", week, "plan.md");
  const currentPlan = existsSync(planPath) ? readFileSync(planPath, "utf-8") : null;

  const todayWorkoutPath = join(repoPath, "weeks", week, `${today}.md`);
  const todayWorkout = existsSync(todayWorkoutPath)
    ? readFileSync(todayWorkoutPath, "utf-8")
    : null;

  const summaryPath = join(repoPath, "state", "conversation-summary.md");
  const conversationSummary = existsSync(summaryPath) ? readFileSync(summaryPath, "utf-8") : null;

  return {
    profile,
    coachingPriorities: extractCoachingPriorities(profile),
    todayWorkout,
    currentPlan,
    weekProgress: buildWeekProgress(repoPath, week),
    messageHistory: formatRecentMessagesForPrompt(50),
    conversationSummary,
    dateInfo,
  };
}

/**
 * Pull short coaching directives out of profile.md so they're at the top
 * of context, not buried in a 100-line file. Looks for ## Coaching Style,
 * ## Preferences, and any line containing 'variety' or similar keywords.
 */
function extractCoachingPriorities(profile: string | null): string {
  if (!profile) return "(profile.md not configured — call get_profile if you need it.)";

  const sections = profile.split(/^##\s+/m).slice(1);
  const wanted = ["coaching style", "preferences", "training preferences", "communication"];
  const picked: string[] = [];
  for (const section of sections) {
    const header = section.split("\n")[0].trim().toLowerCase();
    if (wanted.some((w) => header.includes(w))) {
      const body = section
        .split("\n")
        .slice(1)
        .filter((l) => l.trim())
        .slice(0, 8)
        .join("\n");
      picked.push(`### ${section.split("\n")[0].trim()}\n${body}`);
    }
  }

  // Always lift any line that hints at variety preferences.
  const varietyLines = profile
    .split("\n")
    .filter((l) => /variety|bored|same|repeat|rotate|differ/i.test(l))
    .slice(0, 5);
  if (varietyLines.length) {
    picked.push("### Variety hints from profile\n" + varietyLines.join("\n"));
  }

  return picked.length
    ? picked.join("\n\n")
    : "(no explicit coaching style block in profile — call get_profile for full details)";
}

function buildWeekProgress(repoPath: string, week: string): string {
  const days = getWeekDays(week);
  const weekDir = join(repoPath, "weeks", week);
  const logged = new Map<string, { type: string; status: string }>();
  if (existsSync(weekDir)) {
    for (const file of readdirSync(weekDir)) {
      const m = file.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
      if (!m) continue;
      try {
        const raw = readFileSync(join(weekDir, file), "utf-8");
        const { frontmatter } = parseFrontmatter(raw);
        logged.set(m[1], {
          type: (frontmatter.type as string) || "unknown",
          status: (frontmatter.status as string) || "unknown",
        });
      } catch {
        // ignore
      }
    }
  }
  return days
    .map((d) => {
      const entry = logged.get(d.date);
      return entry
        ? `- ${d.dayName} ${d.date}: ${entry.type} (${entry.status})`
        : `- ${d.dayName} ${d.date}: —`;
    })
    .join("\n");
}

/**
 * Build the system prompt blocks for the coach handler.
 * Returns an array of blocks with cache_control set on the stable prefix.
 */
export function buildCoachSystem(context: CoachContext, basePrompt: string): SystemBlock[] {
  const stable = `${basePrompt}

# Athlete profile
${context.profile ?? "(not configured)"}

# Coaching priorities (extracted from profile)
${context.coachingPriorities}`;

  const summaryBlock = context.conversationSummary
    ? `## Carry-forward from previous days\n${truncate(context.conversationSummary, 2000)}\n\n`
    : "";

  const dynamic = `# Current state
- Today: ${context.dateInfo.dayOfWeek}, ${context.dateInfo.date} (${context.dateInfo.timezone})
- Current week: ${context.dateInfo.isoWeek}

${summaryBlock}## This week's plan
${context.currentPlan ? truncate(context.currentPlan, 4000) : "(no plan saved for this week)"}

## Today's workout
${context.todayWorkout ? truncate(context.todayWorkout, 2000) : "(no workout file for today yet)"}

## This week's progress
${context.weekProgress}

${context.messageHistory}`;

  return [
    { type: "text", text: stable, cache_control: { type: "ephemeral" } },
    { type: "text", text: dynamic },
  ];
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "\n…[truncated]";
}
