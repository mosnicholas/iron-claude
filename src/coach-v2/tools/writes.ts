/**
 * Write tools — every one of these mutates user state via the Storage
 * interface (Postgres-backed). The model never sees file paths or commit
 * status; results are short status strings.
 *
 * Reliability features:
 *   - All multi-step mutations are wrapped in a DB transaction inside Storage.
 *   - Idempotency for log_exercise is handled structurally by
 *     `Storage.appendExerciseSets` (skip if trailing sets match identically).
 */

import { z } from "zod";
import { defineTool } from "../tool.js";
import {
  calendarInfoFor,
  getCurrentWeek,
  getDateInfoTZAware,
  getToday,
} from "../../utils/date.js";
import { calculate1RM } from "../../utils/pr-calculator.js";
import type { ToolContext } from "../tool.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface DateInfo {
  date: string;
  isoWeek: string;
  dayName: string;
  isBackfill: boolean;
}

function dateInfoFor(explicitDate: string | undefined, timezone: string): DateInfo {
  const today = getToday(timezone);
  if (explicitDate && explicitDate !== today) {
    const info = calendarInfoFor(explicitDate);
    return {
      date: info.date,
      isoWeek: info.week,
      dayName: info.dayName,
      isBackfill: true,
    };
  }
  return {
    date: today,
    isoWeek: getCurrentWeek(timezone),
    dayName: getDateInfoTZAware().dayOfWeek,
    isBackfill: false,
  };
}

const DateOverrideSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
  .optional()
  .describe(
    "Optional YYYY-MM-DD override for back-filling a past workout (e.g. logging Wednesday's session on Saturday). Defaults to today."
  );

function computeDurationMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(":").map((n) => parseInt(n, 10));
  const [eh, em] = end.split(":").map((n) => parseInt(n, 10));
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return 0;
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60; // workout straddled midnight
  return mins;
}

