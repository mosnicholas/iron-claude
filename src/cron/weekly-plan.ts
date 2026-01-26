/**
 * Weekly Planning Cron Job
 *
 * Initiates the weekly planning flow by asking the user questions first.
 * Schedule: Sunday at 8:00pm (user's timezone)
 *
 * Flow:
 * 1. Cron job sends coaching questions
 * 2. User responds via Telegram
 * 3. Webhook detects pending planning state and generates plan with user context
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
 * Planning questions to ask the user before generating the plan
 */
const PLANNING_QUESTIONS = `Hey! Time to plan next week 📋

Before I put together your plan, a few quick questions:

1. **How are you feeling?** Any fatigue, soreness, or niggles I should know about?

2. **Any schedule changes?** Travel, busy days, or time constraints?

3. **Anything you want to focus on?** A lift you want to push, skill to work on, or area to prioritize?

Just reply with whatever's on your mind and I'll build your plan around it.`;

/**
 * Run the weekly planning job - asks questions first
 */
export async function runWeeklyPlan(): Promise<WeeklyPlanResult> {
  const timezone = process.env.TIMEZONE || "America/New_York";
  console.log("[weekly-plan] Starting weekly planning job");

  try {
    console.log("[weekly-plan] Initializing bot and storage");
    const bot = createTelegramBot();
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

    // Check if we already asked (don't spam)
    const pendingState = await storage.getPlanningState();
    if (pendingState && pendingState.week === nextWeek) {
      console.log(`[weekly-plan] Already waiting for planning input for ${nextWeek}`);
      return {
        success: true,
        week: nextWeek,
        message: `Already waiting for planning input for ${nextWeek}`,
      };
    }

    // Save planning state and ask questions
    console.log("[weekly-plan] Saving planning state and asking questions");
    await storage.savePlanningState(nextWeek);
    await bot.sendMessageSafe(PLANNING_QUESTIONS);
    console.log("[weekly-plan] Questions sent, waiting for user response");

    return {
      success: true,
      week: nextWeek,
      message: `Asked planning questions for ${nextWeek}, waiting for response`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[weekly-plan] Error during planning:", errorMessage);

    // Try to notify user of failure
    try {
      const bot = createTelegramBot();
      await bot.sendMessage(
        `⚠️ Had trouble starting the planning process. ` +
          `You can ask me "plan my week" to try again.`
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
 * Generate the actual plan after receiving user input
 */
export async function generatePlanWithContext(
  week: string,
  userContext: string
): Promise<WeeklyPlanResult> {
  const timezone = process.env.TIMEZONE || "America/New_York";
  console.log(`[weekly-plan] Generating plan for ${week} with user context`);

  try {
    const bot = createTelegramBot();
    const agent = createCoachAgent({ timezone, maxTurns: 20 });
    const storage = createGitHubStorage();

    // Send acknowledgment
    await bot.sendMessage("✨ _Building your plan..._", "MarkdownV2");

    // Load the planning prompt
    const planningPrompt = buildWeeklyPlanningPrompt();

    // Run the planning task with user context
    console.log("[weekly-plan] Starting agent planning task");
    const response = await agent.runTask(
      `Generate the weekly training plan for ${week}.

## User Context for This Week

The user shared the following when asked about their schedule, energy, and focus:

"${userContext}"

Take this into account when building the plan. Adjust intensity, volume, or focus areas based on what they shared.

${planningPrompt}

After generating the plan:
1. Save it to plans/${week}.md
2. Send a summary to the user

The summary should include:
- How you incorporated their input
- The week's theme/focus
- Brief overview of each day
- Any key targets or goals`,
      `Planning for: ${week} with user context`
    );
    console.log("[weekly-plan] Agent completed planning task");

    // Clear pending state
    await storage.clearPlanningState();
    console.log("[weekly-plan] Cleared planning state");

    // Send summary to Telegram
    await bot.sendMessageSafe(response.message);
    console.log("[weekly-plan] Summary sent successfully");

    return {
      success: true,
      week,
      message: `Generated plan for ${week}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[weekly-plan] Error during plan generation:", errorMessage);

    try {
      const bot = createTelegramBot();
      await bot.sendMessage(
        `⚠️ Had trouble generating the plan. You can ask me "plan my week" to try again.`
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
