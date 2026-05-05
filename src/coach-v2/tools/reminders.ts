/**
 * Reminder tools — schedule and manage one-shot Telegram reminders.
 * Backed by GitHubStorage's reminders.json — checked hourly by the cron.
 */

import { z } from "zod";
import { defineTool } from "../tool.js";
import { createGitHubStorage } from "../../storage/github.js";

export const getReminders = defineTool({
  name: "get_reminders",
  description:
    "List all currently scheduled reminders with id, triggerDate (YYYY-MM-DD), triggerHour (0-23), message, and context.",
  schema: z.object({}),
  handler: async () => {
    const storage = createGitHubStorage();
    const reminders = await storage.getReminders();
    return reminders.length === 0 ? "No reminders scheduled." : JSON.stringify(reminders, null, 2);
  },
});

export const addReminder = defineTool({
  name: "add_reminder",
  description:
    "Schedule a one-shot reminder. The cron checks hourly and sends the message at the specified date/hour.",
  schema: z.object({
    triggerDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format: YYYY-MM-DD"),
    triggerHour: z
      .number()
      .int()
      .min(0)
      .max(23)
      .describe("Hour to fire (0-23 in configured timezone)"),
    message: z.string().describe("The message to send"),
    context: z
      .string()
      .optional()
      .describe("Why this reminder exists, e.g. 'workout-timeout-check'"),
  }),
  handler: async (input) => {
    const storage = createGitHubStorage();
    const r = await storage.addReminder(input);
    return `Scheduled reminder ${r.id} for ${r.triggerDate} ${r.triggerHour}:00.`;
  },
});

export const deleteReminder = defineTool({
  name: "delete_reminder",
  description: "Delete a scheduled reminder by its ID. Use get_reminders first to find the ID.",
  schema: z.object({
    id: z.string(),
  }),
  handler: async (input) => {
    const storage = createGitHubStorage();
    await storage.deleteReminder(input.id);
    return `Deleted reminder ${input.id}.`;
  },
});

export const REMINDER_TOOLS = [getReminders, addReminder, deleteReminder];