async function resolveWorkoutId(
  ctx: ToolContext,
  date: string
): Promise<string | null> {
  const workout = await ctx.storage.getWorkout(ctx.userId, date);
  return workout?.id ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

const SetSchema = z.object({
  reps: z.number().int().positive(),
  weight: z
    .union([z.number().nonnegative(), z.string()])
    .describe("Weight in lbs, or string like 'BW' / 'BW+25'"),
  rpe: z.number().min(1).max(10).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// start_workout
// ─────────────────────────────────────────────────────────────────────────────

export const startWorkout = defineTool({
  name: "start_workout",
  description:
    "Begin a new workout. Creates weeks/YYYY-WXX/YYYY-MM-DD.md with status: in_progress " +
    "and schedules a 3-hour timeout reminder. Defaults to today; pass `date` (YYYY-MM-DD) " +
    "to back-fill a past session — back-fills skip the timeout reminder and mark the file " +
    "with back_filled: true. Idempotent: if the target file already exists, this is a no-op.",
  schema: z.object({
    type: z
      .string()
      .describe("Workout type, e.g. 'upper', 'lower', 'push', 'pull', 'legs', 'full body'"),
    location: z.string().optional().describe("Where they're training, e.g. 'gym', 'home'"),
    planned_day: z
      .string()
      .optional()
      .describe(
        "If this workout was planned for a different day (e.g. plan said Friday but doing it Saturday), the planned day name."
      ),
    date: DateOverrideSchema,
  }),
  handler: async (input, ctx) => {
    const { date, isoWeek, isBackfill } = dateInfoFor(input.date, ctx.timezone);
    const nowInfo = getDateInfoTZAware();

    // Detect "already exists" by looking up before calling startWorkout.
    const existing = await ctx.storage.getWorkout(ctx.userId, date);
    if (existing) {
      return `Workout for ${date} already exists (status: ${existing.status}, type: ${existing.type}). Use log_exercise to add sets, or get_workout to see current state.`;
    }

    const startedAt = isBackfill ? "00:00" : nowInfo.time;
    await ctx.storage.startWorkout(ctx.userId, {
      date,
      isoWeek,
      type: input.type,
      location: input.location,
      plannedDay: input.planned_day,
      backFilled: isBackfill,
      startedAt,
    });

    // Schedule the timeout reminder (best-effort, don't fail the tool).
    // Skip on back-fills — the workout already happened.
    if (!isBackfill) {
      try {
        const triggerHour = (parseInt(nowInfo.time.split(":")[0], 10) + 3) % 24;
        await ctx.storage.addReminder(ctx.userId, {
          triggerDate: date,
          triggerHour,
          message:
            "Still working out? If you're done, let me know so I can close out the session.",
          context: "workout-timeout-check",
        });
      } catch (err) {
        console.warn("[start_workout] failed to schedule timeout reminder:", err);
      }
    }

    const startedDisplay = isBackfill ? "back-filled" : nowInfo.time;
    return `Started workout for ${date}. status: in_progress, type: ${input.type}, started: ${startedDisplay} (persisted to db)`;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// log_exercise
// ─────────────────────────────────────────────────────────────────────────────

export const logExercise = defineTool({
  name: "log_exercise",
  description:
    "Append one exercise's sets to an in-progress workout file. " +
    "Defaults to today; pass `date` (YYYY-MM-DD) to log into a past day's file. " +
    "If the exercise section already exists, the new sets are added to it. " +
    "If not, a new ### section is created. If no workout file exists, one is auto-created. " +
    "ALWAYS call this when the user reports a set — never just acknowledge in text.",
  schema: z.object({
    exercise: z.string().describe("Exercise name, e.g. 'Bench Press'"),
    sets: z
      .array(SetSchema)
      .min(1)
      .describe(
        "One or more sets logged for this exercise. For a single set, pass an array of length 1."
      ),
    notes: z.string().optional().describe("Optional notes, e.g. 'felt heavy on last set'"),
    date: DateOverrideSchema,
  }),
  handler: async (input, ctx) => {
    const { date } = dateInfoFor(input.date, ctx.timezone);

    // Resolve workout. If none exists, auto-create with a reasonable default
    // type — the model can correct via edits later.
    let workoutId = await resolveWorkoutId(ctx, date);
    if (!workoutId) {
      await startWorkout.handler({ type: "workout", date: input.date }, ctx);
      workoutId = await resolveWorkoutId(ctx, date);
      if (!workoutId) {
        return `Failed to auto-create workout for ${date}.`;
      }
    }

    // Storage performs the case-insensitive exercise lookup, idempotency check,
    // and rejects appends on completed workouts.
    try {
      const result = await ctx.storage.appendExerciseSets(
        ctx.userId,
        workoutId,
        input.exercise,
        input.sets,
        input.notes
      );
      if (result.noop) {
        return `No change — ${input.exercise} sets already present.`;
      }
      return `Logged ${input.exercise} (${input.sets.length} set${input.sets.length === 1 ? "" : "s"}).`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/already completed/i.test(msg)) {
        return `Workout for ${date} is already marked complete. Cannot log additional exercises. If this is a mistake, abandon and start a new workout, or edit via /debug.`;
      }
      throw err;
    }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// complete_workout
// ─────────────────────────────────────────────────────────────────────────────

export const completeWorkout = defineTool({
  name: "complete_workout",
  description:
    "Close out a workout. Sets status (completed by default, or 'abandoned' if the athlete cut " +
    "it short), finished time, duration, energy_level, and adds a ## Summary section. ALSO " +
    "records any PRs to prs.yaml. Deletes the workout-timeout-check reminder. Defaults to today; " +
    "pass `date` (YYYY-MM-DD) to close out a back-filled past session — duration_minutes is set " +
    "to 0 on back-fills since the real times aren't known. " +
    "ALWAYS call this when the user says they're done — never leave a workout in_progress. " +
    "Use status='abandoned' only when the athlete explicitly says they're cutting it short.",
  schema: z.object({
    summary: z
      .string()
      .describe(
        "2-4 sentence summary: what went well, what was hard, anything to note for next time. " +
          "For abandoned sessions, briefly note the reason."
      ),
    energy_level: z
      .number()
      .int()
      .min(1)
      .max(10)
      .describe("Athlete's energy/feel rating, 1-10. Ask if not mentioned."),
    status: z
      .enum(["completed", "abandoned"])
      .optional()
      .describe(
        "Defaults to 'completed'. Pass 'abandoned' only when the athlete cut the session short."
      ),
    prs_hit: z
      .array(
        z.object({
          exercise: z.string(),
          weight: z.number().nonnegative(),
          reps: z.number().int().positive(),
          achievement: z
            .string()
            .describe("Short description, e.g. '175x6 (rep PR)' or '200x5 (weight PR)'"),
        })
      )
      .optional()
      .describe("PRs hit this session. Each entry will be recorded in prs.yaml."),
    date: DateOverrideSchema,
  }),
  handler: async (input, ctx) => {
    const { date, isBackfill } = dateInfoFor(input.date, ctx.timezone);

    const workout = await ctx.storage.getWorkout(ctx.userId, date);
    if (!workout) {
      return `No workout exists for ${date}. Call start_workout first.`;
    }

    const dateInfo = getDateInfoTZAware();
    const finished = isBackfill ? "00:00" : dateInfo.time;
    const started = workout.startedAt ?? finished;
    const durationMinutes = isBackfill ? 0 : computeDurationMinutes(started, finished);
    const status = input.status ?? "completed";

    const prsInput =
      input.prs_hit?.map((p) => ({
        exercise: p.exercise,
        weight: p.weight,
        reps: p.reps,
        date,
        estimated1Rm: calculate1RM(p.weight, p.reps),
      })) ?? [];

    await ctx.storage.completeWorkout(ctx.userId, workout.id, {
      summary: input.summary,
      energyLevel: input.energy_level,
      status,
      finishedAt: finished,
      durationMinutes,
      prs: prsInput,
    });

    const extra: string[] = [];
    if (prsInput.length) {
      extra.push(`Recorded ${prsInput.length} PR(s).`);
    }

    // Delete any open workout-timeout-check reminders for this user.
    try {
      const cleared = await ctx.storage.deleteRemindersByContext(
        ctx.userId,
        "workout-timeout-check"
      );
      if (cleared) extra.push(`Cleared ${cleared} timeout reminder(s).`);
    } catch (err) {
      console.warn("[complete_workout] failed to clear timeout reminder:", err);
    }

    const head = `${status === "abandoned" ? "Abandoned" : "Completed"} workout for ${date}. duration: ${durationMinutes}m, energy: ${input.energy_level}/10.`;
    return [head, ...extra].join("\n");
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// remove_exercise / edit_exercise — corrective edits to a workout's exercise
// list. Use these when sets land in the wrong file or were mis-logged.
// ─────────────────────────────────────────────────────────────────────────────

export const removeExercise = defineTool({
  name: "remove_exercise",
  description:
    "Delete an exercise's ### section from a workout file. Use when entries land in the wrong " +
    "file (e.g. yesterday's bench got logged into today's workout) or were mis-logged. To MOVE " +
    "an exercise to another date, log_exercise on the correct date first, then remove_exercise " +
    "from the wrong one. Defaults to today; pass `date` to target a past session. Match is " +
    "case-insensitive on the exact ### header text.",
  schema: z.object({
    exercise: z
      .string()
      .describe("Exercise name to remove, matching the ### header (e.g. 'Bench Press')."),
    date: DateOverrideSchema,
  }),
  handler: async (input, ctx) => {
    const { date } = dateInfoFor(input.date, ctx.timezone);
    const workoutId = await resolveWorkoutId(ctx, date);
    if (!workoutId) {
      return `No workout exists for ${date}.`;
    }
    const removed = await ctx.storage.removeExercise(ctx.userId, workoutId, input.exercise);
    if (!removed) {
      return `No "${input.exercise}" section found in ${date}'s workout.`;
    }
    return `Removed ${input.exercise} from ${date}.`;
  },
});

export const editExercise = defineTool({
  name: "edit_exercise",
  description:
    "Overwrite the sets of an existing exercise section. Use to fix wrong weights/reps or to " +
    "correct a mis-logged set. Replaces the full set list; pass every set you want to keep. " +
    "If you only want to ADD sets, use log_exercise instead. If the section doesn't exist, this " +
    "errors — use log_exercise to create it.",
  schema: z.object({
    exercise: z.string().describe("Exercise name to edit, matching the existing ### header."),
    sets: z
      .array(SetSchema)
      .min(1)
      .describe("The full corrected set list. Replaces existing sets."),
    notes: z
      .string()
      .optional()
      .describe("Optional replacement note. Pass empty string to clear an existing note."),
    date: DateOverrideSchema,
  }),
  handler: async (input, ctx) => {
    const { date } = dateInfoFor(input.date, ctx.timezone);
    const workoutId = await resolveWorkoutId(ctx, date);
    if (!workoutId) {
      return `No workout exists for ${date}.`;
    }
    const edited = await ctx.storage.editExercise(
      ctx.userId,
      workoutId,
      input.exercise,
      input.sets,
      input.notes
    );
    if (!edited) {
      return `No "${input.exercise}" section found in ${date}'s workout. Use log_exercise to create it.`;
    }
    return `Edited ${input.exercise} on ${date} (${input.sets.length} set${input.sets.length === 1 ? "" : "s"}).`;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// save_plan / amend_plan
// ─────────────────────────────────────────────────────────────────────────────

export const savePlan = defineTool({
  name: "save_plan",
  description:
    "Save (or overwrite) the weekly plan at weeks/YYYY-WXX/plan.md. " +
    "Use this once you have a complete plan written out — not for partial updates (use amend_plan).",
  schema: z.object({
    week: z.string().regex(/^\d{4}-W\d{2}$/, "Format: YYYY-Www, e.g. 2026-W18"),
    content: z.string().describe("Full markdown content of plan.md, including frontmatter."),
  }),
  handler: async (input, ctx) => {
    const week = input.week || getCurrentWeek(ctx.timezone);
    await ctx.storage.writeWeeklyPlan(ctx.userId, week, input.content);
    return `Saved plan for ${week}.`;
  },
});

export const amendPlan = defineTool({
  name: "amend_plan",
  description:
    "Append an entry to the ## Amendments section of an existing plan (creates the section if absent). " +
    "Use when a workout shifts days, gets added, or gets skipped. Keeps the original plan intact for reference.",
  schema: z.object({
    week: z.string().regex(/^\d{4}-W\d{2}$/),
    amendment: z
      .string()
      .describe(
        "One-line amendment, e.g. 'Friday Push → Saturday Feb 15: shifted due to schedule.'"
      ),
  }),
  handler: async (input, ctx) => {
    const existing = await ctx.storage.readWeeklyPlan(ctx.userId, input.week);
    if (!existing) {
      return `No plan exists for ${input.week}. Use save_plan first.`;
    }
    const raw = existing.body;
    const entry = `- ${input.amendment}`;
    const updated = /^## Amendments\s*$/m.test(raw)
      ? raw.replace(/(^## Amendments\s*$\n+)/m, `$1${entry}\n`)
      : raw.trimEnd() + `\n\n## Amendments\n\n${entry}\n`;
    await ctx.storage.writeWeeklyPlan(ctx.userId, input.week, updated);
    return `Amended plan for ${input.week}.`;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// save_retro
// ─────────────────────────────────────────────────────────────────────────────

export const saveRetro = defineTool({
  name: "save_retro",
  description: "Save the weekly retrospective at weeks/YYYY-WXX/retro.md. Overwrites if exists.",
  schema: z.object({
    week: z.string().regex(/^\d{4}-W\d{2}$/),
    content: z.string().describe("Full markdown content of retro.md."),
  }),
  handler: async (input, ctx) => {
    await ctx.storage.writeWeeklyRetro(ctx.userId, input.week, input.content);
    return `Saved retro for ${input.week}.`;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// save_learning
// ─────────────────────────────────────────────────────────────────────────────

const LEARNING_CATEGORIES = [
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
] as const;

export const saveLearning = defineTool({
  name: "save_learning",
  description:
    "Append a memory about the athlete to learnings.md under the appropriate category. " +
    "Save preferences, exercise opinions, recovery patterns, schedule changes, etc. " +
    "Don't ask permission — just save it. These memories inform future programming.",
  schema: z.object({
    category: z.enum(LEARNING_CATEGORIES),
    content: z
      .string()
      .describe("The memory to save. Be specific, e.g. 'Prefers supersets for accessories'"),
  }),
  handler: async (input, ctx) => {
    const today = getToday(ctx.timezone);
    const entry = `- [${today}] [${input.category}] ${input.content}`;
    await ctx.storage.appendLearning(ctx.userId, entry);
    return `Saved learning [${input.category}]: ${input.content}`;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export const WRITE_TOOLS = [
  startWorkout,
  logExercise,
  completeWorkout,
  removeExercise,
  editExercise,
  savePlan,
  amendPlan,
  saveRetro,
  saveLearning,
];
