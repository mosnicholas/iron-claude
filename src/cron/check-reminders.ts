/**
 * Reminder delivery — per-user logic. Dispatched hourly via pg-boss
 * `check-reminders.tick` → `check-reminders.user`.
 *
 * `getDueReminders` returns ALL past-due rows so a delayed tick still
 * catches reminders it missed.
 */

import { getToday, getCurrentHour } from "../utils/date.js";
import type { JobCtx } from "../jobs/handlers.js";

export async function processCheckRemindersForUser({
  user,
  storage,
  sendMessage,
}: JobCtx): Promise<{ success: boolean; message?: string; error?: string }> {
  const timezone = user.timezone;
  const today = getToday(timezone);
  const currentHour = getCurrentHour(timezone);

  const dueReminders = await storage.getDueReminders(user.id, today, currentHour);

  if (dueReminders.length === 0) {
    return { success: true, message: `no reminders due at ${today} ${currentHour}:00` };
  }

  console.log(`[check-reminders] user=${user.id} found ${dueReminders.length} due reminder(s)`);

  let sent = 0;
  for (const reminder of dueReminders) {
    try {
      await sendMessage(reminder.message);
      // Only delete on successful send. A failed send leaves the row so the
      // next hourly tick picks it up.
      await storage.deleteReminder(user.id, reminder.id);
      sent += 1;
    } catch (error) {
      console.error(
        `[check-reminders] user=${user.id} failed to process reminder ${reminder.id}:`,
        error
      );
    }
  }

  return {
    success: true,
    message: `Sent ${sent}/${dueReminders.length} reminder(s) at ${today} ${currentHour}:00`,
  };
}
