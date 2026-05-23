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
  app.use(cookieParser());

  app.get("/health", async (_req, res) => {
    try {
      const backlog = await getBacklogCount();
      res.json({ ok: true, backlog });
    } catch (err) {
      res.status(503).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/webhook", webhookHandler);

  app.post("/api/auth/otp/request", authRoutes.otpRequest);
  app.post("/api/auth/otp/verify", authRoutes.otpVerify);
  app.post("/api/auth/signout", authRoutes.signout);
  app.get("/api/me", authRoutes.requireSession, authRoutes.me);

  app.post("/api/checkout/create-session", authRoutes.requireSession, createCheckoutSessionHandler);

  app.post("/api/integrations/:device/webhook", integrationWebhookHandler);
  app.get("/api/integrations/:device/auth", integrationOAuthAuthHandler);
  app.get("/api/integrations/:device/callback", integrationOAuthCallbackHandler);
  app.post("/api/integrations/sync", integrationSyncHandler);

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
