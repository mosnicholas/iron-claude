/**
 * Weekly Retrospective Cron Job
 *
 * Generates the weekly retrospective analysis.
 * Schedule: Saturday at 6:00pm (user's timezone)
 */

import { createCoachAgent } from "../coach/index.js";
import { createTelegramBot } from "../bot/telegram.js";
import { createGitHubStorage } from "../storage/github.js";
import { buildRetrospectivePrompt } from "../coach/prompts.js";
import { getCurrentWeek, getTimezone } from "../utils/date.js";

export interface WeeklyRetroResult {
  success: boolean;
  week?: string;
  message?: string;
  error?: string;
}

/**
 * Run the weekly retrospective job.
 *
 * Note: The retrospective is now primarily generated as part of the weekly
 * planning flow (when generating next week's plan). This cron job serves as
 * a fallback in case the retro wasn't generated during planning.
 */
export async function runWeeklyRetro(): Promise<WeeklyRetroResult> {
  const timezone = getTimezone();
  console.log("[weekly-retro] Starting weekly retrospective job (fallback)");

  try {
    console.log("[weekly-retro] Initializing bot, agent, and storage");
    const bot = createTelegramBot();
    const agent = createCoachAgent({ timezone, maxTurns: 15 });
    const storage = createGitHubStorage();

    // Check if profile exists
    console.log("[weekly-retro] Checking for profile");
    const profile = await storage.readProfile();
    if (!profile) {
      console.log("[weekly-retro] No profile found, skipping");
      return {
        success: true,
        message: "No profile configured, skipping retrospective",
      };
    }
    console.log("[weekly-retro] Profile found");

    // Get the current week (we're generating retro for)
    const currentWeek = getCurrentWeek(timezone);
    console.log(`[weekly-retro] Checking retro for week: ${currentWeek}`);

    // Check if retro already exists (may have been generated during planning)
    const existingRetro = await storage.readWeeklyRetro(currentWeek);
    if (existingRetro) {
      console.log(`[weekly-retro] Retro already exists for ${currentWeek}, skipping`);
      return {
        success: true,
        week: currentWeek,
        message: `Retro already exists for ${currentWeek} (generated during planning)`,
      };
    }

    console.log(`[weekly-retro] Generating retro for week: ${currentWeek}`);

    // Check if we have workout data this week
    console.log("[weekly-retro] Listing workout files");
    const thisWeekWorkouts = await storage.listWeekWorkouts(currentWeek);
    console.log(`[weekly-retro] Found ${thisWeekWorkouts.length} workouts this week`);

    // Load the retrospective prompt
    console.log("[weekly-retro] Building retrospective prompt");
    const retroPrompt = buildRetrospectivePrompt();

    // Run the retrospective task
    console.log("[weekly-retro] Starting agent task (this may take a while)");
    const response = await agent.runTask(
      `Generate the weekly retrospective for ${currentWeek}.

${retroPrompt}

After generating the retrospective:
1. Save it to weeks/${currentWeek}/retro.md
2. Update learnings.md if you discovered new patterns
3. Send a summary to the user

The summary should include:
- Adherence rate
- PRs hit (if any)
- Key wins
- Areas to watch
- Brief note about tomorrow's planning`,
      `Week: ${currentWeek}
Workout files found: ${thisWeekWorkouts.length}`
    );
    console.log("[weekly-retro] Agent completed task");

    // Send summary to Telegram
    console.log("[weekly-retro] Sending summary to Telegram");
    await bot.sendMessageSafe(response.message);
    console.log("[weekly-retro] Summary sent successfully");

    return {
      success: true,
      week: currentWeek,
      message: `Generated retrospective for ${currentWeek}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[weekly-retro] Error:", errorMessage);

    // Try to notify user of failure
    try {
      const bot = createTelegramBot();
      await bot.sendMessage(
        `⚠️ Had trouble generating this week's retrospective. ` +
          `I'll try again, or you can ask me to analyze the week manually.`
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
