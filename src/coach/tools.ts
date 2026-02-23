/**
 * Custom MCP Tools for the Coach Agent
 *
 * Provides dedicated tools for reminders and athlete memory.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { createGitHubStorage } from "../storage/github.js";
import { REPO_DIR as DEFAULT_REPO_DIR } from "../storage/repo-sync.js";
import { getToday, getTimezone } from "../utils/date.js";

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

  return { saveMemory };
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
  const { saveMemory } = createRepoTools(repoDir);

  return createSdkMcpServer({
    name: "coach-tools",
    tools: [getReminders, addReminder, deleteReminder, saveMemory],
  });
}
