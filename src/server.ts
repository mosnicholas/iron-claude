/**
 * Express HTTP Server
 *
 * Entry point for the Fly.io deployment. Boot order:
 *   1. Init Sentry (no-op without SENTRY_DSN).
 *   2. Mount middleware (json, cookies).
 *   3. Register HTTP routes (health, webhook → inbox, auth, integrations).
 *   4. Register integration factories (Whoop). Per-user instances are built
 *      on demand by the webhook/OAuth/cron handlers.
 *   5. Start the inbox worker that drains `inbox_events`.
 *   6. Start pg-boss (durable job queue) — registers cron schedules + workers.
 *   7. Listen.
 */

import express from "express";
import cookieParser from "cookie-parser";
import { webhookHandler } from "./handlers/webhook.js";
import { authRoutes } from "./handlers/auth.js";
import { stripeWebhookHandler } from "./handlers/stripe.js";
import { createCheckoutSessionHandler } from "./handlers/checkout.js";
import {
  integrationWebhookHandler,
  integrationOAuthAuthHandler,
  integrationOAuthCallbackHandler,
  integrationSyncHandler,
} from "./integrations/webhook-handler.js";
import { registerIntegrationFactory } from "./integrations/registry.js";
import { getWhoopIntegration } from "./integrations/whoop/integration.js";
import { startWorker } from "./inbox/worker.js";
import { initSentry } from "./observability/sentry.js";
import { getBacklogCount } from "./inbox/storage.js";
import { getBoss, stopBoss } from "./jobs/queue.js";
import { registerJobHandlers, registerJobSchedules } from "./jobs/handlers.js";

initSentry();

const app = express();
// Stripe needs the raw request body to verify signatures, so the raw-body
// middleware must be mounted on the webhook path BEFORE the global JSON
// parser. Other routes still get parsed JSON.
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), stripeWebhookHandler);
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
// Auth (Supabase phone OTP + sessions)
// ─────────────────────────────────────────────────────────────────────────────

app.post("/api/auth/otp/request", authRoutes.otpRequest);
app.post("/api/auth/otp/verify", authRoutes.otpVerify);
app.post("/api/auth/signout", authRoutes.signout);
app.get("/api/me", authRoutes.requireSession, authRoutes.me);

// ─────────────────────────────────────────────────────────────────────────────
// Stripe Checkout (session-gated)
// ─────────────────────────────────────────────────────────────────────────────

app.post("/api/checkout/create-session", authRoutes.requireSession, createCheckoutSessionHandler);

// ─────────────────────────────────────────────────────────────────────────────
// Device Integrations
// ─────────────────────────────────────────────────────────────────────────────

registerIntegrationFactory("whoop", (userId) => getWhoopIntegration(userId));

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

// Start pg-boss (durable job queue) and register schedules + handlers.
// Errors here are fatal — if cron's broken we want to know at boot, not
// silently miss reminders for hours.
void (async () => {
  try {
    const boss = await getBoss();
    await registerJobHandlers(boss);
    await registerJobSchedules(boss);
    console.log("[server] pg-boss schedules + handlers registered");
  } catch (err) {
    console.error("[server] pg-boss start failed:", err);
    process.exit(1);
  }
})();

function shutdown(signal: string): void {
  console.log(`[server] received ${signal}, shutting down`);
  Promise.allSettled([worker.stop(), stopBoss()]).finally(() => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
