/**
 * Whoop Webhook Handlers
 *
 * Parses and normalizes incoming Whoop webhook events.
 * Based on: https://developer.whoop.com/docs/developing/webhooks
 */

import type { Request } from "express";
import type { WebhookEvent, SleepData, RecoveryData, WorkoutData } from "../types.js";
import { WhoopClient, getSportName } from "./client.js";
import type { WhoopSleep, WhoopRecovery, WhoopWorkout } from "./client.js";

// ─────────────────────────────────────────────────────────────────────────────
// Webhook Payload Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whoop webhook payload structure.
 * All events come as "type" with associated IDs.
 */
interface WhoopWebhookPayload {
  /** Event type: "workout", "sleep", "recovery" */
  type: "workout" | "sleep" | "recovery";
  /** User ID the event belongs to */
  user_id: number;
  /** ID of the resource (workout_id, sleep_id, or cycle_id for recovery) */
  id: number;
  /** Timestamp of the event */
  timestamp: string;
  /** Action performed: "create", "update", "delete" */
  action?: "create" | "update" | "delete";
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook Verification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verify a Whoop webhook request.
 *
 * Whoop doesn't use HMAC signatures by default, but you can configure
 * a secret in the webhook settings. For now, we just verify the payload
 * structure is valid.
 *
 * In production, you might want to:
 * 1. Verify the source IP is from Whoop
 * 2. Use a webhook secret header
 * 3. Verify the user_id matches your configured user
 */
export function verifyWhoopWebhook(req: Request): boolean {
  const payload = req.body as WhoopWebhookPayload;

  // Basic structure validation
  if (!payload || typeof payload !== "object") {
    return false;
  }

  if (!payload.type || !["workout", "sleep", "recovery"].includes(payload.type)) {
    return false;
  }

  if (typeof payload.user_id !== "number" || typeof payload.id !== "number") {
    return false;
  }

  // Optional: Verify webhook secret if configured
  const webhookSecret = process.env.WHOOP_WEBHOOK_SECRET;
  if (webhookSecret) {
    const headerSecret = req.headers["x-whoop-signature"] as string;
    if (headerSecret !== webhookSecret) {
      return false;
    }
  }

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Data Normalization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert Whoop sleep data to normalized format.
 */
export function normalizeSleep(whoopSleep: WhoopSleep): SleepData {
  const startDate = new Date(whoopSleep.start);
  const endDate = new Date(whoopSleep.end);
  const durationMs = endDate.getTime() - startDate.getTime();

  return {
    source: "whoop",
    date: whoopSleep.start.split("T")[0],
    startTime: whoopSleep.start,
    endTime: whoopSleep.end,
    durationMinutes: Math.round(durationMs / 60000),
    stages: whoopSleep.score
      ? {
          rem: Math.round(whoopSleep.score.stage_summary.total_rem_sleep_time_milli / 60000),
          deep: Math.round(whoopSleep.score.stage_summary.total_slow_wave_sleep_time_milli / 60000),
          light: Math.round(whoopSleep.score.stage_summary.total_light_sleep_time_milli / 60000),
          awake: Math.round(whoopSleep.score.stage_summary.total_awake_time_milli / 60000),
        }
      : undefined,
    score: whoopSleep.score?.sleep_performance_percentage,
    raw: whoopSleep,
  };
}

/**
 * Convert Whoop recovery data to normalized format.
 */
export function normalizeRecovery(whoopRecovery: WhoopRecovery): RecoveryData {
  // Recovery is tied to sleep, so we use the sleep's date via created_at
  const date = whoopRecovery.created_at.split("T")[0];

  return {
    source: "whoop",
    date,
    score: whoopRecovery.score?.recovery_score ?? 0,
    hrv: whoopRecovery.score?.hrv_rmssd_milli,
    restingHeartRate: whoopRecovery.score?.resting_heart_rate,
    spo2: whoopRecovery.score?.spo2_percentage,
    skinTempDeviation: whoopRecovery.score?.skin_temp_celsius,
    raw: whoopRecovery,
  };
}

/**
 * Convert Whoop workout data to normalized format.
 */
export function normalizeWorkout(whoopWorkout: WhoopWorkout): WorkoutData {
  const startDate = new Date(whoopWorkout.start);
  const endDate = new Date(whoopWorkout.end);
  const durationMs = endDate.getTime() - startDate.getTime();

  return {
    source: "whoop",
    date: whoopWorkout.start.split("T")[0],
    type: getSportName(whoopWorkout.sport_id),
    durationMinutes: Math.round(durationMs / 60000),
    strain: whoopWorkout.score?.strain,
    calories: whoopWorkout.score ? Math.round(whoopWorkout.score.kilojoule / 4.184) : undefined,
    heartRateAvg: whoopWorkout.score?.average_heart_rate,
    heartRateMax: whoopWorkout.score?.max_heart_rate,
    raw: whoopWorkout,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook Parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a Whoop webhook payload and fetch the full data.
 *
 * Whoop webhooks only contain IDs, so we need to fetch the full data
 * from the API to get sleep stages, scores, etc.
 *
 * @param payload - The webhook payload
 * @param client - Whoop API client for fetching full data
 */
export async function parseWhoopWebhook(
  payload: unknown,
  client: WhoopClient
): Promise<WebhookEvent | null> {
  const webhookPayload = payload as WhoopWebhookPayload;

  // Skip delete events - we only care about create/update
  if (webhookPayload.action === "delete") {
    return null;
  }

  switch (webhookPayload.type) {
    case "sleep": {
      const sleep = await client.getSleepById(webhookPayload.id);
      // Skip unscored or nap records
      if (sleep.score_state !== "SCORED" || sleep.nap) {
        return null;
      }
      return {
        type: "sleep",
        data: normalizeSleep(sleep),
      };
    }

    case "recovery": {
      // Recovery ID is actually the cycle_id, we need to find it via date range
      const today = new Date().toISOString().split("T")[0];
      const recoveries = await client.getRecovery(today, today);
      const recovery = recoveries.find((r) => r.cycle_id === webhookPayload.id);

      if (!recovery || recovery.score_state !== "SCORED") {
        return null;
      }
      return {
        type: "recovery",
        data: normalizeRecovery(recovery),
      };
    }

    case "workout": {
      const workout = await client.getWorkoutById(webhookPayload.id);
      if (workout.score_state !== "SCORED") {
        return null;
      }
      return {
        type: "workout",
        data: normalizeWorkout(workout),
      };
    }

    default:
      return null;
  }
}

/**
 * Parse a Whoop webhook without fetching additional data.
 * Returns a minimal event that can be used to trigger a full sync.
 */
export function parseWhoopWebhookMinimal(payload: unknown): {
  type: "sleep" | "recovery" | "workout";
  id: number;
  userId: number;
} | null {
  const webhookPayload = payload as WhoopWebhookPayload;

  if (!webhookPayload.type || !webhookPayload.id || !webhookPayload.user_id) {
    return null;
  }

  // Skip delete events
  if (webhookPayload.action === "delete") {
    return null;
  }

  return {
    type: webhookPayload.type,
    id: webhookPayload.id,
    userId: webhookPayload.user_id,
  };
}
