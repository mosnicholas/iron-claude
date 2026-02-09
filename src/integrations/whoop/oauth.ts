/**
 * Whoop OAuth 2.0 Helpers
 *
 * Handles OAuth authorization flow and token management for Whoop API.
 * Based on: https://developer.whoop.com/docs/developing/oauth
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { TokenSet } from "../types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const WHOOP_AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";

/** Get path to store refreshed tokens (persists across restarts) */
function getTokenStoragePath(): string {
  return process.env.WHOOP_TOKEN_FILE || "/data/whoop-tokens.json";
}

/** Available OAuth scopes for Whoop API */
export const WHOOP_SCOPES = [
  "read:recovery",
  "read:sleep",
  "read:workout",
  "read:profile",
  "read:cycles",
  "read:body_measurement",
] as const;

/** Default scopes we request for the integration */
export const DEFAULT_SCOPES: string[] = [
  "read:recovery",
  "read:sleep",
  "read:workout",
  "read:profile",
  "offline", // Required to get refresh tokens for long-lived access
];

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface WhoopOAuthConfig {
  clientId: string;
  clientSecret: string;
}

/**
 * Get Whoop OAuth configuration from environment variables.
 * Throws if not configured.
 */
export function getWhoopOAuthConfig(): WhoopOAuthConfig {
  const clientId = process.env.WHOOP_CLIENT_ID;
  const clientSecret = process.env.WHOOP_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Whoop OAuth not configured. Set WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET.");
  }

  return { clientId, clientSecret };
}

/**
 * Check if Whoop OAuth is configured (has client credentials).
 */
export function isWhoopOAuthConfigured(): boolean {
  return !!(process.env.WHOOP_CLIENT_ID && process.env.WHOOP_CLIENT_SECRET);
}

// ─────────────────────────────────────────────────────────────────────────────
// Token Storage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Update Fly.io secrets with new tokens.
 * This persists tokens across restarts without needing a mounted volume.
 */
