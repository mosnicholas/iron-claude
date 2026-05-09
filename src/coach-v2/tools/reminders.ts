/**
 * Reminder tools — schedule one-shot Telegram reminders.
 * Backed by GitHubStorage's reminders.json — checked hourly by the cron.
 *
 * Only `add_reminder` is exposed to the coach. The internal cleanup paths
 * (workout-timeout-check after complete_workout, hourly cron sweep) call
 * `storage.getReminders` / `storage.deleteReminder` directly.
 */

import { z } from "zod";
import { defineTool } from "../tool.js";
import { createGitHubStorage } from "../../storage/github.js";

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

export const REMINDER_TOOLS = [addReminder];
