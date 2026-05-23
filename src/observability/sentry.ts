/**
 * Sentry wrapper — initialized once at process start. All cron jobs, the
 * webhook, and tool errors flow through `captureError` with structured tags.
 *
 * If $SENTRY_DSN is unset, this becomes a no-op so OSS self-hosters don't
 * need a Sentry project.
 */

import * as Sentry from "@sentry/node";

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  initialized = true;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.log("[sentry] SENTRY_DSN not set — error reporting disabled");
    return;
  }
  Sentry.init({
    dsn,
    tracesSampleRate: 0,
    environment: process.env.NODE_ENV ?? "production",
    release: process.env.GIT_COMMIT_SHA,
  });
  console.log("[sentry] initialized");
}

export interface ErrorContext {
  userId?: string;
  channel?: string;
  turnId?: string;
  tool?: string;
  handler?: string;
  extra?: Record<string, unknown>;
}

export function captureError(err: unknown, context: ErrorContext = {}): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[error] ${msg}`, context);
  if (!process.env.SENTRY_DSN) return;
  Sentry.withScope((scope) => {
    if (context.userId) scope.setUser({ id: context.userId });
    if (context.channel) scope.setTag("channel", context.channel);
    if (context.turnId) scope.setTag("turn_id", context.turnId);
    if (context.tool) scope.setTag("tool", context.tool);
    if (context.handler) scope.setTag("handler", context.handler);
    if (context.extra) scope.setContext("extra", context.extra);
    Sentry.captureException(err);
  });
}
