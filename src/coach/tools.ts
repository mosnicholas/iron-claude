/**
 * Custom MCP Tools for the Coach Agent
 *
 * Provides dedicated tools for reminders, athlete memory, session state,
 * and dynamic skill loading.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { createGitHubStorage } from "../storage/github.js";
import { REPO_DIR } from "../storage/repo-sync.js";
import { getToday, getTimezone } from "../utils/date.js";
import { writeSessionState, clearSessionState, type SessionState } from "../state/session.js";
import { loadSkillContent, getSkillNames } from "./skills.js";

// ============================================================================
// Reminder Tools
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
function appendToLearnings(category: string, content: string): void {
  const filePath = join(REPO_DIR, "learnings.md");
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
    appendToLearnings(args.category, args.content);
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

// ============================================================================
// Skill Loader Tool
// ============================================================================

const loadSkill = tool(
  "load_skill",
  "Load a skill's full instructions by name. Call this when the user's request matches one of the skills listed in <available-skills>. Returns detailed instructions for handling the request.",
  {
    name: z.string().describe("The skill name to load (from the available-skills list)"),
  },
  async (args) => {
    const validNames = getSkillNames();
    if (!validNames.includes(args.name)) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Skill not found. Check <available-skills> in your system prompt for valid names.`,
          },
        ],
      };
    }
    const content = loadSkillContent(args.name)!;
    return {
      content: [{ type: "text" as const, text: content }],
    };
  }
);

// ============================================================================
// Session State Tools
// ============================================================================

const CONVERSATION_MODES = ["workout_active", "chatting", "planning", "retrospective"] as const;

const updateSession = tool(
  "update_session",
  "Update session state to track the current conversation across messages. Call this when starting a workout, after logging exercises, or when the conversation mode changes. State persists across messages and survives server restarts.",
  {
    mode: z
      .enum(CONVERSATION_MODES)
      .describe(
        "Current conversation mode: workout_active (logging exercises), chatting (general conversation), planning (creating/adjusting weekly plans), retrospective (analyzing past performance)"
      ),
    workout: z
      .object({
        date: z.string().describe("Workout date (YYYY-MM-DD)"),
        type: z.string().describe("Workout type (upper, lower, full, cardio, etc.)"),
        exercisesCompleted: z.array(z.string()).describe("Exercise names completed so far"),
        currentExercise: z.string().nullable().describe("Exercise currently being logged, or null"),
        plannedRemaining: z.array(z.string()).optional().describe("Planned exercises not yet done"),
        notes: z.string().optional().describe("Any context worth carrying to the next message"),
      })
      .optional()
      .describe("Workout details — include when mode is workout_active"),
  },
  async (args) => {
    const state: SessionState = {
      mode: args.mode,
      lastUpdated: new Date().toISOString(),
    };
    if (args.workout) {
      state.workout = {
        date: args.workout.date,
        type: args.workout.type,
        exercisesCompleted: args.workout.exercisesCompleted,
        currentExercise: args.workout.currentExercise,
        plannedRemaining: args.workout.plannedRemaining,
        notes: args.workout.notes,
      };
    }
    writeSessionState(REPO_DIR, state);
    return {
      content: [
        {
          type: "text" as const,
          text: `Session updated: mode=${args.mode}${args.workout ? `, exercises=${args.workout.exercisesCompleted.length}` : ""}`,
        },
      ],
    };
  }
);

const endSession = tool(
  "end_session",
  "Clear session state. Call this when a workout is completed or the user is done with the current activity.",
  {},
  async () => {
    clearSessionState(REPO_DIR);
    return {
      content: [{ type: "text" as const, text: "Session cleared." }],
    };
  }
);

// ============================================================================
// Server
// ============================================================================

/**
 * Create the MCP server with all coach tools
 */
export function createCoachToolsServer() {
  return createSdkMcpServer({
    name: "coach-tools",
    tools: [
      getReminders,
      addReminder,
      deleteReminder,
      saveMemory,
      loadSkill,
      updateSession,
      endSession,
    ],
  });
}
