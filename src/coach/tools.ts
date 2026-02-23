/**
 * Custom MCP Tools for the Coach Agent
 *
 * Provides dedicated tools for reminders, athlete memory, and structured
 * data writes (workouts, PRs, plans).
 *
 * Structured write tools ensure consistent file formats and frontmatter schemas
 * without relying on the LLM to produce correct formatting.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { createGitHubStorage } from "../storage/github.js";
import { REPO_DIR as DEFAULT_REPO_DIR } from "../storage/repo-sync.js";
import { getToday, getTimezone, getCurrentWeek, formatISOWeek } from "../utils/date.js";
import { parseFrontmatter, serializeFrontmatter } from "../integrations/storage.js";

// ============================================================================
// Reminder Tools (no repo path dependency)
// ============================================================================

const getReminders = tool(
  "get_reminders",
  "Get all currently scheduled reminders. Returns a list of reminders with their id, triggerDate, triggerHour, message, and context.",
  {},
  async () => {
    const storage = createGitHubStorage();
    const reminders = await storage.getReminders();
    return {
      content: [
        {
          type: "text" as const,
          text:
            reminders.length === 0 ? "No reminders scheduled." : JSON.stringify(reminders, null, 2),
        },
      ],
    };
  }
);

const addReminder = tool(
  "add_reminder",
  "Schedule a new reminder. The cron job checks hourly and sends the message at the specified date/hour.",
  {
    triggerDate: z.string().describe("Date to trigger the reminder (YYYY-MM-DD)"),
    triggerHour: z
      .number()
      .int()
      .min(0)
      .max(23)
      .describe("Hour to trigger (0-23 in configured timezone)"),
    message: z.string().describe("The reminder message to send to the user"),
    context: z.string().optional().describe("Optional context about why this reminder exists"),
  },
  async (args) => {
    const storage = createGitHubStorage();
    const reminder = await storage.addReminder({
      triggerDate: args.triggerDate,
      triggerHour: args.triggerHour,
      message: args.message,
      context: args.context,
    });
    return {
      content: [
        {
          type: "text" as const,
          text: `Reminder scheduled: ${reminder.message} for ${reminder.triggerDate} at ${reminder.triggerHour}:00 (id: ${reminder.id})`,
        },
      ],
    };
  }
);

const deleteReminder = tool(
  "delete_reminder",
  "Delete a scheduled reminder by its ID. Use get_reminders first to find the ID.",
  {
    id: z.string().describe("The reminder ID to delete"),
  },
  async (args) => {
    const storage = createGitHubStorage();
    await storage.deleteReminder(args.id);
    return {
      content: [
        {
          type: "text" as const,
          text: `Reminder ${args.id} deleted.`,
        },
      ],
    };
  }
);

// ============================================================================
// Memory Tool
// ============================================================================

const MEMORY_CATEGORIES = [
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

const CATEGORY_HEADERS: Record<string, string> = {
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

const DEFAULT_LEARNINGS = `# Learnings

*Patterns and preferences discovered through conversation and observation.*
`;

/**
 * Append a dated entry under the right category section in learnings.md.
 * Creates the section if it doesn't exist yet.
 * Writes to local clone — gets pushed with everything else at end of session.
 */
function appendToLearnings(repoDir: string, category: string, content: string): void {
  const filePath = join(repoDir, "learnings.md");
  const current = existsSync(filePath) ? readFileSync(filePath, "utf-8") : DEFAULT_LEARNINGS;

  const date = getToday(getTimezone());
  const entry = `- [${date}] ${content}`;
  const header = CATEGORY_HEADERS[category] || `## ${category}`;

  let updated: string;
  if (current.includes(header)) {
    // Append entry right after the header line
    updated = current.replace(header, `${header}\n${entry}`);
  } else {
    // Add new section at the end
    updated = current.trimEnd() + `\n\n${header}\n\n${entry}\n`;
  }

  writeFileSync(filePath, updated, "utf-8");
}

// ============================================================================
// Workout File Helpers
// ============================================================================

