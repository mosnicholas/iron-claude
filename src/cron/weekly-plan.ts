/**
 * Weekly Planning Cron Job
 *
 * Generates the weekly training plan.
 * Schedule: Sunday at 8:00pm (user's timezone)
 */

import { createCoachAgent } from "../coach/index.js";
import { createTelegramBot } from "../bot/telegram.js";
import { createGitHubStorage } from "../storage/github.js";
import { buildWeeklyPlanningPrompt } from "../coach/prompts.js";
import { getCurrentWeek, getNextWeek } from "../utils/date.js";

export interface WeeklyPlanResult {
  success: boolean;
  week?: string;
  message?: string;
  error?: string;
}

/**
 * Run the weekly planning job
 */
export async function runWeeklyPlan(): Promise<WeeklyPlanResult> {
  const timezone = process.env.TIMEZONE || "America/New_York";
  console.log("[weekly-plan] Starting weekly planning job");

  try {
    console.log("[weekly-plan] Initializing bot, agent, and storage");
    const bot = createTelegramBot();
    const agent = createCoachAgent({ timezone, maxTurns: 20 });
    const storage = createGitHubStorage();

    // Check if profile exists
    console.log("[weekly-plan] Checking for profile");
    const profile = await storage.readProfile();
    if (!profile) {
      console.log("[weekly-plan] No profile found, skipping");
      return {
        success: true,
        message: "No profile configured, skipping planning",
      };
    }
    console.log("[weekly-plan] Profile found");

    // Get the next week (we're planning for tomorrow's week)
    const nextWeek = getNextWeek(getCurrentWeek(timezone));
    console.log(`[weekly-plan] Planning for week: ${nextWeek}`);

    // Check if plan already exists
    console.log("[weekly-plan] Checking for existing plan");
    const existingPlan = await storage.readWeeklyPlan(nextWeek);
    if (existingPlan) {
      console.log(`[weekly-plan] Plan already exists for ${nextWeek}`);
      return {
        success: true,
        week: nextWeek,
        message: `Plan already exists for ${nextWeek}`,
      };
    }

    // Load the planning prompt
    console.log("[weekly-plan] Building planning prompt");
    const planningPrompt = buildWeeklyPlanningPrompt();

    // Run the planning task
    console.log("[weekly-plan] Starting agent planning task (this may take a while)");
    const response = await agent.runTask(
      `Generate the weekly training plan for ${nextWeek}.

${planningPrompt}

After generating the plan:
1. Save it to plans/${nextWeek}.md
2. Update CLAUDE.md with the new program week number if tracking
3. Send a summary to the user

The summary should include:
- The week's theme/focus
- Brief overview of each day
- Any key targets or goals
- A motivating note`,
      `Planning for: ${nextWeek}`
    );
    console.log("[weekly-plan] Agent completed planning task");

    // Send summary to Telegram
    console.log("[weekly-plan] Sending summary to Telegram");
    await bot.sendMessageSafe(response.message);
    console.log("[weekly-plan] Summary sent successfully");

    return {
      success: true,
      week: nextWeek,
      message: `Generated plan for ${nextWeek}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[weekly-plan] Error during planning:", errorMessage);

    // Try to notify user of failure
    try {
      const bot = createTelegramBot();
      await bot.sendMessage(
        `⚠️ Had trouble generating next week's plan. ` +
          `I'll try again, or you can ask me "plan my week" to generate it manually.`
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
 * Check if a plan already exists for a week
 */
export async function planExists(week: string): Promise<boolean> {
  const storage = createGitHubStorage();
  const plans = await storage.listPlans();
  return plans.some((p) => p.includes(week));
}

/**
 * Force regenerate a plan (overwrites existing)
 */
export async function forceRegeneratePlan(week: string): Promise<WeeklyPlanResult> {
  const timezone = process.env.TIMEZONE || "America/New_York";
  console.log(`[weekly-plan] Force regenerating plan for ${week}`);

  try {
    console.log("[weekly-plan] Initializing bot and agent");
    const bot = createTelegramBot();
    const agent = createCoachAgent({ timezone, maxTurns: 20 });

    console.log("[weekly-plan] Building planning prompt");
    const planningPrompt = buildWeeklyPlanningPrompt();

    console.log("[weekly-plan] Starting agent planning task (this may take a while)");
    const response = await agent.runTask(
      `Generate a new weekly training plan for ${week}, replacing any existing plan.

${planningPrompt}

After generating the plan:
1. Save it to plans/${week}.md (overwrite if exists)
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
