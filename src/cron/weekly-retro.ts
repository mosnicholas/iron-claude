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
import { getCurrentWeek } from "../utils/date.js";

export interface WeeklyRetroResult {
  success: boolean;
  week?: string;
  message?: string;
  error?: string;
}

/**
 * Run the weekly retrospective job
 */
export async function runWeeklyRetro(): Promise<WeeklyRetroResult> {
  const timezone = process.env.TIMEZONE || "America/New_York";

  try {
    const bot = createTelegramBot();
    const agent = createCoachAgent({ timezone, maxTurns: 15 });
    const storage = createGitHubStorage();

    // Check if profile exists
    const profile = await storage.readProfile();
    if (!profile) {
      return {
        success: true,
        message: "No profile configured, skipping retrospective",
      };
    }

    // Get the current week (we're generating retro for)
    const currentWeek = getCurrentWeek(timezone);

    // Check if we have workout data this week
    const workoutFiles = await storage.listWorkouts();
    const thisWeekWorkouts = workoutFiles.filter((f) => f.includes(currentWeek.replace("-W", "-")));

    // Load the retrospective prompt
    const retroPrompt = buildRetrospectivePrompt();

    // Run the retrospective task
    const response = await agent.runTask(
      `Generate the weekly retrospective for ${currentWeek}.

${retroPrompt}

After generating the retrospective:
1. Save it to retrospectives/${currentWeek}.md
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

    // Send summary to Telegram
    await bot.sendMessageSafe(response.message);

    return {
      success: true,
      week: currentWeek,
      message: `Generated retrospective for ${currentWeek}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

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

/**
 * Check if the retrospective already exists for a week
 */
export async function retroExists(week: string): Promise<boolean> {
  const storage = createGitHubStorage();
  const retros = await storage.listRetrospectives();
  return retros.some((r) => r.includes(week));
}
