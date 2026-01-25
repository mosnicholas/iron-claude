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

  try {
    const bot = createTelegramBot();
    const agent = createCoachAgent({ timezone, maxTurns: 20 });
    const storage = createGitHubStorage();

    // Check if profile exists
    const profile = await storage.readProfile();
    if (!profile) {
      return {
        success: true,
        message: "No profile configured, skipping planning",
      };
    }

    // Get the next week (we're planning for tomorrow's week)
    const nextWeek = getNextWeek(getCurrentWeek(timezone));

    // Check if plan already exists
    const existingPlan = await storage.readWeeklyPlan(nextWeek);
    if (existingPlan) {
      return {
        success: true,
        week: nextWeek,
        message: `Plan already exists for ${nextWeek}`,
      };
    }

    // Load the planning prompt
    const planningPrompt = buildWeeklyPlanningPrompt();

    // Run the planning task
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

    // Send summary to Telegram
    await bot.sendMessageSafe(response.message);

    return {
      success: true,
      week: nextWeek,
      message: `Generated plan for ${nextWeek}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

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

  try {
    const bot = createTelegramBot();
    const agent = createCoachAgent({ timezone, maxTurns: 20 });

    const planningPrompt = buildWeeklyPlanningPrompt();

    const response = await agent.runTask(
      `Generate a new weekly training plan for ${week}, replacing any existing plan.

${planningPrompt}

After generating the plan:
1. Save it to plans/${week}.md (overwrite if exists)
2. Send a summary to the user`,
      `Force regenerating plan for: ${week}`
    );

    await bot.sendMessageSafe(response.message);

    return {
      success: true,
      week,
      message: `Regenerated plan for ${week}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      error: errorMessage,
    };
  }
}
