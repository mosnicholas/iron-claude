/**
 * Check Reminders Cron Job
 *
 * Checks for due reminders and sends them.
 * Schedule: Every hour
 */

import { createTelegramBot } from "../bot/telegram.js";
import { createGitHubStorage } from "../storage/github.js";
import { getToday, getCurrentHour } from "../utils/date.js";

export interface CheckRemindersResult {
  success: boolean;
  message?: string;
  error?: string;
  remindersProcessed?: number;
}

/**
 * Run the check-reminders job
 */
export async function runCheckReminders(): Promise<CheckRemindersResult> {
  const timezone = process.env.TIMEZONE || "America/New_York";
  console.log("[check-reminders] Starting reminder check");

  try {
    const bot = createTelegramBot();
    const storage = createGitHubStorage();

    // Check if profile exists (if not, skip)
    const profile = await storage.readProfile();
    if (!profile) {
      console.log("[check-reminders] No profile found, skipping");
      return {
        success: true,
        message: "No profile configured, skipping reminder check",
        remindersProcessed: 0,
      };
    }

    // Get current date and hour in timezone
    const today = getToday(timezone);
    const currentHour = getCurrentHour(timezone);
    console.log(`[check-reminders] Checking for reminders at ${today} ${currentHour}:00`);

    // Get due reminders
    const dueReminders = await storage.getDueReminders(today, currentHour);

    if (dueReminders.length === 0) {
      console.log("[check-reminders] No reminders due");
      return {
        success: true,
        message: `No reminders due at ${today} ${currentHour}:00`,
        remindersProcessed: 0,
      };
    }

    console.log(`[check-reminders] Found ${dueReminders.length} due reminder(s)`);

    // Process each reminder
    for (const reminder of dueReminders) {
      try {
        // Send the reminder message
        await bot.sendMessageSafe(reminder.message);
        console.log(`[check-reminders] Sent reminder ${reminder.id}`);

        // Delete the processed reminder
        await storage.deleteReminder(reminder.id);
        console.log(`[check-reminders] Deleted reminder ${reminder.id}`);
      } catch (error) {
        console.error(`[check-reminders] Failed to process reminder ${reminder.id}:`, error);
        // Continue with other reminders even if one fails
      }
    }

    return {
      success: true,
      message: `Processed ${dueReminders.length} reminder(s) at ${today} ${currentHour}:00`,
      remindersProcessed: dueReminders.length,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[check-reminders] Error:", errorMessage);

    return {
      success: false,
      error: errorMessage,
      remindersProcessed: 0,
    };
  }
}
