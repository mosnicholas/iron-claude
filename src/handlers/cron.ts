/**
 * Cron Job Handler
 *
 * Handles scheduled tasks triggered by Supercronic.
 */

import type { Request, Response } from "express";
import { runDailyReminder } from "../cron/daily-reminder.js";
import { runWeeklyPlan } from "../cron/weekly-plan.js";
import { runWeeklyRetro } from "../cron/weekly-retro.js";

type CronTask = "daily-reminder" | "weekly-plan" | "weekly-retro";

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
      let result;

      switch (task) {
        case "daily-reminder":
          result = await runDailyReminder();
          break;
        case "weekly-plan":
          result = await runWeeklyPlan();
          break;
        case "weekly-retro":
          result = await runWeeklyRetro();
          break;
        default:
          res.status(400).json({ error: `Unknown task: ${task}` });
          return;
      }

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
