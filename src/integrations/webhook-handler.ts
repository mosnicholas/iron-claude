/**
 * Unified Webhook Handler for Device Integrations
 *
 * Routes incoming webhooks to the appropriate device integration handler.
 * Stores normalized data in the fitness-data repository.
 */

import type { Request, Response } from "express";
import { getIntegration, getConfiguredIntegrations } from "./registry.js";
import { storeIntegrationData } from "./storage.js";

// ─────────────────────────────────────────────────────────────────────────────
// Security Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Escape HTML special characters to prevent XSS attacks.
 */
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook Handler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle incoming webhooks from device integrations.
 *
 * Route: POST /api/integrations/:device/webhook
 */
export async function integrationWebhookHandler(req: Request, res: Response): Promise<void> {
  const device = req.params.device as string;

  console.log(`[integration-webhook] Received webhook for: ${device}`);

  // Look up the integration
  const integration = getIntegration(device);
  if (!integration) {
    console.log(`[integration-webhook] Unknown integration: ${device}`);
    res.status(404).json({ error: "Unknown integration" });
    return;
  }

  // Verify the webhook is authentic
  if (!integration.verifyWebhook(req)) {
    console.log(`[integration-webhook] Invalid webhook signature for: ${device}`);
    res.status(401).json({ error: "Invalid webhook signature" });
    return;
  }

  try {
    // Parse the webhook payload
    const event = await integration.parseWebhook(req.body);

    if (!event) {
      // Valid webhook but nothing to process (e.g., delete event, unscored data)
      console.log(`[integration-webhook] No actionable event from: ${device}`);
      res.status(200).json({ ok: true, message: "No action needed" });
      return;
    }

    console.log(`[integration-webhook] Parsed ${event.type} event from ${device}`);

    // Store the data in the fitness-data repo
    await storeIntegrationData(event);

    console.log(`[integration-webhook] Stored ${event.type} data for ${event.data.date}`);

    res.status(200).json({ ok: true, type: event.type, date: event.data.date });
  } catch (error) {
    console.error(`[integration-webhook] Error processing webhook:`, error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Internal error",
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OAuth Callback Handler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle OAuth callbacks from device integrations.
 *
 * Route: GET /api/integrations/:device/callback
 *
 * Note: In a full implementation, this would:
 * 1. Exchange the code for tokens
 * 2. Store the tokens securely
 * 3. Redirect to a success page
 *
 * For now, it just displays the code for manual setup.
 */
export async function integrationOAuthCallbackHandler(req: Request, res: Response): Promise<void> {
  const device = req.params.device as string;
  const { code, error, error_description } = req.query;

  console.log(`[integration-oauth] Callback for: ${device}`);

  if (error) {
    // Escape user-supplied values to prevent XSS
    const safeError = escapeHtml(String(error));
    const safeDescription = error_description
      ? escapeHtml(String(error_description))
      : "No additional details available.";

    res.status(400).send(`
      <html>
        <head><title>Authorization Failed</title></head>
        <body style="font-family: system-ui; padding: 40px; max-width: 600px; margin: 0 auto;">
          <h1>Authorization Failed</h1>
          <p><strong>Error:</strong> ${safeError}</p>
          <p>${safeDescription}</p>
          <p>Please try the authorization process again.</p>
        </body>
      </html>
    `);
    return;
  }

  if (!code) {
    res.status(400).send(`
      <html>
        <head><title>Missing Authorization Code</title></head>
        <body style="font-family: system-ui; padding: 40px; max-width: 600px; margin: 0 auto;">
          <h1>Missing Authorization Code</h1>
          <p>No authorization code was received. Please try the authorization process again.</p>
        </body>
      </html>
    `);
    return;
  }

  // Display the code for manual setup
  // Escape the code to prevent XSS
  const safeCode = escapeHtml(String(code));

  res.send(`
    <html>
      <head><title>Authorization Successful</title></head>
      <body style="font-family: system-ui; padding: 40px; max-width: 600px; margin: 0 auto;">
        <h1>Authorization Successful!</h1>
        <p>Copy this authorization code and paste it into the setup wizard:</p>
        <div style="background: #f0f0f0; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <code style="font-size: 14px; word-break: break-all;">${safeCode}</code>
        </div>
        <p>You can close this window after copying the code.</p>
      </body>
    </html>
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync Endpoint
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manually sync data from all configured integrations.
 *
 * Route: POST /api/integrations/sync
 *
 * This is useful for:
 * - Initial data backfill
 * - Recovering from missed webhooks
 * - Manual refresh
 */
export async function integrationSyncHandler(req: Request, res: Response): Promise<void> {
  // Validate cron secret if configured
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${cronSecret}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  const { date } = req.query;
  const syncDate = typeof date === "string" ? date : new Date().toISOString().split("T")[0];

  console.log(`[integration-sync] Syncing data for: ${syncDate}`);

  const results: Array<{
    integration: string;
    success: boolean;
    data?: { sleep: boolean; recovery: boolean; workouts: number };
    error?: string;
  }> = [];

  const integrations = getConfiguredIntegrations();

  for (const integration of integrations) {
    try {
      const sleep = await integration.fetchSleep(syncDate);
      const recovery = await integration.fetchRecovery(syncDate);
      const workouts = await integration.fetchWorkouts(syncDate);

      // Store each piece of data
      if (sleep) {
        await storeIntegrationData({ type: "sleep", data: sleep });
      }
      if (recovery) {
        await storeIntegrationData({ type: "recovery", data: recovery });
      }
      for (const workout of workouts) {
        await storeIntegrationData({ type: "workout", data: workout });
      }

      results.push({
        integration: integration.slug,
        success: true,
        data: {
          sleep: !!sleep,
          recovery: !!recovery,
          workouts: workouts.length,
        },
      });
    } catch (error) {
      results.push({
        integration: integration.slug,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  res.json({
    ok: true,
    date: syncDate,
    results,
  });
}
