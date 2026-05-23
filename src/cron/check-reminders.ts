/**
 * Check Reminders Cron Job
 *
 * For each active user, checks for due reminders and sends them.
 * Schedule: Every hour
 */

import { getToday, getCurrentHour } from "../utils/date.js";
import { runCronForEachUser, type CronResult } from "./runner.js";

/**
 * Run the check-reminders job for each active user.
 */
export async function runCheckReminders(): Promise<CronResult> {
  return runCronForEachUser(
    "check-reminders",
    async ({ user, storage, sendMessage }) => {
      const timezone = user.timezone;
      const today = getToday(timezone);
      const currentHour = getCurrentHour(timezone);

      const dueReminders = await storage.getDueReminders(user.id, today, currentHour);

      if (dueReminders.length === 0) {
        return {
          success: true,
          message: `No reminders due at ${today} ${currentHour}:00`,
        };
      }

      console.log(`[check-reminders] user=${user.id} found ${dueReminders.length} due reminder(s)`);

      for (const reminder of dueReminders) {
        try {
          await sendMessage(reminder.message);
          await storage.deleteReminder(user.id, reminder.id);
          console.log(`[check-reminders] user=${user.id} sent and deleted reminder ${reminder.id}`);
        } catch (error) {
          console.error(
            `[check-reminders] user=${user.id} failed to process reminder ${reminder.id}:`,
            error
          );
        }
      }

      return {
        success: true,
        message: `Processed ${dueReminders.length} reminder(s) at ${today} ${currentHour}:00`,
      };
    },
    { requireProfile: false }
  );
}
