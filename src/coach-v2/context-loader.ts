/**
 * Context loader — builds the dynamic portion of the system prompt
 * for each handler. Stable parts (profile, coaching priorities) are
 * marked for prompt caching; volatile parts (today's workout state,
 * date) sit below the cache breakpoint.
 */

import type { SystemBlock } from "./llm-client.js";
import { getCurrentWeek, getDateInfoTZAware, getToday, getWeekDays } from "../utils/date.js";
import { formatRecentMessagesForPrompt } from "../bot/message-history.js";
import { getStorage } from "../storage/db.js";
import type { WorkoutWithDetails } from "../storage/storage.js";

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

export async function loadCoachContext(userId: string, timezone: string): Promise<CoachContext> {
  const dateInfo = getDateInfoTZAware();
  const week = getCurrentWeek(timezone);
  const today = getToday(timezone);
  const storage = getStorage();

  const [profileRow, planRow, todayWorkoutRow, summaryRow, weekProgress, messageHistory] =
    await Promise.all([
      storage.readProfile(userId),
      storage.readWeeklyPlan(userId, week),
      storage.getWorkout(userId, today),
      storage.readConversationSummary(userId),
      buildWeekProgress(userId, week),
      formatRecentMessagesForPrompt(userId, 50),
    ]);

  const profile = profileRow?.body ?? null;
  const coachingPriorities = profileRow?.coachingPriorities ?? extractCoachingPriorities(profile);

  return {
    profile,
    coachingPriorities,
    todayWorkout: todayWorkoutRow ? renderWorkoutForContext(todayWorkoutRow) : null,
    currentPlan: planRow?.body ?? null,
    weekProgress,
    messageHistory,
    conversationSummary: summaryRow?.body ?? null,
    dateInfo,
  };
}

/**
 * Render a structured workout into a compact markdown snippet for the prompt:
 * a small header followed by each exercise and its sets.
 */
function renderWorkoutForContext(workout: WorkoutWithDetails): string {
  const lines: string[] = [];
  lines.push(`# ${workout.date} — ${workout.type} (${workout.status})`);
  if (workout.exercises.length === 0) {
    lines.push("");
    lines.push("(no exercises logged yet)");
    return lines.join("\n");
  }

  for (const ex of workout.exercises) {
    lines.push("");
    lines.push(`## ${ex.name}`);
    if (ex.sets.length === 0) {
      lines.push("(no sets yet)");
    } else {
      for (const s of ex.sets) {
        const weight = s.weight !== null ? `${s.weight}` : (s.weightText ?? "BW");
        const rpe = s.rpe !== null && s.rpe !== undefined ? ` @ RPE ${s.rpe}` : "";
        lines.push(`- ${weight} x ${s.reps}${rpe}`);
      }
    }
    if (ex.notes) {
      lines.push(`notes: ${ex.notes}`);
    }
  }
  return lines.join("\n");
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

async function buildWeekProgress(userId: string, week: string): Promise<string> {
  const days = getWeekDays(week);
  const storage = getStorage();
  const rows = await storage.listWeekDates(userId, week);
  const logged = new Map<string, { type: string; status: string }>();
  for (const r of rows) {
    logged.set(r.date, { type: r.type, status: r.status });
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

  const onboardingDirective =
    context.profile === null
      ? `\n**This is the athlete's first session.** Load the \`onboarding\` skill via the \`load_skill\` tool before continuing. Don't skip — without a profile, every future turn will be blind.\n`
      : "";

  const dynamic = `# Current state
- Today: ${context.dateInfo.dayOfWeek}, ${context.dateInfo.date} (${context.dateInfo.timezone})
- Current week: ${context.dateInfo.isoWeek}
${onboardingDirective}
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