async function updateFlySecrets(tokens: TokenSet): Promise<void> {
  const flyToken = process.env.FLY_API_TOKEN;
  const appName = process.env.FLY_APP_NAME || "workout-coach";

  if (!flyToken) {
    console.log("[whoop-oauth] FLY_API_TOKEN not set, skipping Fly secrets update");
    return;
  }

  try {
    const response = await fetch(`https://api.machines.dev/v1/apps/${appName}/secrets`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${flyToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        WHOOP_ACCESS_TOKEN: tokens.accessToken,
        WHOOP_REFRESH_TOKEN: tokens.refreshToken,
        WHOOP_TOKEN_EXPIRES: String(tokens.expiresAt),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[whoop-oauth] Failed to update Fly secrets: ${response.status} - ${error}`);
      return;
    }

    console.log("[whoop-oauth] Tokens persisted to Fly secrets");
  } catch (error) {
    console.error("[whoop-oauth] Error updating Fly secrets:", error);
  }
}

/**
 * Persist tokens to file storage and Fly secrets.
 * File storage is a local cache, Fly secrets persist across restarts.
 */
export function persistTokens(tokens: TokenSet): void {
  // Try file storage (local cache)
  try {
    const tokenPath = getTokenStoragePath();
    const dir = path.dirname(tokenPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), "utf-8");
    console.log("[whoop-oauth] Tokens persisted to file storage");
  } catch {
    // Non-fatal - Fly secrets are the primary persistence
    console.log("[whoop-oauth] File storage unavailable, using Fly secrets only");
  }

  // Also update Fly secrets (primary persistence)
  updateFlySecrets(tokens).catch((err) => {
    console.error("[whoop-oauth] Failed to update Fly secrets:", err);
  });
}

/**
 * Load tokens from file storage.
 */
function loadPersistedTokens(): TokenSet | null {
  try {
    const tokenPath = getTokenStoragePath();
    if (fs.existsSync(tokenPath)) {
      const content = fs.readFileSync(tokenPath, "utf-8");
      const tokens = JSON.parse(content) as TokenSet;
      if (tokens.accessToken && tokens.refreshToken) {
        return tokens;
      }
    }
  } catch (error) {
    console.error("[whoop-oauth] Failed to load persisted tokens:", error);
  }
  return null;
}

/**
 * Get stored Whoop tokens.
 * Checks file storage first, then falls back to environment variables.
 * Returns null if not configured.
 */
export function getStoredTokens(): TokenSet | null {
  // First, check file storage (for refreshed tokens)
  const persistedTokens = loadPersistedTokens();
  if (persistedTokens) {
    return persistedTokens;
  }

  // Fall back to environment variables (initial setup)
  const accessToken = process.env.WHOOP_ACCESS_TOKEN;
  const refreshToken = process.env.WHOOP_REFRESH_TOKEN;
  const expiresAt = process.env.WHOOP_TOKEN_EXPIRES;

  if (!accessToken || !refreshToken) {
    return null;
  }

  return {
    accessToken,
    refreshToken,
    expiresAt: expiresAt ? parseInt(expiresAt, 10) : 0,
  };
}

/**
 * Clear persisted tokens (for logout/revoke).
 */
export function clearPersistedTokens(): void {
  try {
    const tokenPath = getTokenStoragePath();
    if (fs.existsSync(tokenPath)) {
      fs.unlinkSync(tokenPath);
      console.log("[whoop-oauth] Persisted tokens cleared");
    }
  } catch (error) {
    console.error("[whoop-oauth] Failed to clear persisted tokens:", error);
  }
}

/**
 * Check if the stored access token is expired (or will expire soon).
 * Considers token expired if it expires within 5 minutes.
 */
export function isTokenExpired(tokens: TokenSet): boolean {
  // Treat unset/zero expiration as expired (force refresh to get proper expiry)
  if (!tokens.expiresAt) {
    return true;
  }
  const bufferMs = 5 * 60 * 1000; // 5 minutes
  return Date.now() >= tokens.expiresAt - bufferMs;
}

// ─────────────────────────────────────────────────────────────────────────────
// OAuth Flow
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a random state parameter for CSRF protection.
 * Whoop requires at least 8 characters.
 */
function generateState(): string {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Generate the OAuth authorization URL for user to visit.
 *
 * @param redirectUri - The callback URL after authorization
 * @param scopes - OAuth scopes to request (defaults to DEFAULT_SCOPES)
 * @param state - State parameter for CSRF protection (auto-generated if not provided)
 */
export function getAuthorizationUrl(
  redirectUri: string,
  scopes: string[] = DEFAULT_SCOPES,
  state?: string
): string {
  const config = getWhoopOAuthConfig();

  // Whoop requires state parameter with at least 8 characters
  const stateParam = state || generateState();

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    state: stateParam,
  });

  return `${WHOOP_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange an authorization code for access and refresh tokens.
 *
 * @param code - The authorization code from OAuth callback
 * @param redirectUri - Must match the redirect_uri used in authorization
 */
export async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<TokenSet> {
  const config = getWhoopOAuthConfig();

  // Whoop requires JSON body format for token requests
  // See: https://developer.whoop.com/docs/developing/oauth/
  const response = await fetch(WHOOP_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to exchange code: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

/**
 * Refresh the access token using a refresh token.
 *
 * @param refreshToken - The refresh token to use
 */
export async function refreshAccessToken(refreshToken: string): Promise<TokenSet> {
  const config = getWhoopOAuthConfig();

  const response = await fetch(WHOOP_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: "offline",
    }).toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to refresh token: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

/**
 * Revoke a token (logout).
 *
 * @param token - The access or refresh token to revoke
 */
export async function revokeToken(token: string): Promise<void> {
  const config = getWhoopOAuthConfig();

  // Whoop requires JSON body format for token requests
  const response = await fetch("https://api.prod.whoop.com/oauth/oauth2/revoke", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      token,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to revoke token: ${response.status} - ${error}`);
  }
}
