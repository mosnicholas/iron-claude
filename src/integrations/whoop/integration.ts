/**
 * Whoop Integration
 *
 * Implements the DeviceIntegration interface for Whoop.
 * Ties together OAuth, API client, and webhook handling.
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
   * Exchange an authorization code for tokens.
   */
  async handleOAuthCallback(code: string, redirectUri: string): Promise<TokenSet> {
    return exchangeCodeForTokens(code, redirectUri);
  }

  /**
   * Refresh the access token and persist the new tokens.
   */
  async refreshToken(): Promise<TokenSet> {
    const tokens = await getStoredTokens();
    if (!tokens) {
      throw new Error("No tokens to refresh");
    }
    const newTokens = await refreshAccessToken(tokens.refreshToken);

    // Persist the new tokens to GitHub
    await persistTokens(newTokens);

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
      this.client = await createWhoopClient();
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
// Singleton Instance
// ─────────────────────────────────────────────────────────────────────────────

let instance: WhoopIntegration | null = null;

/**
 * Get the Whoop integration instance.
 */
export function getWhoopIntegration(): WhoopIntegration {
  if (!instance) {
    instance = new WhoopIntegration();
  }
  return instance;
}
