/**
 * Shared Types for Fitness Device Integrations
 *
 * Common interfaces that any device (Whoop, Garmin, Oura, etc.) can implement.
 * This allows the coach agent to work with normalized data regardless of source.
 */

import type { Request } from "express";

// ─────────────────────────────────────────────────────────────────────────────
// Normalized Data Models
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sleep data normalized across all devices
 */
export interface SleepData {
  /** Integration source: "whoop" | "garmin" | "oura" */
  source: string;
  /** ISO date (YYYY-MM-DD) */
  date: string;
  /** ISO datetime when sleep started */
  startTime: string;
  /** ISO datetime when sleep ended */
  endTime: string;
  /** Total sleep duration in minutes */
  durationMinutes: number;
  /** Sleep stage breakdown in minutes (if available) */
  stages?: {
    rem: number;
    deep: number;
    light: number;
    awake: number;
  };
  /** Sleep quality score 0-100 (if device provides it) */
  score?: number;
  /** Original payload for debugging */
  raw: unknown;
}

/**
 * Recovery/readiness data normalized across all devices
 */
export interface RecoveryData {
  /** Integration source */
  source: string;
  /** ISO date (YYYY-MM-DD) */
  date: string;
  /** Recovery score 0-100 */
  score: number;
  /** Heart rate variability in ms (if available) */
  hrv?: number;
  /** Resting heart rate in bpm (if available) */
  restingHeartRate?: number;
  /** Blood oxygen percentage (if available) */
  spo2?: number;
  /** Skin temperature deviation in Celsius (if available) */
  skinTempDeviation?: number;
  /** Original payload for debugging */
  raw: unknown;
}

/**
 * Workout data normalized across all devices
 */
export interface WorkoutData {
  /** Integration source */
  source: string;
  /** ISO date (YYYY-MM-DD) */
  date: string;
  /** Workout type (strength, running, cycling, etc.) */
  type: string;
  /** Duration in minutes */
  durationMinutes: number;
  /** Strain score 0-21 (Whoop-specific, but normalized) */
  strain?: number;
  /** Calories burned (if available) */
  calories?: number;
  /** Average heart rate in bpm (if available) */
  heartRateAvg?: number;
  /** Max heart rate in bpm (if available) */
  heartRateMax?: number;
  /** Original payload for debugging */
  raw: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Token Management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * OAuth token set for device integrations
 */
export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  /** Unix timestamp (ms) when the access token expires */
  expiresAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook Events
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalized webhook event from any integration
 */
export type WebhookEvent =
  | { type: "sleep"; data: SleepData }
  | { type: "recovery"; data: RecoveryData }
  | { type: "workout"; data: WorkoutData };

// ─────────────────────────────────────────────────────────────────────────────
// Integration Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Interface that each device integration must implement.
 * This ensures consistent behavior across Whoop, Garmin, Oura, etc.
 */
export interface DeviceIntegration {
  /** Display name (e.g., "Whoop") */
  name: string;
  /** URL-safe identifier (e.g., "whoop") */
  slug: string;

  // ─────────────────────────────────────────────────────────────────────────
  // Configuration
  // ─────────────────────────────────────────────────────────────────────────

  /** Check if this integration is configured (has valid tokens) */
  isConfigured(): boolean;

  // ─────────────────────────────────────────────────────────────────────────
  // OAuth
  // ─────────────────────────────────────────────────────────────────────────

  /** Get the OAuth authorization URL for user to visit */
  getAuthUrl(redirectUri: string): string;

  /** Exchange authorization code for tokens */
  handleOAuthCallback(code: string, redirectUri: string): Promise<TokenSet>;

  /** Refresh the access token using refresh token */
  refreshToken(): Promise<TokenSet>;

  // ─────────────────────────────────────────────────────────────────────────
  // Data Fetching (for backfill or manual sync)
  // ─────────────────────────────────────────────────────────────────────────

  /** Fetch sleep data for a specific date */
  fetchSleep(date: string): Promise<SleepData | null>;

  /** Fetch recovery data for a specific date */
  fetchRecovery(date: string): Promise<RecoveryData | null>;

  /** Fetch all workouts for a specific date */
  fetchWorkouts(date: string): Promise<WorkoutData[]>;

  // ─────────────────────────────────────────────────────────────────────────
  // Webhooks
  // ─────────────────────────────────────────────────────────────────────────

  /** Verify webhook signature/authenticity */
  verifyWebhook(req: Request): boolean;

  /** Parse webhook payload into normalized event */
  parseWebhook(payload: unknown): Promise<WebhookEvent | null> | WebhookEvent | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Integration Metadata
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Metadata about an integration for setup UI
 */
export interface IntegrationMetadata {
  name: string;
  slug: string;
  description: string;
  /** Whether this integration is ready for use (not "coming soon") */
  available: boolean;
  /** Required OAuth scopes */
  scopes: string[];
  /** URL to developer documentation */
  docsUrl: string;
}
