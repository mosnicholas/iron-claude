/**
 * Read tools — no side effects, no commits.
 *
 * The model uses these to look up profile, history, and progression data
 * on demand. PRs and learnings are NOT pre-loaded; the model calls these
 * tools when topic-relevant.
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { defineTool } from "../tool.js";
import { parseFrontmatter } from "../../integrations/storage.js";
import { getCurrentWeek, getWeekDays } from "../../utils/date.js";
import { formatRecentMessagesForPrompt } from "../../bot/message-history.js";

function readIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf-8") : null;
}

const NotFound = (what: string): string =>
  `${what} not found. The athlete may not have configured this yet.`;

export const getProfile = defineTool({
  name: "get_profile",
  description:
    "Read profile.md — the athlete's goals, schedule, equipment, limitations, preferences, and coaching style. " +
    "Call this when the topic touches preferences, coaching style, schedule constraints, or equipment.",
  schema: z.object({}),
  handler: async (_input, ctx) => {
    const content = readIfExists(join(ctx.repoPath, "profile.md"));
    return content ?? NotFound("profile.md");
  },
});

export const getLearnings = defineTool({
  name: "get_learnings",
  description:
    "Read learnings.md — accumulated patterns, preferences, and observations about the athlete. " +
    "Call when topic touches injuries, recurring issues, exercise opinions, recovery patterns, or coaching feedback. " +
    "Optionally filter to a single category.",
  schema: z.object({
    category: z
      .enum([
        "preference",
        "goal",
        "injury",
        "schedule",
        "feedback",
        "insight",
        "exercise_note",
        "weight_note",
        "recovery",
        "equipment",
      ])
      .optional()
      .describe("Filter to one category"),
  }),
  handler: async (input, ctx) => {
    const content = readIfExists(join(ctx.repoPath, "learnings.md"));
    if (!content) return NotFound("learnings.md");
    if (!input.category) return content;
    // Filter to the matching ## section.
    const lines = content.split("\n");
    const headerByCat: Record<string, string> = {
      preference: "## Preferences",
      goal: "## Goals",
      injury: "## Injuries & Limitations",
      schedule: "## Schedule & Availability",
      feedback: "## Coaching Feedback",
      insight: "## Insights",
      exercise_note: "## Exercise Notes",
      weight_note: "## Weight & Difficulty Notes",
      recovery: "## Recovery & Energy",
      equipment: "## Equipment & Gym",
    };
    const target = headerByCat[input.category];
    const out: string[] = [];
    let inSection = false;
    for (const line of lines) {
      if (line.startsWith("## ")) {
        inSection = line.trim() === target;
        if (inSection) out.push(line);
        continue;
      }
      if (inSection) out.push(line);
    }
    return out.join("\n").trim() || `No entries under ${target}.`;
  },
});

export const getPRs = defineTool({
  name: "get_prs",
  description:
    "Read prs.yaml — current personal records and history. " +
    "Call BEFORE celebrating a PR (to verify it actually beats the existing record), and " +
    "when discussing strength progression. After heavy lifts, check this to detect new PRs.",
  schema: z.object({}),
  handler: async (_input, ctx) => {
    const content = readIfExists(join(ctx.repoPath, "prs.yaml"));
    return content ?? NotFound("prs.yaml");
  },
});

export const getPlan = defineTool({
  name: "get_plan",
  description:
    "Read the weekly plan for a given ISO week (defaults to current week, e.g. 2026-W18).",
  schema: z.object({
    week: z
      .string()
      .regex(/^\d{4}-W\d{2}$/, "Format: YYYY-Www, e.g. 2026-W18")
      .optional()
      .describe("ISO week. Defaults to current week."),
  }),
  handler: async (input, ctx) => {
    const week = input.week || getCurrentWeek(ctx.timezone);
    const content = readIfExists(join(ctx.repoPath, "weeks", week, "plan.md"));
    return content ?? `No plan exists for ${week}.`;
  },
});

export const getWorkout = defineTool({
  name: "get_workout",
  description:
    "Read the workout log file for a specific date (YYYY-MM-DD). Returns the full file " +
    "including frontmatter, exercises, and summary.",
  schema: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format: YYYY-MM-DD"),
  }),
  handler: async (input, ctx) => {
    // Find which week this date belongs to by walking weeks/.
    const weeksDir = join(ctx.repoPath, "weeks");
    if (!existsSync(weeksDir)) return `No weeks directory yet.`;
    for (const week of readdirSync(weeksDir)) {
      const candidate = join(weeksDir, week, `${input.date}.md`);
      if (existsSync(candidate)) {
        return readFileSync(candidate, "utf-8");
      }
    }
    return `No workout logged on ${input.date}.`;
  },
});

interface WorkoutSummary {
  date: string;
  week: string;
  type: string;
  status: string;
  exercise_count?: number;
  prs_hit?: string[];
}

function listWorkoutFiles(repoPath: string): { week: string; date: string; path: string }[] {
  const weeksDir = join(repoPath, "weeks");
  if (!existsSync(weeksDir)) return [];
  const out: { week: string; date: string; path: string }[] = [];
  for (const week of readdirSync(weeksDir)) {
    const weekPath = join(weeksDir, week);
    for (const file of readdirSync(weekPath)) {
      const m = file.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
      if (!m) continue;
      out.push({ week, date: m[1], path: join(weekPath, file) });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export const getRecentWorkouts = defineTool({
  name: "get_recent_workouts",
  description:
    "List recent workouts as a structured summary (date, type, status, exercise count, PRs). " +
    "Use this for adherence and variety analysis — NOT a replacement for reading individual files when you need exercise details.",
  schema: z.object({
    weeks: z
      .number()
      .int()
      .min(1)
      .max(12)
      .default(4)
      .describe("How many recent weeks to scan. Default 4."),
  }),
  handler: async (input, ctx) => {
    const weeks = input.weeks ?? 4;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - weeks * 7);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const summaries: WorkoutSummary[] = [];
    for (const f of listWorkoutFiles(ctx.repoPath)) {
      if (f.date < cutoffStr) continue;
      const raw = readFileSync(f.path, "utf-8");
      const { frontmatter } = parseFrontmatter(raw);
      const exerciseMatches = raw.match(/^## .+/gm) || [];
      summaries.push({
        date: f.date,
        week: f.week,
        type: (frontmatter.type as string) || "unknown",
        status: (frontmatter.status as string) || "unknown",
        exercise_count: exerciseMatches.filter(
          (h) => !/^## (Summary|Exercises|Notes|Whoop|Warm-up|Cool-down|Amendments)/i.test(h)
        ).length,
        prs_hit: ((frontmatter.prs_hit as { exercise: string }[] | undefined) || []).map(
          (p) => p.exercise
        ),
      });
    }
    if (summaries.length === 0) return `No workouts in the last ${weeks} weeks.`;
    return JSON.stringify(summaries, null, 2);
  },
});

export const getExerciseHistory = defineTool({
  name: "get_exercise_history",
  description:
    "Find every instance of a specific exercise across recent weeks, returning " +
    "weight/reps/RPE per session. Use for progression tracking and variety analysis " +
    "(e.g. 'has bench press appeared in each of the last 3 weeks?'). " +
    "Match is case-insensitive and substring-based.",
  schema: z.object({
    exercise: z.string().describe("Exercise name to search for, e.g. 'bench press' or 'squat'"),
    weeks: z.number().int().min(1).max(26).default(8).describe("Lookback window. Default 8 weeks."),
  }),
  handler: async (input, ctx) => {
    const weeks = input.weeks ?? 8;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - weeks * 7);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const needle = input.exercise.toLowerCase();

    const hits: { date: string; type: string; section: string }[] = [];
    for (const f of listWorkoutFiles(ctx.repoPath)) {
      if (f.date < cutoffStr) continue;
      const raw = readFileSync(f.path, "utf-8");
      const { frontmatter, content } = parseFrontmatter(raw);
      // Find the relevant ## sections in body.
      const lines = content.split("\n");
      let buffer: string[] = [];
      let currentHeader: string | null = null;
      const flush = () => {
        if (currentHeader && currentHeader.toLowerCase().includes(needle)) {
          hits.push({
            date: f.date,
            type: (frontmatter.type as string) || "unknown",
            section: [currentHeader, ...buffer].join("\n").trim(),
          });
        }
      };
      for (const line of lines) {
        if (line.startsWith("## ")) {
          flush();
          currentHeader = line.replace(/^##\s+/, "");
          buffer = [];
        } else if (currentHeader) {
          buffer.push(line);
        }
      }
      flush();
      // Also search exercise list rows (markdown tables and bullets).
      const tableHits = lines.filter((l) => l.toLowerCase().includes(needle) && /[|\-*]/.test(l));
      for (const t of tableHits) {
        hits.push({
          date: f.date,
          type: (frontmatter.type as string) || "unknown",
          section: t.trim(),
        });
      }
    }
    if (hits.length === 0) {
      return `No instances of "${input.exercise}" in the last ${weeks} weeks.`;
    }
    return JSON.stringify(hits, null, 2);
  },
});

export const getWeekProgress = defineTool({
  name: "get_week_progress",
  description:
    "Show which days of a given week have workout logs vs which don't. " +
    "Useful for adherence checks and retrospectives.",
  schema: z.object({
    week: z
      .string()
      .regex(/^\d{4}-W\d{2}$/)
      .optional()
      .describe("ISO week. Defaults to current."),
  }),
  handler: async (input, ctx) => {
    const week = input.week || getCurrentWeek(ctx.timezone);
    const days = getWeekDays(week);
    const weekDir = join(ctx.repoPath, "weeks", week);
    const logged = new Map<string, { type: string; status: string }>();
    if (existsSync(weekDir)) {
      for (const file of readdirSync(weekDir)) {
        const m = file.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
        if (!m) continue;
        const raw = readFileSync(join(weekDir, file), "utf-8");
        const { frontmatter } = parseFrontmatter(raw);
        logged.set(m[1], {
          type: (frontmatter.type as string) || "unknown",
          status: (frontmatter.status as string) || "unknown",
        });
      }
    }
    const out = days.map((d) => {
      const entry = logged.get(d.date);
      return entry
        ? `- ${d.dayName} ${d.date}: ${entry.type} (${entry.status})`
        : `- ${d.dayName} ${d.date}: no log`;
    });
    return `Week ${week}:\n${out.join("\n")}`;
  },
});

export const getMessageHistory = defineTool({
  name: "get_message_history",
  description:
    "Read recent Telegram messages exchanged with the athlete, oldest first. " +
    "Useful when continuing a conversation thread or recalling what they said earlier today.",
  schema: z.object({
    count: z.number().int().min(1).max(50).default(20),
  }),
  handler: async (input) => {
    return formatRecentMessagesForPrompt(input.count ?? 20) || "No recent messages.";
  },
});

export const READ_TOOLS = [
  getProfile,
  getLearnings,
  getPRs,
  getPlan,
  getWorkout,
  getRecentWorkouts,
  getExerciseHistory,
  getWeekProgress,
  getMessageHistory,
];
