/**
 * Whoop Integration
 *
 * Implements the DeviceIntegration interface for Whoop.
 * Ties together OAuth, API client, and webhook handling.
 *
 * Each instance is bound to a single userId; multi-tenant entry points
 * (webhook handler, OAuth callback) construct one per request. The factory
 * below falls back to `DEFAULT_USER_ID` for callers that haven't been
 * plumbed through the multi-user migration yet.
 */

import type { Request } from "express";
import type {
  DeviceIntegration,
  TokenSet,
  SleepData,
  RecoveryData,
  WorkoutData,
  WebhookEvent,
} from "../types.js";
import {
  getStoredTokens,
  isWhoopOAuthConfigured,
  getAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  persistTokens,
  DEFAULT_SCOPES,
} from "./oauth.js";
import { WhoopClient, createWhoopClient } from "./client.js";
import {
  verifyWhoopWebhook,
  parseWhoopWebhook,
  normalizeSleep,
  normalizeRecovery,
  normalizeWorkout,
} from "./webhooks.js";

// ─────────────────────────────────────────────────────────────────────────────
// Whoop Integration Class
// ─────────────────────────────────────────────────────────────────────────────

export class WhoopIntegration implements DeviceIntegration {
  readonly name = "Whoop";
  readonly slug = "whoop";

  private client: WhoopClient | null = null;
  private readonly userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Configuration
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Check if Whoop OAuth credentials are configured.
   * Token existence is validated lazily when the client is created.
   */
  isConfigured(): boolean {
    return isWhoopOAuthConfigured();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // OAuth
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get the OAuth authorization URL.
   */
  getAuthUrl(redirectUri: string): string {
    return getAuthorizationUrl(redirectUri, DEFAULT_SCOPES);
  }

  /**
   * Exchange an authorization code for tokens and persist them for this user.
   */
  async handleOAuthCallback(code: string, redirectUri: string): Promise<TokenSet> {
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    await persistTokens(this.userId, tokens);
    this.invalidateClient();
    return tokens;
  }

  /**
   * Refresh the access token for this user and persist the new tokens.
   */
  async refreshToken(): Promise<TokenSet> {
    const tokens = await getStoredTokens(this.userId);
    if (!tokens) {
      throw new Error("No tokens to refresh");
    }
    const newTokens = await refreshAccessToken(this.userId, tokens.refreshToken);

    // Persist the new tokens to the DB
    await persistTokens(this.userId, newTokens);

    // Invalidate cached client so it uses new tokens
    this.invalidateClient();

    return newTokens;
  }

  /**
   * Invalidate the cached client.
   * Call this after token refresh to ensure new tokens are used.
   */
  invalidateClient(): void {
    this.client = null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Data Fetching
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get or create the API client.
   * Creates a new client if none exists or if tokens have been refreshed.
   */
  private async getClient(): Promise<WhoopClient> {
    if (!this.client) {
      this.client = await createWhoopClient(this.userId);
      if (!this.client) {
        throw new Error("Failed to create Whoop client");
      }
    }
    return this.client;
  }

  /**
   * Fetch sleep data for a specific date.
   */
  async fetchSleep(date: string): Promise<SleepData | null> {
    const client = await this.getClient();
    const sleeps = await client.getSleep(date, date);

    // Get the main sleep (not naps)
    const mainSleep = sleeps.find((s) => !s.nap && s.score_state === "SCORED");
    if (!mainSleep) {
      return null;
    }

    return normalizeSleep(mainSleep);
  }

  /**
   * Fetch recovery data for a specific date.
   */
  async fetchRecovery(date: string): Promise<RecoveryData | null> {
    const client = await this.getClient();
    const recoveries = await client.getRecovery(date, date);

    const scoredRecovery = recoveries.find((r) => r.score_state === "SCORED");
    if (!scoredRecovery) {
      return null;
    }

    return normalizeRecovery(scoredRecovery);
  }

  /**
   * Fetch all workouts for a specific date.
   */
  async fetchWorkouts(date: string): Promise<WorkoutData[]> {
    const client = await this.getClient();
    const workouts = await client.getWorkouts(date, date);

    return workouts.filter((w) => w.score_state === "SCORED").map((w) => normalizeWorkout(w));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Webhooks
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Verify a webhook request.
   */
  verifyWebhook(req: Request): boolean {
    return verifyWhoopWebhook(req);
  }

  /**
   * Parse a webhook payload.
   * Note: This fetches full data from the API since webhooks only contain IDs.
   */
  async parseWebhook(payload: unknown): Promise<WebhookEvent | null> {
    const client = await this.getClient();
    return parseWhoopWebhook(payload, client);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get a Whoop integration instance for the given user.
 *
 * TODO(multi-user): callers that don't yet know the userId (e.g.
 * `registerIntegration` at boot, the cron token refresh job) fall back to
 * `DEFAULT_USER_ID` from env. The next migration phase wires real userId
 * resolution into those entry points (auth + webhook adapters).
 */
export function getWhoopIntegration(userId?: string): WhoopIntegration {
  const effectiveUserId = userId ?? process.env.DEFAULT_USER_ID;
  if (!effectiveUserId) {
    throw new Error(
      "getWhoopIntegration: userId not provided and DEFAULT_USER_ID env var is not set. " +
        "Set DEFAULT_USER_ID until the multi-user auth migration is complete."
    );
  }
  return new WhoopIntegration(effectiveUserId);
}
