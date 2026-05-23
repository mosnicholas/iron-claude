/**
 * Production server entrypoint. Composes `createApp()` from boot.ts with the
 * inbox worker + pg-boss schedules and binds the HTTP port.
 *
 * Tests boot `createApp()` directly via tests/e2e/harness/server.ts and
 * skip schedule registration so cron firings don't pollute test runs.
 */

import { createApp, startBackgroundWorkers } from "./boot.js";
import { initSentry } from "./observability/sentry.js";

initSentry();

const app = createApp();

const PORT = process.env.PORT || 8080;
const server = app.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}`);
});

let workersHandle: Awaited<ReturnType<typeof startBackgroundWorkers>> | null = null;
void (async () => {
  try {
    workersHandle = await startBackgroundWorkers();
    console.log("[server] inbox worker + pg-boss schedules registered");
  } catch (err) {
    console.error("[server] background workers failed to start:", err);
    process.exit(1);
  }
})();

function shutdown(signal: string): void {
  console.log(`[server] received ${signal}, shutting down`);
  (workersHandle ? workersHandle.stop() : Promise.resolve()).finally(() => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
