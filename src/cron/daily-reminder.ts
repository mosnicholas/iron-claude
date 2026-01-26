/**
 * Daily Reminder Cron Job
 *
 * Sends the morning workout reminder.
 * Schedule: Daily at 6:00am (user's timezone)
 */

import { createCoachAgent } from "../coach/index.js";
import { createTelegramBot } from "../bot/telegram.js";
import { createGitHubStorage } from "../storage/github.js";
import { getCurrentWeek, getToday, formatDateHuman } from "../utils/date.js";

export interface DailyReminderResult {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Run the daily reminder job
 */
export async function runDailyReminder(): Promise<DailyReminderResult> {
  const timezone = process.env.TIMEZONE || "America/New_York";
  console.log("[daily-reminder] Starting daily reminder job");

  try {
    console.log("[daily-reminder] Initializing bot, agent, and storage");
    const bot = createTelegramBot();
    const agent = createCoachAgent({ timezone });
    const storage = createGitHubStorage();

    // Check if profile exists (if not, skip)
    console.log("[daily-reminder] Checking for profile");
    const profile = await storage.readProfile();
    if (!profile) {
      console.log("[daily-reminder] No profile found, skipping");
      return {
        success: true,
        message: "No profile configured, skipping reminder",
      };
    }
    console.log("[daily-reminder] Profile found");

    // Get current week and today's date
    const currentWeek = getCurrentWeek(timezone);
    const today = getToday(timezone);
    console.log(`[daily-reminder] Week: ${currentWeek}, Today: ${today}`);

    // Read the weekly plan
    console.log("[daily-reminder] Reading weekly plan");
    const planContent = await storage.readWeeklyPlan(currentWeek);

    if (!planContent) {
      // No plan for this week
      console.log("[daily-reminder] No weekly plan found, prompting user");
      await bot.sendMessage(
        `Good morning! No plan loaded for this week (${currentWeek}). ` +
          `Want me to generate one? Just say "plan my week" or run /plan.`
      );
      return {
        success: true,
        message: "No weekly plan found, sent prompt to generate",
      };
    }
    console.log("[daily-reminder] Weekly plan found");

    // Use the agent to generate a good morning message
    console.log("[daily-reminder] Starting agent task to generate reminder");
    const response = await agent.runTask(
      `Generate a morning workout reminder for today (${formatDateHuman(new Date(today))}).

Read the weekly plan (plans/${currentWeek}.md) and create a motivating message that includes:

1. A brief greeting appropriate for the day
2. Today's workout summary:
   - If it's a workout day: list the exercises with sets/reps/weights
   - If it's a rest day: acknowledge it and suggest optional activities
   - If it's an optional day: present the options
3. Any relevant notes from the plan
4. A brief motivating sign-off

Keep it concise - this is for Telegram. Use emoji sparingly.`
    );
    console.log("[daily-reminder] Agent completed task");

    console.log("[daily-reminder] Sending message to Telegram");
    await bot.sendMessageSafe(response.message);
    console.log("[daily-reminder] Message sent successfully");

    return {
      success: true,
      message: `Sent morning reminder for ${today}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[daily-reminder] Error:", errorMessage);

    // Notify user of failure
    try {
      const bot = createTelegramBot();
      await bot.sendMessage(
        `⚠️ Morning reminder failed to send. ` +
          `Check /today to see your workout, or ask me "what's my workout today?"`
      );
    } catch {
      // Ignore notification failure
    }

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Generate a fallback message when the agent fails
 */
export function getFallbackMessage(dayName: string, isRestDay: boolean): string {
  if (isRestDay) {
    return `Good morning! It's ${dayName} - rest up and recover.`;
  }

  return `Good morning! Ready to train today?

Check your plan with /today or /plan.

Let's get after it!`;
}
