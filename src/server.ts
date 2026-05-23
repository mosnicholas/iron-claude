/**
 * Express HTTP Server
 *
 * Entry point for the Fly.io deployment. Boot order:
 *   1. Init Sentry (no-op without SENTRY_DSN).
 *   2. Mount middleware (json, cookies).
 *   3. Register routes (health, webhook → inbox, cron, auth, integrations).
 *   4. Register integrations (Whoop). Falls back to DEFAULT_USER_ID until the
 *      per-user OAuth flow lands.
 *   5. Start the inbox worker that drains `inbox_events`.
 *   6. Listen.
 */

import express from "express";
import cookieParser from "cookie-parser";
import { webhookHandler } from "./handlers/webhook.js";
import { createCronHandler } from "./handlers/cron.js";
import { authRoutes } from "./handlers/auth.js";
import {
  integrationWebhookHandler,
  integrationOAuthAuthHandler,
  integrationOAuthCallbackHandler,
  integrationSyncHandler,
} from "./integrations/webhook-handler.js";
import { registerIntegration } from "./integrations/registry.js";
import { getWhoopIntegration } from "./integrations/whoop/integration.js";
import { startWorker } from "./inbox/worker.js";
import { initSentry } from "./observability/sentry.js";
import { getBacklogCount } from "./inbox/storage.js";

initSentry();

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// ─────────────────────────────────────────────────────────────────────────────
// Health
// ─────────────────────────────────────────────────────────────────────────────

app.get("/health", async (_req, res) => {
  try {
    const backlog = await getBacklogCount();
    res.json({ ok: true, backlog });
  } catch (err) {
    res.status(503).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Telegram webhook (insert → inbox; 200 immediately)
// ─────────────────────────────────────────────────────────────────────────────

app.post("/api/webhook", webhookHandler);

// ─────────────────────────────────────────────────────────────────────────────
// Cron endpoints (called by an external scheduler like cron-job.org)
// ─────────────────────────────────────────────────────────────────────────────

app.get("/api/cron/daily-reminder", createCronHandler("daily-reminder"));
app.get("/api/cron/weekly-plan", createCronHandler("weekly-plan"));
app.get("/api/cron/check-reminders", createCronHandler("check-reminders"));
app.get("/api/cron/refresh-tokens", createCronHandler("refresh-tokens"));
app.get("/api/cron/daily-compaction", createCronHandler("daily-compaction"));

// ─────────────────────────────────────────────────────────────────────────────
// Auth (Supabase phone OTP + sessions)
// ─────────────────────────────────────────────────────────────────────────────

app.post("/api/auth/otp/request", authRoutes.otpRequest);
app.post("/api/auth/otp/verify", authRoutes.otpVerify);
app.post("/api/auth/signout", authRoutes.signout);
app.get("/api/me", authRoutes.requireSession, authRoutes.me);

// ─────────────────────────────────────────────────────────────────────────────
// Device Integrations
// ─────────────────────────────────────────────────────────────────────────────

registerIntegration(getWhoopIntegration());

app.post("/api/integrations/:device/webhook", integrationWebhookHandler);
app.get("/api/integrations/:device/auth", integrationOAuthAuthHandler);
app.get("/api/integrations/:device/callback", integrationOAuthCallbackHandler);
app.post("/api/integrations/sync", integrationSyncHandler);

// ─────────────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 8080;
const server = app.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}`);
});

const worker = startWorker();
console.log("[server] inbox worker started");

function shutdown(signal: string): void {
  console.log(`[server] received ${signal}, shutting down`);
  worker
    .stop()
    .catch(() => {
      /* swallow */
    })
    .finally(() => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 10_000).unref();
    });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
