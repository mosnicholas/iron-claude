/**
 * Check Reminders Cron Job
 *
 * Checks for due reminders and sends them.
 * Schedule: Every hour
 */

import { getToday, getCurrentHour, getTimezone } from "../utils/date.js";
import { runCronTask, type CronResult } from "./runner.js";

/**
 * Run the check-reminders job
 */
export async function runCheckReminders(): Promise<CronResult> {
  const timezone = getTimezone();

  return runCronTask("check-reminders", async ({ bot, storage }) => {
    const today = getToday(timezone);
    const currentHour = getCurrentHour(timezone);

    const dueReminders = await storage.getDueReminders(today, currentHour);

    if (dueReminders.length === 0) {
      return {
        success: true,
        message: `No reminders due at ${today} ${currentHour}:00`,
      };
    }

    console.log(`[check-reminders] Found ${dueReminders.length} due reminder(s)`);

    for (const reminder of dueReminders) {
      try {
        await bot.sendMessageSafe(reminder.message);
        await storage.deleteReminder(reminder.id);
        console.log(`[check-reminders] Sent and deleted reminder ${reminder.id}`);
      } catch (error) {
        console.error(`[check-reminders] Failed to process reminder ${reminder.id}:`, error);
      }
    }

    return {
      success: true,
      message: `Processed ${dueReminders.length} reminder(s) at ${today} ${currentHour}:00`,
    };
  });
}
