/**
 * Cron Task Runner
 *
 * Shared boilerplate for all cron jobs: profile check, error handling,
 * result formatting, and user notification on failure.
 */

import { createTelegramBot } from "../bot/telegram.js";
import { createGitHubStorage } from "../storage/github.js";
import type { GitHubStorage } from "../storage/github.js";
import type { TelegramBot } from "../bot/telegram.js";

export interface CronResult {
  success: boolean;
  message?: string;
  error?: string;
}

export interface CronContext {
  bot: TelegramBot;
  storage: GitHubStorage;
}

/**
 * Run a cron task with standard boilerplate:
 * - Initialize bot and storage
 * - Check profile exists (skip if not)
 * - Catch errors and notify user on failure
 */
export async function runCronTask(
  name: string,
  handler: (ctx: CronContext) => Promise<CronResult>,
  options?: { errorMessage?: string; requireProfile?: boolean }
): Promise<CronResult> {
  const { errorMessage, requireProfile = true } = options || {};
  console.log(`[${name}] Starting`);

  try {
    const bot = createTelegramBot();
    const storage = createGitHubStorage();

    if (requireProfile) {
      const profile = await storage.readProfile();
      if (!profile) {
        console.log(`[${name}] No profile found, skipping`);
        return { success: true, message: "No profile configured, skipping" };
      }
    }

    return await handler({ bot, storage });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[${name}] Error:`, msg);

    if (errorMessage) {
      try {
        const bot = createTelegramBot();
        await bot.sendMessage(`⚠️ ${errorMessage}`);
      } catch {
        // Ignore notification failure
      }
    }

    return { success: false, error: msg };
  }
}
