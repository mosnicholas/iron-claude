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
 * Events come with type in format "resource.action" (e.g., "workout.updated").
 * See: https://developer.whoop.com/docs/developing/webhooks
 */
interface WhoopWebhookPayload {
  /** Event type: "workout.updated", "sleep.updated", "recovery.updated", etc. */
  type: string;
  /** User ID the event belongs to */
  user_id: number;
  /** ID of the resource - number for v1 API, UUID string for v2 API */
  id: number | string;
  /** Unique identifier for the triggering event */
  trace_id?: string;
}

/**
 * Parsed webhook event type and action.
 */
interface ParsedWebhookType {
  resource: "workout" | "sleep" | "recovery";
  action: "updated" | "deleted";
}

/**
 * Valid webhook type patterns.
 */
const VALID_WEBHOOK_TYPES = [
  "workout.updated",
  "workout.deleted",
  "sleep.updated",
  "sleep.deleted",
  "recovery.updated",
  "recovery.deleted",
] as const;

/**
 * Parse webhook type string into resource and action.
 * Returns null if the type is invalid.
 */
function parseWebhookType(type: string): ParsedWebhookType | null {
  if (!VALID_WEBHOOK_TYPES.includes(type as (typeof VALID_WEBHOOK_TYPES)[number])) {
    return null;
  }
  const [resource, action] = type.split(".") as [
    "workout" | "sleep" | "recovery",
    "updated" | "deleted",
  ];
  return { resource, action };
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

  // Validate type is a known webhook event type (e.g., "workout.updated", "sleep.deleted")
  if (!payload.type || typeof payload.type !== "string") {
    console.log("[whoop-webhook] Invalid payload: missing type");
    return false;
  }

  const parsedType = parseWebhookType(payload.type);
  if (!parsedType) {
    console.log(`[whoop-webhook] Invalid payload: unknown type "${payload.type}"`);
    return false;
  }

  // user_id must be a number, id can be number (v1) or string UUID (v2)
  if (typeof payload.user_id !== "number") {
    console.log("[whoop-webhook] Invalid payload: missing or invalid user_id");
    return false;
  }

  if (typeof payload.id !== "number" && typeof payload.id !== "string") {
    console.log("[whoop-webhook] Invalid payload: missing or invalid id");
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

  // Parse the type to extract resource and action
  const parsedType = parseWebhookType(webhookPayload.type);
  if (!parsedType) {
    console.log(`[whoop-webhook] Cannot parse type: ${webhookPayload.type}`);
    return null;
  }

  // Skip delete events - we only care about updates
  if (parsedType.action === "deleted") {
    console.log(
      `[whoop-webhook] Ignoring delete event for ${parsedType.resource} ${webhookPayload.id}`
    );
    return null;
  }

  switch (parsedType.resource) {
    case "sleep": {
      const sleep = await client.getSleepById(webhookPayload.id);
      // Skip unscored or nap records (with logging so we know what's being ignored)
      if (sleep.score_state !== "SCORED") {
        console.log(
          `[whoop-webhook] Ignoring unscored sleep ${webhookPayload.id} (state: ${sleep.score_state})`
        );
        return null;
      }
      if (sleep.nap) {
        console.log(`[whoop-webhook] Ignoring nap ${webhookPayload.id}`);
        return null;
      }
      return {
        type: "sleep",
        data: normalizeSleep(sleep),
      };
    }

    case "recovery": {
      // Per Whoop docs, for recovery events "the ID is the UUID of the sleep
      // that the recovery is associated with."
      // We need to search recent recoveries and match by sleep_id.

      // Search a range around today to handle timezone issues
      const today = new Date();
      const searchStart = new Date(today);
      searchStart.setDate(searchStart.getDate() - 2);
      const searchEnd = new Date(today);
      searchEnd.setDate(searchEnd.getDate() + 1);

      const recoveries = await client.getRecovery(
        searchStart.toISOString().split("T")[0],
        searchEnd.toISOString().split("T")[0]
      );

      // Match by sleep_id (the ID in the webhook is the sleep ID)
      // Handle both numeric and string IDs
      const webhookIdNum =
        typeof webhookPayload.id === "string" ? parseInt(webhookPayload.id, 10) : webhookPayload.id;
      const recovery = recoveries.find(
        (r) => r.sleep_id === webhookIdNum || r.sleep_id.toString() === String(webhookPayload.id)
      );

      if (!recovery) {
        console.log(
          `[whoop-webhook] Recovery for sleep ${webhookPayload.id} not found in API results`
        );
        return null;
      }
      if (recovery.score_state !== "SCORED") {
        console.log(
          `[whoop-webhook] Ignoring unscored recovery ${webhookPayload.id} (state: ${recovery.score_state})`
        );
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
        console.log(
          `[whoop-webhook] Ignoring unscored workout ${webhookPayload.id} (state: ${workout.score_state})`
        );
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
