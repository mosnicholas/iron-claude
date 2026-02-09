/**
 * Token Refresh Cron Job
 *
 * Proactively refreshes integration tokens to prevent expiration.
 * Runs weekly as a safety net - tokens also refresh on-demand when webhooks arrive.
 */

import { getWhoopIntegration } from "../integrations/whoop/integration.js";

interface CronResult {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Refresh all integration tokens.
 */
export async function runRefreshTokens(): Promise<CronResult> {
  const results: string[] = [];
  let hasErrors = false;

  // Refresh Whoop tokens
  const whoop = getWhoopIntegration();
  if (whoop.isConfigured()) {
    try {
      console.log("[refresh-tokens] Refreshing Whoop tokens...");
      await whoop.refreshToken();
      results.push("Whoop: refreshed");
      console.log("[refresh-tokens] Whoop tokens refreshed successfully");
    } catch (error) {
      hasErrors = true;
      const msg = error instanceof Error ? error.message : "Unknown error";
      results.push(`Whoop: failed - ${msg}`);
      console.error("[refresh-tokens] Failed to refresh Whoop tokens:", error);
    }
  } else {
    results.push("Whoop: not configured");
  }

  // Add other integrations here as needed

  if (hasErrors) {
    return {
      success: false,
      error: results.join("; "),
    };
  }

  return {
    success: true,
    message: results.join("; "),
  };
}
