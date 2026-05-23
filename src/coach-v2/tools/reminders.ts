/**
 * Reminder tools — schedule one-shot Telegram reminders.
 * Stored in the `reminders` table; the hourly check-reminders cron sweeps it.
 */

import { z } from "zod";
import { defineTool } from "../tool.js";

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
  handler: async (input, ctx) => {
    const r = await ctx.storage.addReminder(ctx.userId, {
      triggerDate: input.triggerDate,
      triggerHour: input.triggerHour,
      message: input.message,
      context: input.context ?? null,
    });
    return `Scheduled reminder ${r.id} for ${r.triggerDate} ${r.triggerHour}:00.`;
  },
});

export const REMINDER_TOOLS = [addReminder];
