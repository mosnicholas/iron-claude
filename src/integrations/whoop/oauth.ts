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

/** Default scopes we request for the integration.
 *  Must match scopes registered on the Whoop developer dashboard — requesting
 *  any scope the app isn't registered for fails with `request_forbidden`. */
export const DEFAULT_SCOPES: string[] = [
  "read:recovery",
  "read:sleep",
  "read:workout",
  "read:profile",
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

/**
 * In-flight refresh dedupe. Whoop rotates refresh tokens — once a refresh
 * lands, the prior token is invalid. Two concurrent webhooks each calling
 * refreshAccessToken with the same stored token would have one succeed and
 * the other fail with 400 ("invalid_request"). Sharing the in-flight promise
 * means the second caller awaits the first and gets the rotated tokens.
 *
 * Keyed by the refresh token being used so an older token's refresh doesn't
 * block a fresh one (e.g. if cache was bypassed).
 */
const refreshInFlight = new Map<string, Promise<TokenSet>>();

/** Reset the in-memory token cache (for testing only) */
export function _resetTokenCache(): void {
  cachedTokens = null;
  refreshInFlight.clear();
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
 * SHA conflicts (409/422 from GitHub) are expected when two instances race to
 * persist refreshed tokens — the loser's in-memory cache is still valid and
 * the winner's tokens are now on disk. Any other error is a real failure.
 */
function isShaConflictError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes("409") || error.message.includes("422");
}

/**
 * Persist tokens to GitHub and update in-memory cache.
 * Throws on real failures (auth, network, 5xx). Swallows SHA conflicts.
 */
export async function persistTokens(tokens: TokenSet): Promise<void> {
  // Update in-memory cache immediately so the current request can proceed
  // even if a concurrent peer wins the GitHub write race.
  cachedTokens = tokens;

  try {
    const storage = createGitHubStorage();
    const existing = await storage.readFileWithSha(TOKENS_PATH);
    await saveTokensToGitHub(tokens, existing?.sha);
  } catch (error) {
    if (isShaConflictError(error)) {
      console.warn(
        "[whoop-oauth] Token persist raced with another instance; in-memory cache is authoritative"
      );
      return;
    }
    console.error("[whoop-oauth] Failed to persist tokens to GitHub:", error);
    throw error;
  }
}

/**
 * Diagnostic snapshot of the stored tokens file, surfacing missing fields
 * that `getStoredTokens` would otherwise hide by returning null.
 */
export interface StoredTokensInspection {
  fileExists: boolean;
  parseable: boolean;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  expiresAt?: number;
  updatedAt?: string;
}

export async function inspectStoredTokens(): Promise<StoredTokensInspection> {
  const storage = createGitHubStorage();
  const result = await storage.readFileWithSha(TOKENS_PATH);
  if (!result) {
    return { fileExists: false, parseable: false, hasAccessToken: false, hasRefreshToken: false };
  }

  let data: Partial<GitHubTokenData>;
  try {
    data = JSON.parse(result.content) as Partial<GitHubTokenData>;
  } catch {
    return { fileExists: true, parseable: false, hasAccessToken: false, hasRefreshToken: false };
  }

  return {
    fileExists: true,
    parseable: true,
    hasAccessToken: typeof data.accessToken === "string" && data.accessToken.length > 0,
    hasRefreshToken: typeof data.refreshToken === "string" && data.refreshToken.length > 0,
    expiresAt: typeof data.expiresAt === "number" ? data.expiresAt : undefined,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : undefined,
  };
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

  // Whoop token endpoint requires form-encoded body (RFC 6749 §4.1.3)
  const response = await fetch(WHOOP_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }).toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to exchange code: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as Partial<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
  }>;

  return parseTokenResponse(data, "authorization_code");
}

/**
 * Parse and validate a Whoop OAuth token response.
 * Fails loudly if any required field is missing — silently writing a
 * tokens.json without a refresh_token (Whoop omits it when the request
 * lacks the `offline` scope) makes the integration unrecoverable on the
 * next access-token expiry, so callers must see this immediately.
 */
function parseTokenResponse(
  data: Partial<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
  }>,
  grantType: "authorization_code" | "refresh_token"
): TokenSet {
  const missing: string[] = [];
  if (!data.access_token) missing.push("access_token");
  if (!data.refresh_token) missing.push("refresh_token");
  if (typeof data.expires_in !== "number") missing.push("expires_in");

  if (missing.length > 0) {
    const hint = missing.includes("refresh_token")
      ? " Whoop typically only returns refresh_token when the auth request includes the `offline` scope and your developer app is registered for it."
      : "";
    throw new Error(
      `Whoop ${grantType} response missing required fields: ${missing.join(", ")}.${hint}`
    );
  }

  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string,
    expiresAt: Date.now() + (data.expires_in as number) * 1000,
  };
}

/**
 * Refresh the access token using a refresh token.
 * Concurrent callers with the same refresh token share one in-flight request
 * (Whoop rotates refresh tokens; without dedupe the second call 400s).
 *
 * @param refreshToken - The refresh token to use
 */
export async function refreshAccessToken(refreshToken: string): Promise<TokenSet> {
  const existing = refreshInFlight.get(refreshToken);
  if (existing) return existing;

  const promise = doRefreshAccessToken(refreshToken).finally(() => {
    refreshInFlight.delete(refreshToken);
  });
  refreshInFlight.set(refreshToken, promise);
  return promise;
}

async function doRefreshAccessToken(refreshToken: string): Promise<TokenSet> {
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
    }).toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to refresh token: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as Partial<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
  }>;

  return parseTokenResponse(data, "refresh_token");
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
