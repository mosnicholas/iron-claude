/**
 * Daily Reminder Cron Job
 *
 * Sends the morning workout reminder to each active user.
 * Schedule: Daily at 6:00am (user's timezone)
 */

import { createCoachAgentV2 } from "../coach-v2/index.js";
import { getCurrentWeek, getToday, formatDateHuman } from "../utils/date.js";
import { runCronForEachUser, type CronResult } from "./runner.js";

/**
 * Run the daily reminder job for each active user.
 */
export async function runDailyReminder(): Promise<CronResult> {
  return runCronForEachUser(
    "daily-reminder",
    async ({ user, storage, sendMessage }) => {
      const timezone = user.timezone;
      const currentWeek = getCurrentWeek(timezone);
      const today = getToday(timezone);

      const plan = await storage.readWeeklyPlan(user.id, currentWeek);

      if (!plan) {
        await sendMessage(
          `Good morning! No plan loaded for this week (${currentWeek}). ` +
            `Want me to generate one? Just say "plan my week".`
        );
        return { success: true, message: "No weekly plan found, sent prompt to generate" };
      }

      const agent = createCoachAgentV2({ userId: user.id, timezone });
      const response = await agent.runDailyReminder(
        `Generate the morning workout reminder for ${formatDateHuman(new Date(today))} (${today}). ` +
          `Reference today's plan. End by asking what time they're heading to the gym ` +
          `so you can schedule a warm-up reminder.`
      );
      await sendMessage(response.message);

      return { success: true, message: `Sent morning reminder for ${today}` };
    },
    {
      errorMessage:
        'Morning reminder failed to send. Ask me "what\'s my workout today?" to see your workout.',
    }
  );
}
