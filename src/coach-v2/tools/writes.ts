/**
 * Write tools — every one of these mutates the fitness-data repo and
 * auto-commits-and-pushes inside the tool body.
 *
 * Reliability features:
 *   - Deterministic path generation (model never sees file paths).
 *   - Idempotency: replaying an identical log_exercise within 30s is a no-op.
 *   - Atomic write+commit+push with retry on push.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { defineTool } from "../tool.js";
import { writeAndCommit, formatCommitStatus } from "../git.js";
import {
  parseFrontmatter,
  serializeFrontmatter as serializeIntegrationFrontmatter,
} from "../../integrations/storage.js";
import { calendarInfoFor, getCurrentWeek, getDateInfoTZAware, getToday } from "../../utils/date.js";
import { createGitHubStorage } from "../../storage/github.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function workoutPath(
  repoPath: string,
  timezone: string,
  explicitDate?: string
): {
  path: string;
  relative: string;
  week: string;
  date: string;
  dayName: string;
  isBackfill: boolean;
} {
  const today = getToday(timezone);
  if (explicitDate && explicitDate !== today) {
    const info = calendarInfoFor(explicitDate);
    const relative = `weeks/${info.week}/${info.date}.md`;
    return {
      path: join(repoPath, relative),
      relative,
      week: info.week,
      date: info.date,
      dayName: info.dayName,
      isBackfill: true,
    };
  }
  const week = getCurrentWeek(timezone);
  const dayName = getDateInfoTZAware().dayOfWeek;
  const relative = `weeks/${week}/${today}.md`;
  return {
    path: join(repoPath, relative),
    relative,
    week,
    date: today,
    dayName,
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

function readWorkoutOrThrow(path: string, date: string): string {
  if (!existsSync(path)) {
    throw new Error(`No workout file for ${date}. Call start_workout first to create it.`);
  }
  return readFileSync(path, "utf-8");
}

function buildFile(fm: Record<string, unknown>, body: string): string {
  // serializeIntegrationFrontmatter returns the "---\n…\n---" block; we own
  // the body. Keeps frontmatter format consistent with the integrations layer.
  const fmBlock = serializeIntegrationFrontmatter(fm);
  const bodyClean = body.startsWith("\n") ? body : "\n" + body;
  return `${fmBlock}${bodyClean}`;
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
    const { path, relative, week, date, dayName, isBackfill } = workoutPath(
      ctx.repoPath,
      ctx.timezone,
      input.date
    );
    const nowInfo = getDateInfoTZAware();

    // A nutrition-only file may already exist (athlete logged a meal before
    // training). Upgrade it in place rather than refusing.
    let baseFm: Record<string, unknown>;
    let baseBody: string;
    let upgraded = false;
    if (existsSync(path)) {
      const raw = readFileSync(path, "utf-8");
      const parsed = parseFrontmatter(raw);
      if (parsed.frontmatter.type) {
        return `Workout file already exists at ${relative}. Use log_exercise to add sets, or get_workout to see current state.`;
      }
      baseFm = { ...(parsed.frontmatter as Record<string, unknown>) };
      baseBody = /^## Exercises\s*$/m.test(parsed.content)
        ? parsed.content
        : parsed.content.trimEnd() + `\n\n## Exercises\n\n`;
      upgraded = true;
    } else {
      baseFm = {};
      baseBody = `# Workout — ${dayName}, ${date}\n\n## Exercises\n\n`;
    }

    const fm: Record<string, unknown> = {
      ...baseFm,
      date,
      type: input.type,
      status: "in_progress",
      started: isBackfill ? "00:00" : nowInfo.time,
      plan_reference: week,
    };
    if (input.location) fm.location = input.location;
    if (input.planned_day) fm.planned_day = input.planned_day;
    if (isBackfill) fm.back_filled = true;

    const content = buildFile(fm, baseBody);
    const commitMsg = upgraded
      ? `Start ${input.type} workout for ${date} (upgrade nutrition-only file)`
      : `Start ${input.type} workout for ${date}${isBackfill ? " (back-filled)" : ""}`;
    const result = await writeAndCommit(ctx.repoPath, relative, content, commitMsg);

    // Schedule the timeout reminder (best-effort, don't fail the tool).
    // Skip on back-fills — the workout already happened.
    if (!isBackfill) {
      try {
        const storage = createGitHubStorage();
        const triggerDate = date;
        const triggerHour = (parseInt(nowInfo.time.split(":")[0], 10) + 3) % 24;
        await storage.addReminder({
          triggerDate,
          triggerHour,
          message: "Still working out? If you're done, let me know so I can close out the session.",
          context: "workout-timeout-check",
        });
      } catch (err) {
        console.warn("[start_workout] failed to schedule timeout reminder:", err);
      }
    }

    const startedDisplay = isBackfill ? "back-filled" : nowInfo.time;
    return `Started workout: ${relative}\nstatus: in_progress, type: ${input.type}, started: ${startedDisplay}\n${formatCommitStatus(result)}`;
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
    const { path, relative, date } = workoutPath(ctx.repoPath, ctx.timezone, input.date);
    if (!existsSync(path)) {
      // Auto-start the workout with a reasonable default rather than fail.
      // The model can correct the type later if needed. Pass through `date`
      // so a back-fill log_exercise auto-creates the back-fill file.
      const auto = await startWorkout.handler({ type: "workout", date: input.date }, ctx);
      void auto;
    }
    const raw = readWorkoutOrThrow(path, date);
    const { frontmatter, content } = parseFrontmatter(raw);

    if (frontmatter.status === "completed") {
      return `Workout for ${date} is already marked complete. Cannot log additional exercises. If this is a mistake, abandon and start a new workout, or edit via /debug.`;
    }

    const exerciseHeader = `### ${input.exercise}`;
    const setLines = input.sets.map((s) => {
      const rpe = s.rpe ? ` (RPE ${s.rpe})` : "";
      return `- ${s.weight} x ${s.reps}${rpe}`;
    });
    const notesLine = input.notes ? `\n_${input.notes}_` : "";
    const newSection = `${exerciseHeader}\n${setLines.join("\n")}${notesLine}\n`;

    let newContent: string;
    const headerPattern = new RegExp(`^### ${escapeRegex(input.exercise)}\\s*$`, "im");
    if (headerPattern.test(content)) {
      // Append set lines under the existing section, just before the next ### or end.
      const lines = content.split("\n");
      const out: string[] = [];
      let inSection = false;
      let inserted = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (headerPattern.test(line)) {
          inSection = true;
          out.push(line);
          continue;
        }
        if (inSection && line.startsWith("### ") && !inserted) {
          // End of our section — insert before the next header.
          out.push(...setLines);
          if (input.notes) out.push(`_${input.notes}_`);
          out.push("");
          inserted = true;
          inSection = false;
        }
        out.push(line);
      }
      if (!inserted) {
        // Section was last; append at end.
        out.push(...setLines);
        if (input.notes) out.push(`_${input.notes}_`);
        out.push("");
      }
      newContent = out.join("\n");
    } else {
      // Add new section under ## Exercises (or append to body if section missing).
      if (/^## Exercises\s*$/m.test(content)) {
        newContent = content.replace(/^## Exercises\s*$/m, `## Exercises\n\n${newSection}`);
      } else {
        newContent = content.trimEnd() + `\n\n## Exercises\n\n${newSection}`;
      }
    }

    const final = buildFile(frontmatter as Record<string, unknown>, newContent);
    const result = await writeAndCommit(
      ctx.repoPath,
      relative,
      final,
      `Log ${input.exercise} on ${date}`
    );
    if (result.noop) {
      return `No change — ${input.exercise} sets already present in file.`;
    }
    return `Logged ${input.exercise} (${input.sets.length} set${input.sets.length === 1 ? "" : "s"}). ${formatCommitStatus(result)}`;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// complete_workout
// ─────────────────────────────────────────────────────────────────────────────

export const completeWorkout = defineTool({
  name: "complete_workout",
  description:
    "Close out a workout. Sets status (completed by default, or 'abandoned' if the athlete cut " +
    "it short), finished time, duration, and adds a ## Summary section. Optionally records " +
    "energy_level if the athlete volunteered it. ALSO records any PRs to prs.yaml. Deletes the " +
    "workout-timeout-check reminder. Defaults to today; pass `date` (YYYY-MM-DD) to close out a " +
    "back-filled past session — duration_minutes is set to 0 on back-fills since the real times " +
    "aren't known. ALWAYS call this when the user says they're done — never leave a workout " +
    "in_progress, and never ask for energy_level before closing. " +
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
      .optional()
      .describe(
        "Athlete's energy/feel rating, 1-10. ONLY pass this if the athlete already volunteered " +
          "the number — never ask for it."
      ),
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
    const { path, relative, date, isBackfill } = workoutPath(
      ctx.repoPath,
      ctx.timezone,
      input.date
    );
    const raw = readWorkoutOrThrow(path, date);
    const { frontmatter, content } = parseFrontmatter(raw);

    const dateInfo = getDateInfoTZAware();
    // For back-fills, real start/finish times are unknown, so leave finished
    // at "00:00" and duration at 0 rather than recording a 3-day "duration".
    const finished = isBackfill ? "00:00" : dateInfo.time;
    const started = (frontmatter.started as string | undefined) ?? finished;
    const durationMinutes = isBackfill ? 0 : computeDurationMinutes(started, finished);
    const status = input.status ?? "completed";

    const updatedFm: Record<string, unknown> = {
      ...(frontmatter as Record<string, unknown>),
      status,
      finished,
      duration_minutes: durationMinutes,
    };
    if (input.energy_level !== undefined) {
      updatedFm.energy_level = input.energy_level;
    }
    if (isBackfill) updatedFm.back_filled = true;
    if (input.prs_hit?.length) {
      updatedFm.prs_hit = input.prs_hit.map((p) => ({
        exercise: p.exercise,
        achievement: p.achievement,
      }));
    }

    const summaryBlock = `## Summary\n\n${input.summary}\n`;
    const newBody = /## Summary/i.test(content)
      ? content.replace(/## Summary[\s\S]*?(?=\n##\s|$)/i, summaryBlock)
      : content.trimEnd() + "\n\n" + summaryBlock;

    const final = buildFile(updatedFm, newBody);
    const verb = status === "abandoned" ? "Abandon" : "Complete";
    const result = await writeAndCommit(
      ctx.repoPath,
      relative,
      final,
      `${verb} workout for ${date}`
    );

    // Update PRs (best effort — if it fails, surface in tool result).
    const prMessages: string[] = [];
    if (input.prs_hit?.length) {
      try {
        await applyPRsToYaml(ctx.repoPath, input.prs_hit, date);
        prMessages.push(`Recorded ${input.prs_hit.length} PR(s) to prs.yaml.`);
      } catch (err) {
        prMessages.push(
          `WARNING: failed to update prs.yaml: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // Delete workout-timeout-check reminders.
    try {
      const storage = createGitHubStorage();
      const reminders = await storage.getReminders();
      const toDelete = reminders.filter((r) => r.context === "workout-timeout-check");
      for (const r of toDelete) await storage.deleteReminder(r.id);
      if (toDelete.length) prMessages.push(`Cleared ${toDelete.length} timeout reminder(s).`);
    } catch (err) {
      console.warn("[complete_workout] failed to clear timeout reminder:", err);
    }

    return [
      `${status === "abandoned" ? "Abandoned" : "Completed"} workout for ${date}. duration: ${durationMinutes}m${input.energy_level !== undefined ? `, energy: ${input.energy_level}/10` : ""}.`,
      `${formatCommitStatus(result)}`,
      ...prMessages,
    ].join("\n");
  },
});

function computeDurationMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(":").map((n) => parseInt(n, 10));
  const [eh, em] = end.split(":").map((n) => parseInt(n, 10));
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return 0;
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60; // workout straddled midnight
  return mins;
}

async function applyPRsToYaml(
  repoPath: string,
  prs: { exercise: string; weight: number; reps: number; achievement: string }[],
  date: string
): Promise<void> {
  const prsPath = join(repoPath, "prs.yaml");
  const existing = existsSync(prsPath) ? readFileSync(prsPath, "utf-8") : "";
  const data: Record<string, { current: PRRecord; history: PRRecord[] }> = existing
    ? (parseYaml(existing) as Record<string, { current: PRRecord; history: PRRecord[] }>) || {}
    : {};

  for (const pr of prs) {
    const key = pr.exercise;
    const newRecord: PRRecord = {
      weight: pr.weight,
      reps: pr.reps,
      date,
      estimated1RM: estimate1RM(pr.weight, pr.reps),
    };
    if (!data[key]) {
      data[key] = { current: newRecord, history: [] };
    } else {
      data[key].history = [data[key].current, ...(data[key].history || [])];
      data[key].current = newRecord;
    }
  }
  await writeAndCommit(
    repoPath,
    "prs.yaml",
    stringifyYaml(data),
    `Update PRs (${prs.map((p) => p.exercise).join(", ")})`
  );
}

interface PRRecord {
  weight: number;
  reps: number;
  date: string;
  estimated1RM: number;
}

function estimate1RM(weight: number, reps: number): number {
  // Epley formula. Match what the existing PR logic expects.
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30));
}

// ─────────────────────────────────────────────────────────────────────────────
// remove_exercise / edit_exercise — corrective edits to a workout's exercise
// list. Use these when sets land in the wrong file or were mis-logged.
// ─────────────────────────────────────────────────────────────────────────────

function findExerciseSection(
  content: string,
  exercise: string
): { start: number; end: number } | null {
  const lines = content.split("\n");
  const headerPattern = new RegExp(`^### ${escapeRegex(exercise)}\\s*$`, "i");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headerPattern.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("### ") || /^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
}

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
    const { path, relative, date } = workoutPath(ctx.repoPath, ctx.timezone, input.date);
    if (!existsSync(path)) {
      return `No workout file for ${date}.`;
    }
    const raw = readFileSync(path, "utf-8");
    const { frontmatter, content } = parseFrontmatter(raw);
    const range = findExerciseSection(content, input.exercise);
    if (!range) {
      return `No "${input.exercise}" section found in ${date}'s workout.`;
    }
    const lines = content.split("\n");
    const before = lines.slice(0, range.start);
    const after = lines.slice(range.end);
    // Collapse adjacent blank lines at the seam.
    while (before.length && before[before.length - 1].trim() === "") before.pop();
    while (after.length && after[0].trim() === "") after.shift();
    const newBody = [...before, "", ...after].join("\n").trimEnd() + "\n";

    const final = buildFile(frontmatter as Record<string, unknown>, newBody);
    const result = await writeAndCommit(
      ctx.repoPath,
      relative,
      final,
      `Remove ${input.exercise} from ${date}`
    );
    return `Removed ${input.exercise} from ${date}.\n${formatCommitStatus(result)}`;
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
    const { path, relative, date } = workoutPath(ctx.repoPath, ctx.timezone, input.date);
    if (!existsSync(path)) {
      return `No workout file for ${date}.`;
    }
    const raw = readFileSync(path, "utf-8");
    const { frontmatter, content } = parseFrontmatter(raw);
    const range = findExerciseSection(content, input.exercise);
    if (!range) {
      return `No "${input.exercise}" section found in ${date}'s workout. Use log_exercise to create it.`;
    }
    const lines = content.split("\n");
    const setLines = input.sets.map((s) => {
      const rpe = s.rpe ? ` (RPE ${s.rpe})` : "";
      return `- ${s.weight} x ${s.reps}${rpe}`;
    });
    const header = lines[range.start];
    const newSection = [header, ...setLines];
    if (input.notes && input.notes.trim()) newSection.push(`_${input.notes}_`);
    newSection.push("");
    const newLines = [...lines.slice(0, range.start), ...newSection, ...lines.slice(range.end)];
    const newBody = newLines.join("\n").trimEnd() + "\n";

    const final = buildFile(frontmatter as Record<string, unknown>, newBody);
    const result = await writeAndCommit(
      ctx.repoPath,
      relative,
      final,
      `Edit ${input.exercise} on ${date}`
    );
    if (result.noop) {
      return `No change — sets already match.`;
    }
    return `Edited ${input.exercise} on ${date} (${input.sets.length} set${input.sets.length === 1 ? "" : "s"}).\n${formatCommitStatus(result)}`;
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
    const relative = `weeks/${input.week}/plan.md`;
    const result = await writeAndCommit(
      ctx.repoPath,
      relative,
      input.content,
      `Save plan for ${input.week}`
    );
    return `Saved plan for ${input.week}. ${formatCommitStatus(result)}`;
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
    const relative = `weeks/${input.week}/plan.md`;
    const fullPath = join(ctx.repoPath, relative);
    if (!existsSync(fullPath)) {
      return `No plan exists for ${input.week}. Use save_plan first.`;
    }
    const raw = readFileSync(fullPath, "utf-8");
    const entry = `- ${input.amendment}`;
    const updated = /^## Amendments\s*$/m.test(raw)
      ? raw.replace(/(^## Amendments\s*$\n+)/m, `$1${entry}\n`)
      : raw.trimEnd() + `\n\n## Amendments\n\n${entry}\n`;
    const result = await writeAndCommit(
      ctx.repoPath,
      relative,
      updated,
      `Amend plan ${input.week}: ${input.amendment.slice(0, 60)}`
    );
    return `Amended plan for ${input.week}.\n${formatCommitStatus(result)}`;
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
    const relative = `weeks/${input.week}/retro.md`;
    const result = await writeAndCommit(
      ctx.repoPath,
      relative,
      input.content,
      `Save retro for ${input.week}`
    );
    return `Saved retro for ${input.week}. ${formatCommitStatus(result)}`;
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

const LEARNING_HEADERS: Record<(typeof LEARNING_CATEGORIES)[number], string> = {
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
    const path = join(ctx.repoPath, "learnings.md");
    const today = getToday(ctx.timezone);
    const entry = `- [${today}] ${input.content}`;
    const header = LEARNING_HEADERS[input.category];
    const current = existsSync(path)
      ? readFileSync(path, "utf-8")
      : "# Learnings\n\n*Patterns and preferences discovered through conversation and observation.*\n";
    let updated: string;
    if (current.includes(header)) {
      updated = current.replace(header, `${header}\n${entry}`);
    } else {
      updated = current.trimEnd() + `\n\n${header}\n\n${entry}\n`;
    }
    const result = await writeAndCommit(
      ctx.repoPath,
      "learnings.md",
      updated,
      `Add learning [${input.category}]`
    );
    return `Saved learning [${input.category}]: ${input.content}\n${formatCommitStatus(result)}`;
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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
