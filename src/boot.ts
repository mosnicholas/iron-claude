/**
 * Application factory + lifecycle helpers.
 *
 * `createApp()` builds the Express app without binding a port — used by
 * `src/server.ts` (production) and `tests/e2e/harness/server.ts` (tests).
 *
 * `startBackgroundWorkers()` + `stopBackgroundWorkers()` own the inbox
 * worker and pg-boss lifecycle so tests can spin them up/down deterministically.
 *
 * Keeping side effects out of module load (no `app.listen()`, no `getBoss()`
 * at import time) is what makes the test harness viable.
 */

import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { webhookHandler } from "./handlers/webhook.js";
import { authRoutes } from "./handlers/auth.js";
import { csrfGuard } from "./auth/csrf.js";
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
import { startWorker, type WorkerHandle } from "./inbox/worker.js";
import { getBacklogCount } from "./inbox/storage.js";
import { getBoss, stopBoss } from "./jobs/queue.js";
import { registerJobHandlers, registerJobSchedules } from "./jobs/handlers.js";

let integrationsRegistered = false;

function registerIntegrationsOnce(): void {
  if (integrationsRegistered) return;
  registerIntegrationFactory("whoop", (userId) => getWhoopIntegration(userId));
  integrationsRegistered = true;
}

/**
 * Build the Express app. Pure — no listening, no worker boot, no side
 * effects beyond constructing the app + registering integration factories
 * (which is idempotent).
 */
export function createApp(): Express {
  registerIntegrationsOnce();

  const app = express();
  // Stripe webhook needs raw body for signature verification — mount BEFORE
  // the global JSON parser. Other routes get JSON-parsed bodies.
  app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), stripeWebhookHandler);
  app.use(express.json({ limit: "1mb" }));
  // CSRF defense is per-route via `csrfGuard` (src/auth/csrf.ts) on every
  // cookie-authenticated state-changing endpoint below, layered on top of
  // SameSite=Lax on the session cookie itself (src/handlers/auth.ts).
  // CodeQL's `js/missing-token-validation` query doesn't recognize that
  // pattern — it wants `csurf` middleware — so we suppress the alert.
  // lgtm[js/missing-token-validation]
  app.use(cookieParser());

  app.get("/health", async (_req, res) => {
    try {
      const backlog = await getBacklogCount();
      res.json({ ok: true, backlog });
    } catch (err) {
      res.status(503).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Webhook routes from external services (Telegram, Whoop). These are
  // signature-verified inside the handler, but Express middleware runs
  // before that check — a flood of unsigned requests still pays the
  // signature-verify cost. Ceiling generously: real senders won't approach
  // it, but a runaway sender or an attacker burning a single IP gets
  // dropped at the edge.
  const webhookLimiter = rateLimit({
    windowMs: 60_000,
    limit: 600,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  });

  app.post("/api/webhook", webhookLimiter, webhookHandler);

  // OTP endpoints are the highest-value brute-force target (phone-OTP request
  // floods, code-guessing on verify). Limit harder than the rest.
  const otpRequestLimiter = rateLimit({
    windowMs: 60_000,
    limit: 5,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  });
  const otpVerifyLimiter = rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  });
  // Session-bearing endpoints — cheaper to enumerate than OTP but still
  // worth a ceiling so a runaway client can't pin a worker.
  const sessionLimiter = rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  });

  app.post("/api/auth/otp/request", csrfGuard, otpRequestLimiter, authRoutes.otpRequest);
  app.post("/api/auth/otp/verify", csrfGuard, otpVerifyLimiter, authRoutes.otpVerify);
  app.post("/api/auth/signout", csrfGuard, sessionLimiter, authRoutes.signout);
  app.get("/api/me", sessionLimiter, authRoutes.requireSession, authRoutes.me);

  app.post(
    "/api/checkout/create-session",
    csrfGuard,
    sessionLimiter,
    authRoutes.requireSession,
    createCheckoutSessionHandler
  );

  app.post("/api/integrations/:device/webhook", webhookLimiter, integrationWebhookHandler);
  app.get("/api/integrations/:device/auth", sessionLimiter, integrationOAuthAuthHandler);
  app.get("/api/integrations/:device/callback", sessionLimiter, integrationOAuthCallbackHandler);
  app.post("/api/integrations/sync", csrfGuard, sessionLimiter, integrationSyncHandler);

  return app;
}

export interface BackgroundWorkers {
  worker: WorkerHandle;
  stop: () => Promise<void>;
}

/**
 * Start the inbox worker and pg-boss queue.
 *
 * @param opts.skipSchedules - When true, registers pg-boss handlers but does
 *   NOT register cron schedules. Tests use this to avoid scheduled jobs
 *   firing at non-deterministic moments during the test run; they manually
 *   trigger jobs via `boss.send()` / `boss.insert()`.
 */
export async function startBackgroundWorkers(
  opts: { skipSchedules?: boolean } = {}
): Promise<BackgroundWorkers> {
  const worker = startWorker();

  const boss = await getBoss();
  await registerJobHandlers(boss);
  if (!opts.skipSchedules) {
    await registerJobSchedules(boss);
  }

  return {
    worker,
    stop: async () => {
      await Promise.allSettled([worker.stop(), stopBoss()]);
    },
  };
}
