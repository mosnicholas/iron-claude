/**
 * Whoop OAuth 2.0 Helpers
 *
 * Handles OAuth authorization flow and token management for Whoop API.
 * Tokens are stored in the fitness-data GitHub repo for multi-instance coordination.
 * Based on: https://developer.whoop.com/docs/developing/oauth
 */

import crypto from "node:crypto";
import type { TokenSet } from "../types.js";
import { createGitHubStorage } from "../../storage/github.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const WHOOP_AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const TOKENS_PATH = "state/whoop/tokens.json";

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
// Token Storage (GitHub-backed with in-memory cache)
// ─────────────────────────────────────────────────────────────────────────────

interface GitHubTokenData {
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  updatedAt: string;
}

/** In-memory cache to avoid hitting GitHub API on every Whoop call */
let cachedTokens: TokenSet | null = null;

/** Reset the in-memory token cache (for testing only) */
export function _resetTokenCache(): void {
  cachedTokens = null;
}

/**
 * Read tokens from GitHub, returning the content and SHA for optimistic locking.
 */
export async function getTokensFromGitHub(): Promise<{
  tokens: TokenSet;
  sha: string;
} | null> {
  try {
    const storage = createGitHubStorage();
    const result = await storage.readFileWithSha(TOKENS_PATH);
    if (!result) return null;

    const data = JSON.parse(result.content) as GitHubTokenData;
    if (!data.refreshToken || !data.accessToken) return null;

    return {
      tokens: {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: data.expiresAt,
      },
      sha: result.sha,
    };
  } catch (error) {
    console.error("[whoop-oauth] Failed to read tokens from GitHub:", error);
    return null;
  }
}

/**
 * Save tokens to GitHub with optimistic locking.
 * Pass sha from a prior read to prevent overwriting concurrent changes.
 * Throws on SHA mismatch (another instance wrote first).
 */
export async function saveTokensToGitHub(tokens: TokenSet, sha?: string): Promise<void> {
  const storage = createGitHubStorage();
  const data: GitHubTokenData = {
    refreshToken: tokens.refreshToken,
    accessToken: tokens.accessToken,
    expiresAt: tokens.expiresAt,
    updatedAt: new Date().toISOString(),
  };

  await storage.writeFileWithSha(
    TOKENS_PATH,
    JSON.stringify(data, null, 2),
    "Update Whoop tokens",
    sha
  );

  console.log("[whoop-oauth] Tokens persisted to GitHub");
}

/**
 * Persist tokens to GitHub and update in-memory cache.
 */
export async function persistTokens(tokens: TokenSet): Promise<void> {
  // Update in-memory cache immediately
  cachedTokens = tokens;

  try {
    // Read current SHA for optimistic locking
    const storage = createGitHubStorage();
    const existing = await storage.readFileWithSha(TOKENS_PATH);
    await saveTokensToGitHub(tokens, existing?.sha);
  } catch (error) {
    // If SHA mismatch, another instance already wrote newer tokens.
    // Our in-memory cache is still valid for this instance's current request.
    console.warn("[whoop-oauth] Failed to persist tokens to GitHub (possible race):", error);
  }
}

/**
 * Get stored Whoop tokens.
 * Uses in-memory cache if the access token is still valid, otherwise reads from GitHub.
 */
export async function getStoredTokens(): Promise<TokenSet | null> {
  // Use cached tokens if access token is still valid
  if (cachedTokens && !isTokenExpired(cachedTokens)) {
    return cachedTokens;
  }

  // Read fresh tokens from GitHub
  const result = await getTokensFromGitHub();
  if (!result) return null;

  // Update cache
  cachedTokens = result.tokens;
  return result.tokens;
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
