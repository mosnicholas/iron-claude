/**
 * Whoop Integration
 *
 * Exports all Whoop integration components.
 */

// Types
export type { WhoopUser, WhoopSleep, WhoopRecovery, WhoopWorkout, WhoopCycle } from "./client.js";

// OAuth
export {
  WHOOP_SCOPES,
  DEFAULT_SCOPES,
  getWhoopOAuthConfig,
  isWhoopOAuthConfigured,
  getStoredTokens,
  isTokenExpired,
  getAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  revokeToken,
} from "./oauth.js";

// Client
export { WhoopClient, createWhoopClient, getSportName, SPORT_NAMES } from "./client.js";

// Webhooks
export {
  verifyWhoopWebhook,
  normalizeSleep,
  normalizeRecovery,
  normalizeWorkout,
  parseWhoopWebhook,
} from "./webhooks.js";

// Integration
export { WhoopIntegration, getWhoopIntegration } from "./integration.js";

// Setup
export { setupWhoop, isWhoopConfigured, runStandaloneSetup } from "./setup.js";
export type { WhoopSetupResult } from "./setup.js";
