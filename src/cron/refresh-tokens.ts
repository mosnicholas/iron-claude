/**
 * Token refresh — per-user logic. Dispatched from pg-boss via
 * `refresh-tokens.tick` (weekly Wed 3am) → `refresh-tokens.user`.
 *
 * Webhooks also refresh on-demand on 401; this is a safety net.
 */

import { getWhoopIntegration } from "../integrations/whoop/integration.js";
import type { JobCtx } from "../jobs/handlers.js";

const EXPIRY_BUFFER_MS = 24 * 60 * 60 * 1000; // refresh anything expiring within 24h

export async function processRefreshTokensForUser({
  user,
  storage,
}: JobCtx): Promise<{ success: boolean; message?: string; error?: string }> {
  const results: string[] = [];

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

  return { success: true, message: results.join("; ") };
}

function needsRefresh(expiresAt: Date | null): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() - Date.now() < EXPIRY_BUFFER_MS;
}
