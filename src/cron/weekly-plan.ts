/**
 * Weekly Planning Cron Job
 *
 * For each active user, initiates the weekly planning flow by generating a
 * retrospective first, then asking the user questions before generating the
 * plan.
 * Schedule: Sunday at 8:00pm (user's timezone)
 *
 * Flow:
 * 1. Generate retrospective for the ending week
 * 2. Ask planning questions via the coach handler (recorded in message history)
 * 3. User responds via Telegram; coach picks up the plan-week skill from history
 */

import { createCoachAgentV2 } from "../coach-v2/index.js";
import { getStorage } from "../storage/db.js";
import { sendBotMessageForUser } from "../bot/telegram-for-user.js";
import { getUserById } from "../auth/identity.js";
import { getCurrentWeekAt, getNextWeek, getWeekDays } from "../utils/date.js";
import { runCronForEachUser, type CronResult } from "./runner.js";

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
 * Anchor the cron 6 hours back so a delayed Sunday-night run (e.g. the job is
 * queued at 20:00 but doesn't fire until 02:30 Monday) still computes the
 * same `endingWeek`. Without this, a job delayed across Sunday→Monday
 * midnight would generate a retro for the just-started week and a plan for
 * the week after — skipping the actual upcoming week entirely.
 */
const CRON_ANCHOR_OFFSET_MS = 6 * 60 * 60 * 1000;

export async function runWeeklyPlan(asOf: Date = new Date()): Promise<WeeklyPlanResult> {
  const anchor = new Date(asOf.getTime() - CRON_ANCHOR_OFFSET_MS);
  return runCronForEachUser(
    "weekly-plan",
    async ({ user, storage, sendMessage }) => {
      const timezone = user.timezone;
      const endingWeek = getCurrentWeekAt(anchor, timezone);
      const nextWeek = getNextWeek(endingWeek);

      const existingPlan = await storage.readWeeklyPlan(user.id, nextWeek);
      if (existingPlan) {
        await sendMessage(`📋 Plan for ${nextWeek} already exists — no action needed.`);
        return { success: true, message: `Plan already exists for ${nextWeek}` };
      }

      const agent = createCoachAgentV2({ userId: user.id, timezone });

      // Step 1: Generate retrospective for the ending week
      console.log(`[weekly-plan] user=${user.id} generating retro for ending week: ${endingWeek}`);
      await agent.runRetrospective(`Generate the retrospective for week ${endingWeek}.`);
      console.log(`[weekly-plan] user=${user.id} retro generated for ${endingWeek}`);

      // Step 2: Ask planning questions
      const response = await agent.chat(
        `You are starting the weekly planning flow for ${nextWeek}. Ask 2-3 short coaching questions — fatigue, schedule, focus areas. Do NOT generate the plan yet — wait for the athlete's response, then load the plan-week skill.`
      );
      await sendMessage(response.message);

      return {
        success: true,
        message: `Generated retro for ${endingWeek}, asked planning questions for ${nextWeek}`,
      };
    },
    { errorMessage: 'Had trouble starting the planning process. Say "plan my week" to try again.' }
  );
}

/**
 * Force regenerate a plan for a specific user (overwrites existing).
 * Routes through the planner.
 */
export async function forceRegeneratePlan(userId: string, week: string): Promise<WeeklyPlanResult> {
  console.log(`[weekly-plan] user=${userId} force regenerating plan for ${week}`);

  try {
    const user = await getUserById(userId);
    if (!user) {
      return { success: false, error: `User ${userId} not found` };
    }
    const timezone = user.timezone;

    // Touch storage to ensure the plan target user exists / catches early DB errors.
    void getStorage();

    const agent = createCoachAgentV2({ userId, timezone });

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

    await sendBotMessageForUser(user, response.message);

    return { success: true, week, message: `Regenerated plan for ${week}` };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[weekly-plan] Error during force regeneration:", errorMessage);
    return { success: false, error: errorMessage };
  }
}
