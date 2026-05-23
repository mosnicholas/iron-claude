/**
 * Read tools — no side effects, no commits.
 *
 * The model uses these to look up profile, history, and progression data
 * on demand. PRs and learnings are NOT pre-loaded; the model calls these
 * tools when topic-relevant.
 *
 * All reads go through `ctx.storage` (DB-backed) — no filesystem access.
 */

import { z } from "zod";
import { stringify as stringifyYaml } from "yaml";
import { defineTool } from "../tool.js";
import { getCurrentWeek, getWeekDays } from "../../utils/date.js";
import { getPhotoSignedUrl } from "../../storage/photos.js";
import type { Pr } from "../../db/schema.js";
import type { WorkoutWithDetails } from "../../storage/storage.js";

const NotFound = (what: string): string =>
  `${what} not found. The athlete may not have configured this yet.`;

export const getProfile = defineTool({
  name: "get_profile",
  description:
    "Read profile.md — the athlete's goals, schedule, equipment, limitations, preferences, and coaching style. " +
    "Call this when the topic touches preferences, coaching style, schedule constraints, or equipment.",
  schema: z.object({}),
  handler: async (_input, ctx) => {
    const profile = await ctx.storage.readProfile(ctx.userId);
    return profile?.body ?? NotFound("profile.md");
  },
});

export const getLearnings = defineTool({
  name: "get_learnings",
  description:
    "Read learnings.md — accumulated patterns, preferences, and observations about the athlete. " +
    "Call when topic touches injuries, recurring issues, exercise opinions, recovery patterns, or coaching feedback.",
  schema: z.object({}),
  handler: async (_input, ctx) => {
    const body = await ctx.storage.readLearnings(ctx.userId);
    return body ?? NotFound("learnings.md");
  },
});

/**
 * Format the PR table into a YAML-ish block the model can read.
 * Groups by exercise: current first, then history (most recent first).
 */
function formatPRs(rows: Pr[]): string {
  if (rows.length === 0) return NotFound("prs.yaml");
  const byExercise = new Map<string, { current: Pr | null; history: Pr[] }>();
  for (const pr of rows) {
    const bucket = byExercise.get(pr.exercise) ?? { current: null, history: [] };
    if (pr.isCurrent && !bucket.current) {
      bucket.current = pr;
    } else {
      bucket.history.push(pr);
    }
    byExercise.set(pr.exercise, bucket);
  }
  // Render as a YAML-shaped string for readability.
  const tree: Record<string, unknown> = {};
  for (const [exercise, { current, history }] of byExercise.entries()) {
    const entry: Record<string, unknown> = {};
    if (current) {
      const e1 = current.estimated1Rm != null ? ` (e1RM ${current.estimated1Rm})` : "";
      entry.current = `${current.weight} x ${current.reps}${e1} on ${current.date}`;
    }
    if (history.length > 0) {
      entry.history = history.map((h) => {
        const e1 = h.estimated1Rm != null ? ` (e1RM ${h.estimated1Rm})` : "";
        return `${h.weight} x ${h.reps}${e1} on ${h.date}`;
      });
    }
    tree[exercise] = entry;
  }
  return stringifyYaml(tree);
}

export const getPRs = defineTool({
  name: "get_prs",
  description:
    "Read prs.yaml — current personal records and history. " +
    "Call BEFORE celebrating a PR (to verify it actually beats the existing record), and " +
    "when discussing strength progression. After heavy lifts, check this to detect new PRs.",
  schema: z.object({}),
  handler: async (_input, ctx) => {
    const rows = await ctx.storage.readPRs(ctx.userId);
    return formatPRs(rows);
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
    const plan = await ctx.storage.readWeeklyPlan(ctx.userId, week);
    return plan?.body ?? `No plan exists for ${week}.`;
  },
});

/**
 * Render a workout pulled from the DB back into the markdown shape the model
 * was trained to expect: frontmatter block, # heading, ## Exercises, then per
 * exercise `### Name` with `- weight x reps (RPE x)` lines and an optional
 * ## Summary footer.
 */
