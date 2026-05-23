/**
 * Whoop OAuth 2.0 Helpers
 *
 * Handles OAuth authorization flow and token management for Whoop API.
 * Tokens are stored in Postgres (integration_tokens table) with the
 * access/refresh tokens encrypted at rest via AES-256-GCM.
 *
 * Based on: https://developer.whoop.com/docs/developing/oauth
 */

import crypto from "node:crypto";
import type { TokenSet } from "../types.js";
import { getStorage } from "../../storage/db.js";
import { decryptSecret, encryptSecret } from "../../crypto/secrets.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const WHOOP_AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const PROVIDER = "whoop";

/** Default scopes we request for the integration.
 *  `offline` is required to receive a refresh_token — per Whoop's OAuth docs:
 *  "WHOOP provides your app with a refresh token after completing the OAuth
 *  2.0 flow _if_ the `offline` scope is included in the authorization request."
 *  Without it, the token response only contains an access_token (which expires
 *  in ~1h) and the integration silently can't refresh. */
export const DEFAULT_SCOPES: string[] = [
  "read:recovery",
  "read:sleep",
  "read:workout",
  "read:profile",
  "offline",
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
function getWhoopOAuthConfig(): WhoopOAuthConfig {
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
// Token Storage (DB-backed, encrypted at rest)
// ─────────────────────────────────────────────────────────────────────────────

/** Per-user in-memory cache to avoid hitting Postgres on every Whoop call */
const cachedTokens = new Map<string, TokenSet>();

/**
 * In-flight refresh dedupe. Whoop rotates refresh tokens — once a refresh
 * lands, the prior token is invalid. Two concurrent webhooks each calling
 * refreshAccessToken with the same stored token would have one succeed and
 * the other fail with 400 ("invalid_request"). Sharing the in-flight promise
 * means the second caller awaits the first and gets the rotated tokens.
 *
 * Keyed by `userId:refreshToken` so an older token's refresh doesn't block a
 * fresh one across users.
 */
const refreshInFlight = new Map<string, Promise<TokenSet>>();

/**
 * Read tokens from the DB for a given user, decrypting the at-rest ciphertext.
 * The legacy GitHub-backed implementation returned a `sha` for optimistic
 * locking; Postgres handles upsert concurrency so callers no longer need it.
 */
export async function getTokensFromDb(
  userId: string
): Promise<{ tokens: TokenSet; sha: undefined } | null> {
  try {
    const row = await getStorage().getIntegrationToken(userId, PROVIDER);
    if (!row || !row.accessTokenEnc || !row.refreshTokenEnc) return null;

    const accessToken = decryptSecret(row.accessTokenEnc);
    const refreshToken = decryptSecret(row.refreshTokenEnc);
    const expiresAt = row.expiresAt ? row.expiresAt.getTime() : 0;

    return {
      tokens: { accessToken, refreshToken, expiresAt },
      sha: undefined,
    };
  } catch (error) {
    console.error("[whoop-oauth] Failed to read tokens from DB:", error);
    return null;
  }
}

/**
 * Save tokens to Postgres for a given user, encrypting the access/refresh
 * tokens at rest. Drizzle's `onConflictDoUpdate` makes this an atomic upsert,
 * which replaces the SHA-based optimistic locking the GitHub implementation
 * needed.
 */
async function saveTokensToDb(
  userId: string,
  tokens: TokenSet,
  externalUserId?: string | null
): Promise<void> {
  // If the caller didn't provide an externalUserId (e.g. mid-refresh), keep
  // whatever the existing row has rather than wiping it back to null. The
  // Whoop webhook lookup depends on this column being populated.
  let preserved: string | null = null;
  if (externalUserId === undefined) {
    const existing = await getStorage().getIntegrationToken(userId, PROVIDER);
    preserved = existing?.externalUserId ?? null;
  }

  await getStorage().upsertIntegrationToken(userId, PROVIDER, {
    accessTokenEnc: encryptSecret(tokens.accessToken),
    refreshTokenEnc: encryptSecret(tokens.refreshToken),
    expiresAt: tokens.expiresAt ? new Date(tokens.expiresAt) : null,
    externalUserId: externalUserId === undefined ? preserved : externalUserId,
    scopes: null,
  });

  console.log("[whoop-oauth] Tokens persisted to DB");
}

/**
 * Persist tokens to Postgres and update in-memory cache.
 * Throws on real failures (DB connection, encryption errors).
 */
export async function persistTokens(
  userId: string,
  tokens: TokenSet,
  externalUserId?: string | null
): Promise<void> {
  // Update in-memory cache immediately so the current request can proceed.
  cachedTokens.set(userId, tokens);

  try {
    await saveTokensToDb(userId, tokens, externalUserId);
  } catch (error) {
    console.error("[whoop-oauth] Failed to persist tokens to DB:", error);
    throw error;
  }
}

/**
 * Diagnostic snapshot of the stored tokens, surfacing missing fields that
 * `getStoredTokens` would otherwise hide by returning null.
 */
export interface StoredTokensInspection {
  fileExists: boolean;
  parseable: boolean;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  expiresAt?: number;
  updatedAt?: string;
}

export async function inspectStoredTokens(userId: string): Promise<StoredTokensInspection> {
  const row = await getStorage().getIntegrationToken(userId, PROVIDER);
  if (!row) {
    return { fileExists: false, parseable: false, hasAccessToken: false, hasRefreshToken: false };
  }

  return {
    fileExists: true,
    parseable: true,
    hasAccessToken: typeof row.accessTokenEnc === "string" && row.accessTokenEnc.length > 0,
    hasRefreshToken: typeof row.refreshTokenEnc === "string" && row.refreshTokenEnc.length > 0,
    expiresAt: row.expiresAt ? row.expiresAt.getTime() : undefined,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : undefined,
  };
}

/**
 * Get stored Whoop tokens for a user.
 * Uses in-memory cache if the access token is still valid, otherwise reads
 * from the DB.
 */
export async function getStoredTokens(userId: string): Promise<TokenSet | null> {
  const cached = cachedTokens.get(userId);
  if (cached && !isTokenExpired(cached)) {
    return cached;
  }

  const result = await getTokensFromDb(userId);
  if (!result) return null;

  cachedTokens.set(userId, result.tokens);
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
 * Fails loudly if any required field is missing — silently persisting a
 * tokens row without a refresh_token (Whoop omits it when the request lacks
 * the `offline` scope) makes the integration unrecoverable on the next
 * access-token expiry, so callers must see this immediately.
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
 * Concurrent callers with the same userId+refreshToken share one in-flight
 * request (Whoop rotates refresh tokens; without dedupe the second call 400s).
 *
 * @param userId - The user the tokens belong to (used for dedupe key)
 * @param refreshToken - The refresh token to use
 */
export async function refreshAccessToken(userId: string, refreshToken: string): Promise<TokenSet> {
  const key = `${userId}:${refreshToken}`;
  const existing = refreshInFlight.get(key);
  if (existing) return existing;

  const promise = doRefreshAccessToken(refreshToken).finally(() => {
    refreshInFlight.delete(key);
  });
  refreshInFlight.set(key, promise);
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
      scope: "offline",
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
