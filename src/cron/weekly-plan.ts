/**
 * Weekly Planning Cron Job
 *
 * Initiates the weekly planning flow by generating a retrospective first,
 * then asking the user questions before generating the plan.
 * Schedule: Sunday at 8:00pm (user's timezone)
 *
 * Flow:
 * 1. Generate retrospective for the ending week
 * 2. Create state/planning-pending.md signal file
 * 3. Ask planning questions via the agent (recorded in message history)
 * 4. User responds via Telegram
 * 5. Webhook detects signal file, routes response with PLAN_GENERATION_INSTRUCTIONS
 * 6. Agent generates the plan and deletes the signal file
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { createCoachAgent } from "../coach/index.js";
import { createCoachAgentV2, isV2Enabled } from "../coach-v2/index.js";
import { createTelegramBot } from "../bot/telegram.js";
import { RETRO_INSTRUCTIONS } from "../coach/prompts.js";
import { getCurrentWeek, getNextWeek, getWeekDays, getTimezone } from "../utils/date.js";
import { runCronTask, type CronResult } from "./runner.js";
import { REPO_DIR } from "../storage/repo-sync.js";

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
 * Run the weekly planning job.
 *
 * Steps:
 * 1. Generate retrospective for the ending week
 * 2. Create planning signal file
 * 3. Ask planning questions via the agent
 *
 * The user's response is handled by the webhook, which detects the
 * signal file and routes the message with PLAN_GENERATION_INSTRUCTIONS.
 */
export async function runWeeklyPlan(): Promise<WeeklyPlanResult> {
  const timezone = getTimezone();

  return runCronTask(
    "weekly-plan",
    async ({ bot, storage }) => {
      const nextWeek = getNextWeek(getCurrentWeek(timezone));
      const endingWeek = getCurrentWeek(timezone);

      // Check if plan already exists
      const existingPlan = await storage.readWeeklyPlan(nextWeek);
      if (existingPlan) {
        await bot.sendMessageSafe(`📋 Plan for ${nextWeek} already exists — no action needed.`);
        return { success: true, week: nextWeek, message: `Plan already exists for ${nextWeek}` };
      }

      const useV2 = isV2Enabled();
      const agent = useV2 ? null : createCoachAgent({ timezone });
      const agentV2 = useV2 ? createCoachAgentV2({ timezone }) : null;

      // Step 1: Generate retrospective for the ending week
      console.log(`[weekly-plan] Generating retro for ending week: ${endingWeek}`);
      if (useV2) {
        await agentV2!.runRetrospective(`Generate the retrospective for week ${endingWeek}.`);
      } else {
        await agent!.runTask(
          `Generate the retrospective for week ${endingWeek}.`,
          RETRO_INSTRUCTIONS
        );
      }
      console.log(`[weekly-plan] Retro generated for ${endingWeek}`);

      // Step 2: Create planning signal file
      const repoPath = REPO_DIR;
      const stateDir = join(repoPath, "state");
      if (!existsSync(stateDir)) {
        mkdirSync(stateDir, { recursive: true });
      }
      const signalPath = join(repoPath, "state", "planning-pending.md");
      writeFileSync(signalPath, `week: ${nextWeek}\ncreated: ${new Date().toISOString()}\n`);
      console.log(`[weekly-plan] Created planning signal for ${nextWeek}`);

      // Step 3: Ask planning questions via agent. v2 routes through the
      // coach handler with a planning-question prompt — same shape as v1.
      const planningQuestion =
        "You are starting the weekly planning flow. Ask 2-3 short coaching questions for next week — fatigue, schedule, focus areas. Do NOT generate the plan yet — wait for the athlete's response.";

      const response = useV2
        ? await agentV2!.chat(planningQuestion)
        : await agent!.runTask(
            "Ask the athlete your Sunday planning questions for next week. Ask about fatigue, schedule, and focus areas.",
            "You are starting the weekly planning flow. Ask 2-3 short coaching questions. Do NOT generate the plan yet — wait for their response."
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