function renderWorkoutMarkdown(workout: WorkoutWithDetails): string {
  const fm: Record<string, unknown> = {
    date: String(workout.date),
    type: workout.type,
    status: workout.status,
  };
  if (workout.startedAt) fm.started = workout.startedAt;
  if (workout.finishedAt) fm.finished = workout.finishedAt;
  if (workout.durationMinutes != null) fm.duration_minutes = workout.durationMinutes;
  if (workout.energyLevel != null) fm.energy_level = workout.energyLevel;
  if (workout.location) fm.location = workout.location;
  if (workout.plannedDay) fm.planned_day = workout.plannedDay;
  const snap = workout.recoverySnapshot as Record<string, unknown> | null;
  if (snap) {
    const rec = snap.recovery as Record<string, unknown> | undefined;
    const sleep = snap.sleep as Record<string, unknown> | undefined;
    if (rec?.recovery_score != null) fm.recovery_score = rec.recovery_score;
    if (sleep?.sleep_hours != null) fm.sleep_hours = sleep.sleep_hours;
  }

  const fmBlock = `---\n${stringifyYaml(fm).trimEnd()}\n---\n`;
  const heading = `# ${String(workout.date)}\n`;

  const exerciseBlocks: string[] = [];
  for (const ex of workout.exercises) {
    const setLines = ex.sets.map((s) => {
      const w = s.weight != null ? s.weight : s.weightText;
      const rpe = s.rpe != null ? ` (RPE ${s.rpe})` : "";
      return `- ${w} x ${s.reps}${rpe}`;
    });
    const notes = ex.notes ? `\n_${ex.notes}_` : "";
    exerciseBlocks.push(`### ${ex.name}\n${setLines.join("\n")}${notes}`);
  }
  const exercisesSection =
    exerciseBlocks.length > 0
      ? `## Exercises\n\n${exerciseBlocks.join("\n\n")}\n`
      : `## Exercises\n\n`;

  const summarySection = workout.summary ? `\n## Summary\n\n${workout.summary}\n` : "";

  return `${fmBlock}\n${heading}\n${exercisesSection}${summarySection}`;
}

export const getWorkout = defineTool({
  name: "get_workout",
  description:
    "Read the workout log file for a specific date (YYYY-MM-DD). Returns the full file " +
    "including frontmatter, exercises, and summary.",
  schema: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format: YYYY-MM-DD"),
  }),
  handler: async (input, ctx) => {
    const workout = await ctx.storage.getWorkout(ctx.userId, input.date);
    if (!workout) return `No workout logged on ${input.date}.`;
    return renderWorkoutMarkdown(workout);
  },
});

interface WorkoutSummaryOut {
  date: string;
  week: string;
  type: string;
  status: string;
  exercise_count?: number;
  prs_hit?: string[];
}

