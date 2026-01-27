/**
 * Whoop Webhook Handlers
 *
 * Parses and normalizes incoming Whoop webhook events.
 * Based on: https://developer.whoop.com/docs/developing/webhooks
 */

import crypto from "node:crypto";
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
 * Compute HMAC-SHA256 signature for webhook verification.
 */
function computeHmacSignature(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Verify a Whoop webhook request.
 *
 * Validates:
 * 1. Payload structure is valid
 * 2. HMAC signature matches (if webhook secret is configured)
 * 3. User ID matches expected user (if configured)
 *
 * SECURITY: If WHOOP_WEBHOOK_SECRET is set, signature verification is REQUIRED.
 * Requests without valid signatures will be rejected.
 */
export function verifyWhoopWebhook(req: Request): boolean {
  const payload = req.body as WhoopWebhookPayload;

  // Basic structure validation
  if (!payload || typeof payload !== "object") {
    console.log("[whoop-webhook] Invalid payload: not an object");
    return false;
  }

  if (!payload.type || !["workout", "sleep", "recovery"].includes(payload.type)) {
    console.log("[whoop-webhook] Invalid payload: unknown type");
    return false;
  }

  if (typeof payload.user_id !== "number" || typeof payload.id !== "number") {
    console.log("[whoop-webhook] Invalid payload: missing user_id or id");
    return false;
  }

  // HMAC signature verification (required if secret is configured)
  const webhookSecret = process.env.WHOOP_WEBHOOK_SECRET;
  if (webhookSecret) {
    const signature = req.headers["x-whoop-signature"] as string | undefined;

    if (!signature) {
      console.log("[whoop-webhook] Missing signature header");
      return false;
    }

    // Get raw body for signature verification
    // Note: Express must be configured with raw body parsing for this route
    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    const expectedSignature = computeHmacSignature(rawBody, webhookSecret);

    if (!secureCompare(signature, expectedSignature)) {
      console.log("[whoop-webhook] Invalid signature");
      return false;
    }
  }

  // Optional: Verify user ID matches expected user
  const expectedUserId = process.env.WHOOP_USER_ID;
  if (expectedUserId) {
    if (payload.user_id !== parseInt(expectedUserId, 10)) {
      console.log("[whoop-webhook] User ID mismatch");
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
      // Use the webhook timestamp to determine the date, with fallback to today
      const webhookDate = webhookPayload.timestamp
        ? new Date(webhookPayload.timestamp).toISOString().split("T")[0]
        : new Date().toISOString().split("T")[0];

      // Search a range around the webhook date to handle timezone issues
      const searchStart = new Date(webhookDate);
      searchStart.setDate(searchStart.getDate() - 1);
      const searchEnd = new Date(webhookDate);
      searchEnd.setDate(searchEnd.getDate() + 1);

      const recoveries = await client.getRecovery(
        searchStart.toISOString().split("T")[0],
        searchEnd.toISOString().split("T")[0]
      );
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
