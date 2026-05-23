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
import { getStorage } from "../storage/db.js";

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
 * Resolve the IronClaude userId for an inbound webhook payload by mapping the
 * device's external user id (e.g. Whoop's `user_id`) to a row in
 * `integration_tokens`. Returns null if we don't have a linked user.
 */
async function resolveUserIdForWebhook(device: string, payload: unknown): Promise<string | null> {
  if (device !== "whoop") {
    // Other providers haven't been wired into the DB-backed flow yet.
    return null;
  }
  const p = payload as { user_id?: unknown } | null | undefined;
  const rawId = p?.user_id;
  if (rawId === undefined || rawId === null) return null;
  const externalId = String(rawId);
  return getStorage().findUserByExternalIntegrationId("whoop", externalId);
}

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
    // Resolve the user this webhook belongs to. Without a linked user we have
    // nowhere to persist the data.
    const userId = await resolveUserIdForWebhook(device, payload);
    if (!userId) {
      console.log(`[integration-webhook] No linked user for ${device} webhook; dropping event.`);
      return;
    }

    // Parse the webhook payload (this may make API calls)
    const event = await integration.parseWebhook(payload);

    if (!event) {
      console.log(`[integration-webhook] No actionable event from: ${device}`);
      return;
    }

    console.log(`[integration-webhook] Parsed ${event.type} event from ${device}`);

    // Persist to Postgres (mirrors recovery/sleep into workouts.recovery_snapshot)
    await storeIntegrationData(userId, event);

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
// OAuth Auth Initiation Handler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the callback redirect URI from the current request.
 * Uses X-Forwarded-Proto for protocol when behind a reverse proxy (Fly.io).
 */
function getRedirectUri(req: Request, device: string): string {
  const proto = req.get("x-forwarded-proto") || req.protocol;
  return `${proto}://${req.get("host")}/api/integrations/${device}/callback`;
}

/**
 * Initiate OAuth flow by redirecting the user to the device's authorization page.
 *
 * Route: GET /api/integrations/:device/auth
 *
 * Redirects the user to the device's OAuth authorization URL.
 * After the user authorizes, they are redirected back to the callback endpoint
 * which will exchange the code for tokens automatically.
 */
export async function integrationOAuthAuthHandler(req: Request, res: Response): Promise<void> {
  const device = req.params.device as string;

  console.log(`[integration-oauth] Auth initiation for: ${device}`);

  const integration = getIntegration(device);
  if (!integration) {
    res.status(404).json({ error: "Unknown integration" });
    return;
  }

  if (!integration.isConfigured()) {
    res.status(400).json({
      error: `${device} integration is not configured. Set client credentials first.`,
    });
    return;
  }

  const redirectUri = getRedirectUri(req, device);
  const authUrl = integration.getAuthUrl(redirectUri);

  console.log(
    `[integration-oauth] Redirecting to auth URL for ${device}, callback: ${redirectUri}`
  );

  res.redirect(authUrl);
}

// ─────────────────────────────────────────────────────────────────────────────
// OAuth Callback Handler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle OAuth callbacks from device integrations.
 *
 * Route: GET /api/integrations/:device/callback
 *
 * Automatically exchanges the authorization code for tokens and persists them.
 * On success, shows a confirmation page. On failure, shows the error.
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

  // Look up the integration
  const integration = getIntegration(device);
  if (!integration) {
    res.status(404).send(`
      <html>
        <head><title>Unknown Integration</title></head>
        <body style="font-family: system-ui; padding: 40px; max-width: 600px; margin: 0 auto;">
          <h1>Unknown Integration</h1>
          <p>No integration found for: ${escapeHtml(device)}</p>
        </body>
      </html>
    `);
    return;
  }

  // Exchange the code for tokens automatically
  const redirectUri = getRedirectUri(req, device);

  try {
    await integration.handleOAuthCallback(String(code), redirectUri);

    console.log(`[integration-oauth] Tokens exchanged and saved for: ${device}`);

    res.send(`
      <html>
        <head><title>Authorization Successful</title></head>
        <body style="font-family: system-ui; padding: 40px; max-width: 600px; margin: 0 auto;">
          <h1>Authorization Successful!</h1>
          <p>Your ${escapeHtml(integration.name)} tokens have been saved. The integration is now active.</p>
          <p>You can close this window.</p>
        </body>
      </html>
    `);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[integration-oauth] Token exchange failed for ${device}:`, message);

    res.status(500).send(`
      <html>
        <head><title>Token Exchange Failed</title></head>
        <body style="font-family: system-ui; padding: 40px; max-width: 600px; margin: 0 auto;">
          <h1>Token Exchange Failed</h1>
          <p>Failed to exchange authorization code for tokens.</p>
          <p><strong>Error:</strong> ${escapeHtml(message)}</p>
          <p>Please try the authorization process again.</p>
        </body>
      </html>
    `);
  }
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

  // TODO(multi-user): the manual sync endpoint doesn't yet receive a userId;
  // fall back to DEFAULT_USER_ID until the auth/admin migration lands.
  const userId = process.env.DEFAULT_USER_ID;
  if (!userId) {
    res.status(500).json({
      error:
        "DEFAULT_USER_ID is not set; manual sync requires a userId (auth phase will pass it in).",
    });
    return;
  }

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
        await storeIntegrationData(userId, { type: "sleep", data: sleep });
      }
      if (recovery) {
        await storeIntegrationData(userId, { type: "recovery", data: recovery });
      }
      for (const workout of workouts) {
        await storeIntegrationData(userId, { type: "workout", data: workout });
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
