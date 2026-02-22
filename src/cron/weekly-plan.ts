/**
 * Weekly Planning Cron Job
 *
 * Initiates the weekly planning flow by asking the user questions first.
 * Schedule: Sunday at 8:00pm (user's timezone)
 *
 * Flow:
 * 1. Cron job sends coaching questions via the agent (recorded in message history)
 * 2. User responds via Telegram
 * 3. Normal webhook chat handles the response — agent sees its own questions
 *    in message history, recognizes the context, and generates the plan
 */

import { createCoachAgent } from "../coach/index.js";
import { createTelegramBot } from "../bot/telegram.js";
import { getCurrentWeek, getNextWeek, getWeekDays, getTimezone } from "../utils/date.js";
import { runCronTask, type CronResult } from "./runner.js";

/**
 * Format week days info for the planning prompt
 */
function formatWeekDaysInfo(week: string): string {
  const days = getWeekDays(week);
  const lines = days.map((day) => `- **${day.dayName}**: ${day.dateHuman} (${day.date})`);
  return `## Week Days Reference

${week} runs from ${days[0].dateHuman} to ${days[6].dateHuman}:

${lines.join("\n")}

Use these exact dates when creating the plan. Each day in the plan should include the day name and date (e.g., "## Monday, ${days[0].dateHuman} — Push").`;
}

export type WeeklyPlanResult = CronResult & { week?: string };

/**
 * Run the weekly planning job - asks questions via the agent
 *
 * The agent's message gets recorded in message history, so when the user
 * replies, the normal webhook chat path handles it — the agent sees its own
 * questions in history and recognizes the context to generate the plan.
 */
export async function runWeeklyPlan(): Promise<WeeklyPlanResult> {
  const timezone = getTimezone();

  return runCronTask(
    "weekly-plan",
    async ({ bot, storage }) => {
      const nextWeek = getNextWeek(getCurrentWeek(timezone));

      // Check if plan already exists
      const existingPlan = await storage.readWeeklyPlan(nextWeek);
      if (existingPlan) {
        await bot.sendMessageSafe(`📋 Plan for ${nextWeek} already exists — no action needed.`);
        return { success: true, week: nextWeek, message: `Plan already exists for ${nextWeek}` };
      }

      // Use the agent to ask planning questions (recorded in message history)
      const agent = createCoachAgent({ timezone });
      const response = await agent.runTask(
        `It's Sunday evening — time to plan next week (${nextWeek}).

Check if a plan for ${nextWeek} already exists (weeks/${nextWeek}/plan.md). If it does, just let the user know.

If no plan exists, ask the user a few quick questions before generating the plan:
1. How are they feeling? Any fatigue, soreness, or niggles?
2. Any schedule changes this week? Travel, busy days, time constraints?
3. Anything they want to focus on? A lift to push, skill to work on, area to prioritize?

Keep it conversational and concise — this is Telegram. Tell them to reply whenever they're ready and you'll build the plan around their input.`
      );

      await bot.sendMessageSafe(response.message);

      return {
        success: true,
        week: nextWeek,
        message: `Asked planning questions for ${nextWeek} via agent`,
      };
    },
    { errorMessage: 'Had trouble starting the planning process. Say "plan my week" to try again.' }
  ) as Promise<WeeklyPlanResult>;
}

/**
 * Force regenerate a plan (overwrites existing)
 */
export async function forceRegeneratePlan(week: string): Promise<WeeklyPlanResult> {
  const timezone = getTimezone();
  console.log(`[weekly-plan] Force regenerating plan for ${week}`);

  try {
    console.log("[weekly-plan] Initializing bot and agent");
    const bot = createTelegramBot();
    const agent = createCoachAgent({ timezone });

    const weekDaysInfo = formatWeekDaysInfo(week);

    console.log("[weekly-plan] Starting agent planning task (this may take a while)");
    const response = await agent.runTask(
      `Generate a new weekly training plan for ${week}, replacing any existing plan. Follow the weekly-planning-guide in your reference guides step by step.

${weekDaysInfo}

After generating the plan:
1. Save it to weeks/${week}/plan.md (overwrite if exists)
2. Send a summary to the user`,
      `Force regenerating plan for: ${week}`
    );
    console.log("[weekly-plan] Agent completed planning task");

    console.log("[weekly-plan] Sending summary to Telegram");
    await bot.sendMessageSafe(response.message);
    console.log("[weekly-plan] Summary sent successfully");

    return {
      success: true,
      week,
      message: `Regenerated plan for ${week}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[weekly-plan] Error during force regeneration:", errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
}
