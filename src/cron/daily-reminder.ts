/**
 * Daily Reminder Cron Job
 *
 * Sends the morning workout reminder.
 * Schedule: Daily at 6:00am (user's timezone)
 */

import { createCoachAgent } from "../coach/index.js";
import { createTelegramBot } from "../bot/telegram.js";
import { createGitHubStorage } from "../storage/github.js";
import { getCurrentWeek, getToday, formatDateHuman, getTimezone } from "../utils/date.js";

export interface DailyReminderResult {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Run the daily reminder job
 */
export async function runDailyReminder(): Promise<DailyReminderResult> {
  const timezone = getTimezone();
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
    console.log("[daily-reminder] Agent completed task");

    console.log("[daily-reminder] Sending message to Telegram");
    await bot.sendMessageSafe(response.message);
    console.log("[daily-reminder] Message sent successfully");

    // Ask what time they're heading to the gym and save pending state
    // (only on workout days — the agent's response will mention the workout)
    console.log("[daily-reminder] Asking about gym time");
    await bot.sendMessage(
      "What time are you heading to the gym today? " +
        "I'll send you a reminder with your warm-up when it's time."
    );
    await storage.saveGymTimePendingState(today);
    console.log("[daily-reminder] Gym time pending state saved");

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
