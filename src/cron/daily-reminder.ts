/**
 * Daily Reminder Cron Job
 *
 * Sends the morning workout reminder.
 * Schedule: Daily at 6:00am (user's timezone)
 */

import { createCoachAgentV2 } from "../coach-v2/index.js";
import { getCurrentWeek, getToday, formatDateHuman, getTimezone } from "../utils/date.js";
import { runCronTask, type CronResult } from "./runner.js";

/**
 * Run the daily reminder job
 */
export async function runDailyReminder(): Promise<CronResult> {
  const timezone = getTimezone();

  return runCronTask(
    "daily-reminder",
    async ({ bot, storage }) => {
      const currentWeek = getCurrentWeek(timezone);
      const today = getToday(timezone);

      const planContent = await storage.readWeeklyPlan(currentWeek);

      if (!planContent) {
        await bot.sendMessage(
          `Good morning! No plan loaded for this week (${currentWeek}). ` +
            `Want me to generate one? Just say "plan my week".`
        );
        return { success: true, message: "No weekly plan found, sent prompt to generate" };
      }

      const agent = createCoachAgentV2({ timezone });
      const response = await agent.runDailyReminder(
        `Generate the morning workout reminder for ${formatDateHuman(new Date(today))} (${today}). ` +
          `Reference today's plan. End by asking what time they're heading to the gym ` +
          `so you can schedule a warm-up reminder.`
      );
      await bot.sendMessageSafe(response.message);

      return { success: true, message: `Sent morning reminder for ${today}` };
    },
    {
      errorMessage:
        'Morning reminder failed to send. Ask me "what\'s my workout today?" to see your workout.',
    }
  );
}
