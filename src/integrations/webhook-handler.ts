/**
 * Unified Webhook Handler for Device Integrations
 *
 * Routes incoming webhooks to the appropriate device integration handler.
 * Stores normalized data in the fitness-data repository.
 */

import type { Request, Response } from "express";
import { getIntegration, getConfiguredIntegrations } from "./registry.js";
import { storeIntegrationData } from "./storage.js";
import type { WebhookEvent } from "./types.js";
import { createTelegramBot } from "../bot/telegram.js";

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
// Notification Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatWebhookNotification(event: WebhookEvent): string {
  switch (event.type) {
    case "recovery": {
      const d = event.data;
      const parts = [`Recovery: ${d.score}%`];
      if (d.hrv !== undefined) parts.push(`HRV ${Math.round(d.hrv)}ms`);
      if (d.restingHeartRate !== undefined) parts.push(`RHR ${d.restingHeartRate}bpm`);
      return parts.join(" | ");
    }
    case "sleep": {
      const d = event.data;
      const hours = Math.floor(d.durationMinutes / 60);
      const mins = d.durationMinutes % 60;
      const parts = [`Sleep: ${hours}h${mins > 0 ? ` ${mins}m` : ""}`];
      if (d.score !== undefined) parts.push(`score ${d.score}`);
      return parts.join(" | ");
    }
    case "workout": {
      const d = event.data;
      const hours = Math.floor(d.durationMinutes / 60);
      const mins = d.durationMinutes % 60;
      const duration = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
      const parts = [`Workout: ${d.type} (${duration})`];
      if (d.strain !== undefined) parts.push(`strain ${d.strain.toFixed(1)}`);
      if (d.calories !== undefined) parts.push(`${d.calories} cal`);
      return parts.join(" | ");
    }
  }
}

async function notifyUser(event: WebhookEvent): Promise<void> {
  try {
    const bot = createTelegramBot();
    const message = formatWebhookNotification(event);
    await bot.sendPlainMessage(message);
  } catch (error) {
    console.error(`[integration-webhook] Failed to send notification:`, error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook Handler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Process a webhook in the background.
 * This is called after we've already returned 200 to the sender.
 */
async function processWebhookAsync(
  integration: ReturnType<typeof getIntegration>,
  payload: unknown,
  device: string
): Promise<void> {
  if (!integration) return;

  try {
    // Parse the webhook payload (this may make API calls)
    const event = await integration.parseWebhook(payload);

    if (!event) {
      console.log(`[integration-webhook] No actionable event from: ${device}`);
      return;
    }

    console.log(`[integration-webhook] Parsed ${event.type} event from ${device}`);

    // Store the data in the fitness-data repo
    await storeIntegrationData(event);

    console.log(`[integration-webhook] Stored ${event.type} data for ${event.data.date}`);

    // Notify user via Telegram
    await notifyUser(event);
  } catch (error) {
    console.error(`[integration-webhook] Error processing webhook:`, error);
  }
}

/**
 * Handle incoming webhooks from device integrations.
 *
 * Route: POST /api/integrations/:device/webhook
 *
 * Returns 200 immediately after validation, then processes asynchronously.
 * This prevents webhook senders from timing out and retrying.
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

  // Verify the webhook is authentic (must be sync - reject invalid webhooks)
  if (!integration.verifyWebhook(req)) {
    console.log(`[integration-webhook] Invalid webhook signature for: ${device}`);
    res.status(401).json({ error: "Invalid webhook signature" });
    return;
  }

  // Return 200 immediately to prevent retries
  // Clone the payload since req.body may not be available after response
  const payload = JSON.parse(JSON.stringify(req.body));
  res.status(200).json({ ok: true, message: "Webhook received" });

  // Process asynchronously in the background
  processWebhookAsync(integration, payload, device);
}

// ─────────────────────────────────────────────────────────────────────────────
// OAuth Callback Handler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle OAuth callbacks from device integrations.
 *
 * Route: GET /api/integrations/:device/callback
 *
 * Security note: This endpoint only displays the authorization code for manual
 * copy/paste into the CLI setup wizard. It does NOT exchange the code for tokens.
 * CSRF protection (state parameter) is not required because:
 * 1. No tokens are exchanged or stored
 * 2. The code is only displayed, not processed
 * 3. An attacker could only show a victim a code that would fail validation
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
