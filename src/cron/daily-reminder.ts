/**
 * Daily Reminder Cron Job
 *
 * Sends the morning workout reminder.
 * Schedule: Daily at 6:00am (user's timezone)
 */

import { createCoachAgent } from "../coach/index.js";
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

      // Read the weekly plan
      const planContent = await storage.readWeeklyPlan(currentWeek);

      if (!planContent) {
        await bot.sendMessage(
          `Good morning! No plan loaded for this week (${currentWeek}). ` +
            `Want me to generate one? Just say "plan my week".`
        );
        return { success: true, message: "No weekly plan found, sent prompt to generate" };
      }

      // Use the agent to generate a good morning message
      const agent = createCoachAgent({ timezone });
      const response = await agent.runTask(
        `Generate a morning workout reminder for today (${formatDateHuman(new Date(today))}).

Read the weekly plan (weeks/${currentWeek}/plan.md) and create a motivating message with TWO sections:

**PART 1 — High-Level Overview:**
1. A brief greeting appropriate for the day
2. Today's workout type, focus, and estimated duration
3. Main lifts with sets/reps/weights highlighted
4. Any skill work or special focus areas
5. Key coaching notes from the plan (e.g. "this is a test weight", "road to X")

**PART 2 — Full Exercise-by-Exercise Breakdown:**
List EVERY exercise in order, including:
- **Warm-up**: Specify what to do (e.g. "5 min cardio, band pull-aparts 2x15, ramp-up sets with bar/light weight"). If the plan doesn't specify a warm-up, include a sensible default warm-up for the day's main lifts.
- **Main lifts**: Exercise name, sets x reps @ weight, rest periods
- **Accessories**: Exercise name, sets x reps @ weight, any superset notes
- **Skill work**: Exercise name, sets x reps/duration
- **Cool-down**: If specified in the plan

This is the athlete's step-by-step guide for the session — they should be able to walk into the gym and follow it exercise by exercise without needing to check anything else.

If it's a rest day: acknowledge it and suggest optional activities.
If it's an optional day: present the options with the same two-section format.

Keep the tone concise and motivating — this is for Telegram. Use emoji sparingly.`
      );

      await bot.sendMessageSafe(response.message);

      // Ask what time they're heading to the gym and save pending state
      await bot.sendMessage(
        "What time are you heading to the gym today? " +
          "I'll send you a reminder with your warm-up when it's time."
      );
      await storage.saveGymTimePendingState(today);

      return { success: true, message: `Sent morning reminder for ${today}` };
    },
    {
      errorMessage:
        'Morning reminder failed to send. Ask me "what\'s my workout today?" to see your workout.',
    }
  );
}