export const getWorkouts = defineTool({
  name: "get_workouts",
  description:
    "Summarize logged workouts. Two formats:\n" +
    "- 'summary' (default): list each workout with date, type, status, exercise count, and PRs " +
    "across the last N weeks. Use for variety analysis and progression context.\n" +
    "- 'adherence': per-day breakdown of a single ISO week showing logged vs. no-log. " +
    "Use for retros and 'how many days did I train this week?'.\n" +
    "Pass `week` (e.g. 2026-W18) for adherence, or `weeks` (count) for summary.",
  schema: z.object({
    format: z.enum(["summary", "adherence"]).default("summary"),
    weeks: z
      .number()
      .int()
      .min(1)
      .max(12)
      .optional()
      .describe("Lookback in weeks for format=summary. Default 4."),
    week: z
      .string()
      .regex(/^\d{4}-W\d{2}$/, "Format: YYYY-Www, e.g. 2026-W18")
      .optional()
      .describe("ISO week for format=adherence. Defaults to current."),
  }),
  handler: async (input, ctx) => {
    const format = input.format ?? "summary";
    if (format === "adherence") {
      const week = input.week || getCurrentWeek(ctx.timezone);
      const days = getWeekDays(week);
      const rows = await ctx.storage.listWorkouts(ctx.userId, { isoWeek: week });
      const logged = new Map<string, { type: string; status: string }>();
      for (const r of rows) {
        logged.set(r.date, { type: r.type, status: r.status });
      }
      const out = days.map((d) => {
        const entry = logged.get(d.date);
        return entry
          ? `- ${d.dayName} ${d.date}: ${entry.type} (${entry.status})`
          : `- ${d.dayName} ${d.date}: no log`;
      });
      return `Week ${week}:\n${out.join("\n")}`;
    }

    const weeks = input.weeks ?? 4;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - weeks * 7);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    // Pull a generous window; the DB returns most-recent first.
    const all = await ctx.storage.listWorkouts(ctx.userId, { limit: weeks * 8 });
    const summaries: WorkoutSummaryOut[] = [];
    for (const r of all) {
      if (r.date < cutoffStr) continue;
      summaries.push({
        date: r.date,
        week: r.isoWeek,
        type: r.type,
        status: r.status,
        exercise_count: r.exerciseCount,
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

    // Pull a generous slice (up to 4× weekly cadence) and filter client-side by
    // date; storage only knows about row count, not weeks.
    const history = await ctx.storage.getExerciseHistory(ctx.userId, input.exercise, weeks * 4);
    const hits = history
      .filter((h) => h.date >= cutoffStr)
      .map((h) => ({
        date: h.date,
        type: h.type,
        sets: h.sets.map((s) => {
          const rpe = s.rpe != null ? ` (RPE ${s.rpe})` : "";
          return `${s.weight} x ${s.reps}${rpe}`;
        }),
        notes: h.notes ?? undefined,
      }));

    if (hits.length === 0) {
      return `No instances of "${input.exercise}" in the last ${weeks} weeks.`;
    }
    return JSON.stringify(hits, null, 2);
  },
});

export const getProgressPhoto = defineTool({
  name: "get_progress_photo",
  description:
    "Retrieve a past progress photo by date or by index (most recent = 0). " +
    "Returns a signed URL the model can describe verbally — image bytes aren't " +
    "inlined to avoid context bloat. Use when the athlete asks 'how have I " +
    "changed' or 'compare to last month'. " +
    "If `date` is set, returns the photo nearest that date within 7 days. " +
    "If `index` is set, returns the Nth-most-recent (0 = newest). " +
    "Defaults to the most recent photo.",
  schema: z.object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Format: YYYY-MM-DD")
      .optional()
      .describe("Target date; pick the photo nearest this date within 7 days."),
    index: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Most recent = 0. Ignored if `date` is provided."),
  }),
  handler: async (input, ctx) => {
    // Pull a generous slice; the model rarely cares about photos older than
    // the last ~year and we want to avoid loading bytes-free metadata into
    // memory unnecessarily.
    const all = await ctx.storage.listPhotos(ctx.userId, { limit: 200 });
    if (all.length === 0) {
      return "No progress photos found for this athlete.";
    }

    let chosen = all[0];
    if (input.date) {
      const target = new Date(input.date).getTime();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      let best: { row: (typeof all)[number]; delta: number } | null = null;
      for (const row of all) {
        const delta = Math.abs(new Date(row.takenAt).getTime() - target);
        if (delta <= sevenDaysMs && (!best || delta < best.delta)) {
          best = { row, delta };
        }
      }
      if (!best) {
        return `No progress photo found within 7 days of ${input.date}.`;
      }
      chosen = best.row;
    } else if (typeof input.index === "number") {
      if (input.index >= all.length) {
        return `Only ${all.length} progress photo(s) on file; index ${input.index} is out of range.`;
      }
      chosen = all[input.index];
    }

    const url = await getPhotoSignedUrl(ctx.userId, chosen.id);
    if (!url) {
      return `Photo from ${chosen.takenAt.toISOString().slice(0, 10)} is not currently retrievable.`;
    }
    const dateStr = new Date(chosen.takenAt).toISOString().slice(0, 10);
    const captionPart = chosen.caption ? `, ${chosen.caption}` : "";
    return `Progress photo from ${dateStr}${captionPart}: ${url}\n(URL expires in 5 min)`;
  },
});

export const READ_TOOLS = [
  getProfile,
  getLearnings,
  getPRs,
  getPlan,
  getWorkout,
  getWorkouts,
  getExerciseHistory,
  getProgressPhoto,
];
