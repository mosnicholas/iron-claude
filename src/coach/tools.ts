/**
 * Custom MCP Tools for the Coach Agent
 *
 * Provides dedicated tools for reminder management so the agent
 * doesn't have to hand-write JSON to state/reminders.json.
 */

import { z } from "zod";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { createGitHubStorage } from "../storage/github.js";

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

/**
 * Create the MCP server with all coach tools
 */
export function createCoachToolsServer() {
  return createSdkMcpServer({
    name: "coach-tools",
    tools: [getReminders, addReminder, deleteReminder],
  });
}