/**
 * Get the ISO week string for a date string (YYYY-MM-DD).
 */
function getISOWeekForDate(dateStr: string): string {
  // Parse as noon UTC to avoid timezone issues
  const date = new Date(dateStr + "T12:00:00Z");
  return formatISOWeek(date);
}

/**
 * Get the workout file path and ensure its directory exists.
 */
function ensureWorkoutPath(repoDir: string, date: string): { filePath: string; week: string } {
  const week = getISOWeekForDate(date);
  const weekDir = join(repoDir, "weeks", week);
  mkdirSync(weekDir, { recursive: true });
  return { filePath: join(weekDir, `${date}.md`), week };
}

/**
 * Read and parse a workout file, returning frontmatter and body content.
 * Returns null if the file doesn't exist.
 */
function readWorkoutFileLocal(
  repoDir: string,
  date: string
): { frontmatter: Record<string, unknown>; content: string; filePath: string } | null {
  const { filePath } = ensureWorkoutPath(repoDir, date);
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, "utf-8");
  const { frontmatter, content } = parseFrontmatter(raw);
  return { frontmatter, content, filePath };
}

/**
 * Write a workout file with frontmatter and body content.
 */
function writeWorkoutFile(
  repoDir: string,
  date: string,
  frontmatter: Record<string, unknown>,
  bodyContent: string
): string {
  const { filePath } = ensureWorkoutPath(repoDir, date);
  const fm = serializeFrontmatter(frontmatter);
  const full = `${fm}\n\n${bodyContent.trimStart()}`;
  writeFileSync(filePath, full, "utf-8");
  return filePath;
}

// ============================================================================
// PR Helpers
// ============================================================================

/**
 * Parse prs.yaml into a structured map.
 * Returns a map of exercise_key → { weight, reps, date, estimated_1rm, ... }
 */
function parsePRsYaml(yaml: string): Map<string, Record<string, unknown>> {
  const prs = new Map<string, Record<string, unknown>>();
  const lines = yaml.split("\n");
  let currentExercise: string | null = null;
  let currentData: Record<string, unknown> = {};
  let inHistory = false;

  for (const line of lines) {
    // Skip comments and empty lines
    if (line.startsWith("#") || !line.trim()) continue;

    // Top-level key (exercise name)
    if (!line.startsWith(" ") && line.includes(":")) {
      // Save previous exercise
      if (currentExercise) {
        prs.set(currentExercise, currentData);
      }
      currentExercise = line.split(":")[0].trim();
      currentData = {};
      inHistory = false;
      continue;
    }

    if (!currentExercise) continue;

    const trimmed = line.trim();

    // Detect history section — skip it, we only care about current
    if (trimmed === "history:" || trimmed.startsWith("current:")) {
      inHistory = trimmed === "history:";
      continue;
    }

    // Skip history entries
    if (inHistory) continue;

    // Parse key: value pairs
    if (trimmed.includes(":") && !trimmed.startsWith("-")) {
      const colonIdx = trimmed.indexOf(":");
      const key = trimmed.slice(0, colonIdx).trim();
      let value: string | number = trimmed.slice(colonIdx + 1).trim();
      // Remove quotes
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      // Try to parse as number
      const num = Number(value);
      currentData[key] = isNaN(num) || value === "" ? value : num;
    }
  }

  // Save last exercise
  if (currentExercise) {
    prs.set(currentExercise, currentData);
  }

  return prs;
}

/**
 * Serialize a PR map back to YAML format.
 */
function serializePRsYaml(prs: Map<string, Record<string, unknown>>): string {
  const lines: string[] = ["# Personal Records"];

  for (const [exercise, data] of prs) {
    lines.push(`${exercise}:`);
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === "string") {
        lines.push(`  ${key}: "${value}"`);
      } else {
        lines.push(`  ${key}: ${value}`);
      }
    }
  }

  return lines.join("\n") + "\n";
}

/**
 * Calculate estimated 1RM using Brzycki formula.
 */
