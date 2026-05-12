/**
 * Weekly Planning Cron Job
 *
 * Initiates the weekly planning flow by generating a retrospective first,
 * then asking the user questions before generating the plan.
 * Schedule: Sunday at 8:00pm (user's timezone)
 *
 * Flow:
 * 1. Generate retrospective for the ending week
 * 2. Ask planning questions via the coach handler (recorded in message history)
 * 3. User responds via Telegram; coach picks up the plan-week skill from history
 */

import { createCoachAgentV2 } from "../coach-v2/index.js";
import { createTelegramBot } from "../bot/telegram.js";
import { getCurrentWeek, getNextWeek, getWeekDays, getTimezone } from "../utils/date.js";
import { runCronTask, type CronResult } from "./runner.js";

function formatWeekDaysInfo(week: string): string {
  const days = getWeekDays(week);
  const lines = days.map((day) => `- **${day.dayName}**: ${day.dateHuman} (${day.date})`);
  return `## Week Days Reference

${week} runs from ${days[0].dateHuman} to ${days[6].dateHuman}:

${lines.join("\n")}

Use these exact dates when creating the plan. Each day in the plan should include the day name and date (e.g., "## Monday, ${days[0].dateHuman} — Push").`;
}

export type WeeklyPlanResult = CronResult & { week?: string };

export async function runWeeklyPlan(): Promise<WeeklyPlanResult> {
  const timezone = getTimezone();

  return runCronTask(
    "weekly-plan",
    async ({ bot, storage }) => {
      const nextWeek = getNextWeek(getCurrentWeek(timezone));
      const endingWeek = getCurrentWeek(timezone);

      const existingPlan = await storage.readWeeklyPlan(nextWeek);
      if (existingPlan) {
        await bot.sendMessageSafe(`📋 Plan for ${nextWeek} already exists — no action needed.`);
        return { success: true, week: nextWeek, message: `Plan already exists for ${nextWeek}` };
      }

      const agent = createCoachAgentV2({ timezone });

      // Step 1: Generate retrospective for the ending week
      console.log(`[weekly-plan] Generating retro for ending week: ${endingWeek}`);
      await agent.runRetrospective(`Generate the retrospective for week ${endingWeek}.`);
      console.log(`[weekly-plan] Retro generated for ${endingWeek}`);

      // Step 2: Ask planning questions
      const response = await agent.chat(
        `You are starting the weekly planning flow for ${nextWeek}. Ask 2-3 short coaching questions — fatigue, schedule, focus areas. Do NOT generate the plan yet — wait for the athlete's response, then load the plan-week skill.`
      );
      await bot.sendMessageSafe(response.message);

      return {
        success: true,
        week: nextWeek,
        message: `Generated retro for ${endingWeek}, asked planning questions for ${nextWeek}`,
      };
    },
    { errorMessage: 'Had trouble starting the planning process. Say "plan my week" to try again.' }
  ) as Promise<WeeklyPlanResult>;
}

/**
 * Force regenerate a plan (overwrites existing). Routes through the planner.
 */
export async function forceRegeneratePlan(week: string): Promise<WeeklyPlanResult> {
  const timezone = getTimezone();
  console.log(`[weekly-plan] Force regenerating plan for ${week}`);

  try {
    const bot = createTelegramBot();
    const agent = createCoachAgentV2({ timezone });

    const weekDaysInfo = formatWeekDaysInfo(week);

    console.log("[weekly-plan] Starting planner (this may take a while)");
    const response = await agent.runPlanning(
      `Generate a new weekly training plan for ${week}, replacing any existing plan.

${weekDaysInfo}

After generating the plan:
1. Save it via save_plan({week: "${week}", content: <full plan markdown>}) — overwrite if exists
2. Send a 4-6 line summary to the user`
    );
    console.log("[weekly-plan] Planner completed");

    await bot.sendMessageSafe(response.message);

    return { success: true, week, message: `Regenerated plan for ${week}` };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[weekly-plan] Error during force regeneration:", errorMessage);
    return { success: false, error: errorMessage };
  }
}
