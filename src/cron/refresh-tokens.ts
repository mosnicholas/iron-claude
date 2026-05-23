/**
 * Token Refresh Cron Job
 *
 * Proactively refreshes integration tokens to prevent expiration.
 * Runs weekly as a safety net — tokens also refresh on-demand when webhooks arrive.
 *
 * Multi-tenant: iterates active users and refreshes each user's tokens
 * independently. A failure on one user is logged and the loop continues.
 */

import { getWhoopIntegration } from "../integrations/whoop/integration.js";
import { runCronForEachUser, type CronResult } from "./runner.js";

const EXPIRY_BUFFER_MS = 24 * 60 * 60 * 1000; // 24h — refresh anything expiring within a day

/**
 * Refresh integration tokens for every active user.
 */
export async function runRefreshTokens(): Promise<CronResult> {
  return runCronForEachUser(
    "refresh-tokens",
    async ({ user, storage }) => {
      const results: string[] = [];

      // ── Whoop ──────────────────────────────────────────────────────────────
      const whoopToken = await storage.getIntegrationToken(user.id, "whoop");
      if (!whoopToken) {
        results.push("Whoop: no token");
      } else {
        const whoop = getWhoopIntegration(user.id);
        if (!whoop.isConfigured()) {
          results.push("Whoop: not configured");
        } else if (needsRefresh(whoopToken.expiresAt)) {
          try {
            console.log(`[refresh-tokens] user=${user.id} refreshing Whoop tokens`);
            await whoop.refreshToken();
            results.push("Whoop: refreshed");
          } catch (error) {
            const msg = error instanceof Error ? error.message : "Unknown error";
            console.error(`[refresh-tokens] user=${user.id} Whoop refresh failed:`, error);
            return { success: false, error: `Whoop: ${msg}` };
          }
        } else {
          results.push("Whoop: still fresh");
        }
      }

      // Add other integrations here as needed.

      return { success: true, message: results.join("; ") };
    },
    { requireProfile: false }
  );
}

function needsRefresh(expiresAt: Date | null): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() - Date.now() < EXPIRY_BUFFER_MS;
}