function calculate1RM(weight: number, reps: number): number {
  if (reps <= 0) return 0;
  if (reps === 1) return weight;
  return Math.round(weight * (36 / (37 - reps)));
}

// ============================================================================
// Repo-Dependent Tools
// ============================================================================

function createRepoTools(repoDir: string) {
  const saveMemory = tool(
    "save_memory",
    "Save a memory about the athlete to learnings.md. Use this when the athlete shares something worth remembering across sessions — preferences, goals, injuries, schedule changes, or coaching feedback. This is a local file write (<1ms), so call it freely without worrying about latency.",
    {
      category: z
        .enum(MEMORY_CATEGORIES)
        .describe(
          "Category: preference (training likes/dislikes), goal (targets), injury (pain/limitations), schedule (availability), feedback (coaching style), insight (patterns you notice), exercise_note (opinions on exercises — boring/easy/love/hate), weight_note (difficulty observations — felt heavy/easy/ready to move up), recovery (sleep/energy/soreness), equipment (gym equipment preferences/availability)"
        ),
      content: z
        .string()
        .describe(
          "The memory to save. Be specific and actionable, e.g. 'Prefers supersets for accessories' not 'Likes supersets'"
        ),
    },
    async (args) => {
      appendToLearnings(repoDir, args.category, args.content);
      return {
        content: [
          {
            type: "text" as const,
            text: `Memory saved: [${args.category}] ${args.content}`,
          },
        ],
      };
    }
  );

  // ==========================================================================
  // Workout Tools
  // ==========================================================================

  const startWorkout = tool(
    "start_workout",
    "Create a new workout file for today with status: in_progress. Call this when the user starts a workout or sends their first exercise. Returns the file path and current contents. If a workout file already exists for today, returns it without overwriting.",
    {
      type: z
        .string()
        .describe(
          "Workout type, e.g. 'upper', 'lower', 'push', 'pull', 'full_body', 'cardio', 'active_recovery'"
        ),
      planned_day: z
        .string()
        .optional()
        .describe(
          "If this workout was planned for a different day, the original day name (e.g. 'Monday')"
        ),
    },
    async (args) => {
      const today = getToday(getTimezone());
      const existing = readWorkoutFileLocal(repoDir, today);

      if (existing) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Workout file already exists for ${today}. Current status: ${existing.frontmatter.status || "unknown"}.\n\nFile: ${existing.filePath}\n\nCurrent content:\n${readFileSync(existing.filePath, "utf-8")}`,
            },
          ],
        };
      }

      const currentWeek = getCurrentWeek(getTimezone());
      const now = new Date();
      const startedTime = now.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: getTimezone(),
      });

      // Get day name for heading
      const dayName = now.toLocaleDateString("en-US", {
        weekday: "long",
        timeZone: getTimezone(),
      });
      const dateHuman = now.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: getTimezone(),
      });

      const frontmatter: Record<string, unknown> = {
        date: today,
        type: args.type,
        started: startedTime,
        status: "in_progress",
        plan_reference: currentWeek,
      };

      if (args.planned_day) {
        frontmatter.planned_day = args.planned_day;
      }

      const body = `# Workout — ${dayName}, ${dateHuman}\n\n## Exercises\n`;

      const filePath = writeWorkoutFile(repoDir, today, frontmatter, body);

      return {
        content: [
          {
            type: "text" as const,
            text: `Workout started: ${args.type} on ${dayName}, ${dateHuman}\nFile: ${filePath}\nStatus: in_progress\n\nRemember to schedule a workout-timeout-check reminder for ~3 hours from now using add_reminder.`,
          },
        ],
      };
    }
  );

  const logExercise = tool(
    "log_exercise",
    "Log an exercise to today's workout file. Appends the exercise under ## Exercises. If no workout file exists yet, creates one first with status: in_progress. Call this every time the user reports an exercise — the data MUST be persisted to the file, not just acknowledged in chat.",
    {
      exercise_name: z
        .string()
        .describe("Full exercise name, e.g. 'Bench Press', 'Overhead Press', 'Barbell Row'"),
      sets: z
        .array(
          z.object({
            weight: z.number().describe("Weight in lbs (or 0 for bodyweight)"),
            reps: z.number().describe("Number of reps completed"),
            rpe: z.number().optional().describe("Rate of perceived exertion (1-10)"),
            notes: z
              .string()
              .optional()
              .describe("Set-specific notes (e.g. 'paused rep', 'grinder')"),
          })
        )
        .describe("Array of sets performed"),
      unit: z.enum(["lbs", "kg"]).optional().describe("Weight unit (defaults to lbs)"),
      notes: z
        .string()
        .optional()
        .describe("General notes for the exercise (e.g. 'felt easy', 'grip was slipping')"),
      is_warmup: z
        .boolean()
        .optional()
        .describe("Whether these are warmup sets (won't count toward PRs)"),
    },
    async (args) => {
      const today = getToday(getTimezone());
      let existing = readWorkoutFileLocal(repoDir, today);

      // Auto-create workout file if it doesn't exist
      if (!existing) {
        const currentWeek = getCurrentWeek(getTimezone());
        const now = new Date();
        const startedTime = now.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: getTimezone(),
        });
        const dayName = now.toLocaleDateString("en-US", {
          weekday: "long",
          timeZone: getTimezone(),
        });
        const dateHuman = now.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          timeZone: getTimezone(),
        });

        const frontmatter: Record<string, unknown> = {
          date: today,
          type: "workout",
          started: startedTime,
          status: "in_progress",
          plan_reference: currentWeek,
        };

        const body = `# Workout — ${dayName}, ${dateHuman}\n\n## Exercises\n`;
        writeWorkoutFile(repoDir, today, frontmatter, body);
        existing = readWorkoutFileLocal(repoDir, today)!;
      }

      // Format the exercise entry
      const unit = args.unit || "lbs";
      const lines: string[] = [];
      lines.push(`### ${args.exercise_name}${args.is_warmup ? " (Warmup)" : ""}`);
      lines.push("");

      for (const set of args.sets) {
        let line = `- ${set.weight}${unit} x ${set.reps}`;
        if (set.rpe !== undefined) {
          line += ` @${set.rpe}`;
        }
        if (set.notes) {
          line += ` — ${set.notes}`;
        }
        lines.push(line);
      }

      if (args.notes) {
        lines.push("");
        lines.push(`*${args.notes}*`);
      }
      lines.push("");

      const exerciseBlock = lines.join("\n");

      // Append to file — find ## Exercises section or append at end
      const raw = readFileSync(existing.filePath, "utf-8");
      let updated: string;

      if (raw.includes("## Exercises")) {
        // Find the end of the Exercises section (next ## or end of file)
        const exercisesIdx = raw.indexOf("## Exercises");
        const afterExercises = raw.slice(exercisesIdx);
        const nextSectionMatch = afterExercises.match(/\n## (?!Exercises)/);
        if (nextSectionMatch && nextSectionMatch.index !== undefined) {
          // Insert before the next section
          const insertAt = exercisesIdx + nextSectionMatch.index;
          updated = raw.slice(0, insertAt) + "\n" + exerciseBlock + raw.slice(insertAt);
        } else {
          // Append at end
          updated = raw.trimEnd() + "\n\n" + exerciseBlock;
        }
      } else {
        // No Exercises section — append one
        updated = raw.trimEnd() + "\n\n## Exercises\n\n" + exerciseBlock;
      }

      writeFileSync(existing.filePath, updated, "utf-8");

      // Build confirmation string
      const setsStr = args.sets
        .map((s) => {
          let str = `${s.weight}${unit} x ${s.reps}`;
          if (s.rpe !== undefined) str += ` @${s.rpe}`;
          return str;
        })
        .join(", ");

      return {
        content: [
          {
            type: "text" as const,
            text: `✓ ${args.exercise_name}${args.is_warmup ? " (warmup)" : ""}: ${setsStr}\nLogged to ${existing.filePath}`,
          },
        ],
      };
    }
  );

  const completeWorkout = tool(
    "complete_workout",
    "Mark today's workout as completed. Updates frontmatter status to 'completed', adds finished time, duration, energy level, and a summary section. CRITICAL: Always call this when the user says they're done — a workout left as in_progress is invisible to retrospectives.",
    {
      energy_level: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("Energy level 1-10 (ask the user if not mentioned)"),
      summary: z.string().describe("Brief workout summary — exercises done, highlights, notes"),
      prs_hit: z
        .array(
          z.object({
            exercise: z.string().describe("Exercise name"),
            achievement: z.string().describe("What was achieved, e.g. '175 x 6 (rep PR)'"),
          })
        )
        .optional()
        .describe("Any PRs detected during this workout"),
    },
    async (args) => {
      const today = getToday(getTimezone());
      const existing = readWorkoutFileLocal(repoDir, today);

      if (!existing) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No workout file found for ${today}. Cannot complete a workout that hasn't been started.`,
            },
          ],
        };
      }

      // Update frontmatter
      const now = new Date();
      const finishedTime = now.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: getTimezone(),
      });

      existing.frontmatter.status = "completed";
      existing.frontmatter.finished = finishedTime;

      // Calculate duration if started time exists
      if (existing.frontmatter.started) {
        const startedStr = String(existing.frontmatter.started);
        const [startH, startM] = startedStr.split(":").map(Number);
        const [endH, endM] = finishedTime.split(":").map(Number);
        const durationMinutes = endH * 60 + endM - (startH * 60 + startM);
        if (durationMinutes > 0) {
          existing.frontmatter.duration_minutes = durationMinutes;
        }
      }

      if (args.energy_level !== undefined) {
        existing.frontmatter.energy_level = args.energy_level;
      }

      if (args.prs_hit && args.prs_hit.length > 0) {
        existing.frontmatter.prs_hit = args.prs_hit;
      }

      // Rebuild file with updated frontmatter
      const raw = readFileSync(existing.filePath, "utf-8");
      const { content: bodyContent } = parseFrontmatter(raw);

      // Add summary section if not already there
      let updatedBody = bodyContent;
      if (!updatedBody.includes("## Summary")) {
        updatedBody = updatedBody.trimEnd() + `\n\n## Summary\n\n${args.summary}\n`;
      }

      writeWorkoutFile(repoDir, today, existing.frontmatter, updatedBody);

      return {
        content: [
          {
            type: "text" as const,
            text: `Workout completed! Status updated to 'completed'.\nFinished: ${finishedTime}${existing.frontmatter.duration_minutes ? ` (${existing.frontmatter.duration_minutes} min)` : ""}\n${args.prs_hit?.length ? `PRs: ${args.prs_hit.map((p) => `${p.exercise}: ${p.achievement}`).join(", ")}` : ""}\n\nRemember to: delete the workout-timeout-check reminder, and update prs.yaml if any PRs were hit.`,
          },
        ],
      };
    }
  );

  // ==========================================================================
  // PR Tool
  // ==========================================================================

  const updatePrs = tool(
    "update_prs",
    "Update prs.yaml with a new personal record. Checks if the new performance exceeds the existing PR (by weight, reps at same weight, or estimated 1RM). Only writes if it's actually a new PR. Returns whether the PR was updated and comparison with previous.",
    {
      exercise: z
        .string()
        .describe(
          "Exercise key in snake_case, e.g. 'bench_press', 'squat', 'deadlift', 'overhead_press'"
        ),
      weight: z.number().describe("Weight lifted in lbs"),
      reps: z.number().int().describe("Number of reps"),
      date: z.string().optional().describe("Date of the PR (YYYY-MM-DD). Defaults to today."),
    },
    async (args) => {
      const prsPath = join(repoDir, "prs.yaml");
      const today = getToday(getTimezone());
      const prDate = args.date || today;
      const newEstimated1RM = calculate1RM(args.weight, args.reps);
      const currentWeek = getCurrentWeek(getTimezone());

      // Read existing PRs
      let prs: Map<string, Record<string, unknown>>;
      if (existsSync(prsPath)) {
        const raw = readFileSync(prsPath, "utf-8");
        prs = parsePRsYaml(raw);
      } else {
        prs = new Map();
      }

      const existing = prs.get(args.exercise);
      const oldWeight = (existing?.weight as number) || 0;
      const oldReps = (existing?.reps as number) || 0;
      const oldEstimated1RM = (existing?.estimated_1rm as number) || 0;

      // Check if this is actually a new PR
      const isWeightPR = args.weight > oldWeight;
      const isRepPR = args.weight === oldWeight && args.reps > oldReps;
      const is1RMPR = newEstimated1RM > oldEstimated1RM;

      if (!isWeightPR && !isRepPR && !is1RMPR) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Not a new PR for ${args.exercise}. Current: ${oldWeight} x ${oldReps} (est. 1RM: ${oldEstimated1RM}). Attempted: ${args.weight} x ${args.reps} (est. 1RM: ${newEstimated1RM}).`,
            },
          ],
        };
      }

      // Update the PR
      const prType = isWeightPR ? "weight PR" : isRepPR ? "rep PR" : "estimated 1RM PR";

      prs.set(args.exercise, {
        weight: args.weight,
        reps: args.reps,
        date: prDate,
        estimated_1rm: newEstimated1RM,
        workout_ref: `weeks/${currentWeek}/${prDate}.md`,
      });

      // Write back
      const yaml = serializePRsYaml(prs);
      writeFileSync(prsPath, yaml, "utf-8");

      return {
        content: [
          {
            type: "text" as const,
            text: `🎉 New ${prType} for ${args.exercise}!\nPrevious: ${oldWeight} x ${oldReps} (est. 1RM: ${oldEstimated1RM})\nNew: ${args.weight} x ${args.reps} (est. 1RM: ${newEstimated1RM})\nUpdated prs.yaml.`,
          },
        ],
      };
    }
  );

  // ==========================================================================
  // Plan Tool
  // ==========================================================================

  const savePlan = tool(
    "save_plan",
    "Save a weekly training plan to weeks/YYYY-WXX/plan.md. Creates the week directory if needed. Use this when generating a new weekly plan.",
    {
      week: z
        .string()
        .optional()
        .describe("ISO week string (e.g. '2026-W09'). Defaults to current week."),
      content: z
        .string()
        .describe("Full plan content in markdown (including heading, day sections, notes)"),
    },
    async (args) => {
      const week = args.week || getCurrentWeek(getTimezone());
      const weekDir = join(repoDir, "weeks", week);
      mkdirSync(weekDir, { recursive: true });
      const planPath = join(weekDir, "plan.md");

      writeFileSync(planPath, args.content, "utf-8");

      return {
        content: [
          {
            type: "text" as const,
            text: `Plan saved to weeks/${week}/plan.md`,
          },
        ],
      };
    }
  );

  return { saveMemory, startWorkout, logExercise, completeWorkout, updatePrs, savePlan };
}

// ============================================================================
// Server
// ============================================================================

/**
 * Create the MCP server with all coach tools.
 * Pass repoPath to bind file-writing tools to the correct directory.
 */
export function createCoachToolsServer(repoPath?: string) {
  const repoDir = repoPath || DEFAULT_REPO_DIR;
  const { saveMemory, startWorkout, logExercise, completeWorkout, updatePrs, savePlan } =
    createRepoTools(repoDir);

  return createSdkMcpServer({
    name: "coach-tools",
    tools: [
      getReminders,
      addReminder,
      deleteReminder,
      saveMemory,
      startWorkout,
      logExercise,
      completeWorkout,
      updatePrs,
      savePlan,
    ],
  });
}

// Export helpers for testing
export {
  parsePRsYaml,
  serializePRsYaml,
  calculate1RM,
  readWorkoutFileLocal,
  writeWorkoutFile,
  ensureWorkoutPath,
};
