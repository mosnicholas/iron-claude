/**
 * Cron Job Handler
 *
 * Handles scheduled tasks triggered by Supercronic.
 */

import { timingSafeEqual } from "crypto";
import type { Request, Response } from "express";
import { runDailyReminder } from "../cron/daily-reminder.js";
import { runWeeklyPlan } from "../cron/weekly-plan.js";
import { runCheckReminders } from "../cron/check-reminders.js";
import { runRefreshTokens } from "../cron/refresh-tokens.js";
import { runDailyCompaction } from "../cron/daily-compaction.js";
import { runTrialExpiry } from "../cron/trial-expiry.js";
import { runLogRetention } from "../cron/log-retention.js";

type CronTask =
  | "daily-reminder"
  | "weekly-plan"
  | "check-reminders"
  | "refresh-tokens"
  | "daily-compaction"
  | "trial-expiry"
  | "log-retention";

let warnedAboutMissingSecret = false;

/**
 * Validates the cron secret from the Authorization header.
 *
 * Fails closed in production: when `CRON_SECRET` is unset and `NODE_ENV` is
 * "production", every cron request is rejected. In dev/test we log a single
 * warning and pass through so local iteration isn't blocked.
 */
function validateCronSecret(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    if (process.env.NODE_ENV === "production") return false;
    if (!warnedAboutMissingSecret) {
      console.warn(
        "[cron] CRON_SECRET is not set — allowing unauthenticated cron in non-production."
      );
      warnedAboutMissingSecret = true;
    }
    return true;
  }

  const authHeader = req.headers.authorization ?? "";
  const expected = `Bearer ${cronSecret}`;
  const a = Buffer.from(authHeader, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
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
        "daily-compaction": runDailyCompaction,
        "trial-expiry": runTrialExpiry,
        "log-retention": runLogRetention,
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
