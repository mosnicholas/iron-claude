/**
 * Daily Reminder Cron Job
 *
 * Sends the morning workout reminder.
 * Schedule: Daily at 6:00am (user's timezone)
 */

import { CoachAgent, createCoachAgent } from '../coach/index.js';
import { createTelegramBot, TelegramBot } from '../bot/telegram.js';
import { getCurrentWeek, getToday, formatDateHuman, getDayName, isWeekend } from '../utils/date.js';

export interface DailyReminderResult {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Run the daily reminder job
 */
export async function runDailyReminder(): Promise<DailyReminderResult> {
  const timezone = process.env.TIMEZONE || 'America/New_York';

  try {
    const bot = createTelegramBot();
    const agent = createCoachAgent({ timezone });
    const storage = agent.getStorage();

    // Check if profile exists (if not, skip)
    const profile = await storage.readProfile();
    if (!profile) {
      return {
        success: true,
        message: 'No profile configured, skipping reminder',
      };
    }

    // Get current week and today's date
    const currentWeek = getCurrentWeek(timezone);
    const today = getToday(timezone);
    const dayName = getDayName(new Date(today));

    // Read the weekly plan
    const planContent = await storage.readWeeklyPlan(currentWeek);

    if (!planContent) {
      // No plan for this week
      await bot.sendMessage(
        `Good morning! No plan loaded for this week (${currentWeek}). ` +
        `Want me to generate one? Just say "plan my week" or run /plan.`
      );
      return {
        success: true,
        message: 'No weekly plan found, sent prompt to generate',
      };
    }

    // Use the agent to generate a good morning message
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

    await bot.sendMessageSafe(response.message);

    return {
      success: true,
      message: `Sent morning reminder for ${today}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Generate a fallback message when the agent fails
 */
export function getFallbackMessage(dayName: string): string {
  if (isWeekend(new Date())) {
    return `Good morning! It's ${dayName} — rest up and recover. 🛋️`;
  }

  return `Good morning! Ready to train today?

Check your plan with /today or /plan.

Let's get after it! 💪`;
}
