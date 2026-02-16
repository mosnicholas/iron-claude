/**
 * Cron Job Handler
 *
 * Handles scheduled tasks triggered by Supercronic.
 */

import type { Request, Response } from "express";
import { runDailyReminder } from "../cron/daily-reminder.js";
import { runWeeklyPlan } from "../cron/weekly-plan.js";
import { runCheckReminders } from "../cron/check-reminders.js";
import { runRefreshTokens } from "../cron/refresh-tokens.js";

type CronTask = "daily-reminder" | "weekly-plan" | "check-reminders" | "refresh-tokens";

/**
 * Validates the cron secret from the Authorization header.
 * Returns true if no secret is configured (allows unauthenticated in dev).
 */
function validateCronSecret(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true;

  const authHeader = req.headers.authorization;
  return authHeader === `Bearer ${cronSecret}`;
}

/**
 * Creates an Express handler for the specified cron task.
 */
export function createCronHandler(task: CronTask) {
  return async (req: Request, res: Response): Promise<void> => {
    console.log(`[cron] Running task: ${task}`);

    // Validate secret/auth
    if (!validateCronSecret(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const runners: Record<
        CronTask,
        () => Promise<{ success: boolean; message?: string; error?: string }>
      > = {
        "daily-reminder": runDailyReminder,
        "weekly-plan": runWeeklyPlan,
        "check-reminders": runCheckReminders,
        "refresh-tokens": runRefreshTokens,
      };

      const result = await runners[task]();

      if (result.success) {
        console.log(`[cron] Task ${task} completed successfully: ${result.message}`);
        res.status(200).json({ ok: true, message: result.message });
      } else {
        console.error(`[cron] Task ${task} failed:`, result.error);
        res.status(500).json({ ok: false, error: result.error });
      }
    } catch (error) {
      console.error(`[cron] Task ${task} error:`, error);
      res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };
}
