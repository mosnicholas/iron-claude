/**
 * Whoop Integration
 *
 * Implements the DeviceIntegration interface for Whoop.
 * Ties together OAuth, API client, and webhook handling.
 *
 * Each instance is bound to an optional userId. User-agnostic operations
 * (`isConfigured`, `verifyWebhook`, `getAuthUrl`) work without one;
 * data-fetching and token persistence throw if it's missing. The
 * webhook/OAuth/sync handlers construct a per-user instance per request.
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
  private readonly userId: string | null;

  /**
   * `userId` can be omitted for user-agnostic operations: `isConfigured`,
   * `verifyWebhook`, `getAuthUrl`. Anything that hits the Whoop API or persists
   * tokens throws if userId is null.
   */
  constructor(userId: string | null = null) {
    this.userId = userId;
  }

  private requireUserId(method: string): string {
    if (!this.userId) {
      throw new Error(`WhoopIntegration.${method} requires a userId`);
    }
    return this.userId;
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
    await persistTokens(this.requireUserId("handleOAuthCallback"), tokens);
    this.invalidateClient();
    return tokens;
  }

  /**
   * Refresh the access token for this user and persist the new tokens.
   */
  async refreshToken(): Promise<TokenSet> {
    const uid = this.requireUserId("refreshToken");
    const tokens = await getStoredTokens(uid);
    if (!tokens) {
      throw new Error("No tokens to refresh");
    }
    const newTokens = await refreshAccessToken(uid, tokens.refreshToken);

    // Persist the new tokens to the DB
    await persistTokens(uid, newTokens);

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
      const uid = this.requireUserId("getClient");
      this.client = await createWhoopClient(uid);
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
 * Build a Whoop integration. Pass `userId` for any flow that hits the API or
 * persists tokens. Omit it for user-agnostic operations (webhook verification,
 * config check, OAuth URL building).
 */
export function getWhoopIntegration(userId?: string): WhoopIntegration {
  return new WhoopIntegration(userId ?? null);
}
