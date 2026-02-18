/**
 * Check Reminders Cron Job
 *
 * Checks for due reminders and sends them.
 * Recurring reminders are advanced to the next trigger date instead of deleted.
 * Schedule: Every hour
 */

import { addDays, parse } from "date-fns";
import { getToday, getCurrentHour, getTimezone, formatDate } from "../utils/date.js";
import { type Reminder } from "../storage/github.js";
import { runCronTask, type CronResult } from "./runner.js";

/**
 * Compute the next trigger date for a recurring reminder.
 * Returns the new date string if still within the recurringUntil window, or null if done.
 */
function getNextTriggerDate(reminder: Reminder): string | null {
  if (!reminder.recurringDays || !reminder.recurringUntil) return null;

  const current = parse(reminder.triggerDate, "yyyy-MM-dd", new Date());
  const nextDate = addDays(current, reminder.recurringDays);
  const until = parse(reminder.recurringUntil, "yyyy-MM-dd", new Date());

  if (nextDate > until) return null;
  return formatDate(nextDate);
}

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

        const nextDate = getNextTriggerDate(reminder);
        if (nextDate) {
          await storage.updateReminder(reminder.id, { triggerDate: nextDate });
          console.log(
            `[check-reminders] Sent reminder ${reminder.id}, next occurrence: ${nextDate}`
          );
        } else {
          await storage.deleteReminder(reminder.id);
          console.log(`[check-reminders] Sent and deleted reminder ${reminder.id}`);
        }
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
