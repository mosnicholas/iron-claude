/**
 * pg-boss job queue.
 *
 * pg-boss uses the same Postgres database as the rest of the app (in a
 * separate `pgboss` schema). It gives us durable retries with exponential
 * backoff, multi-instance safety via SELECT FOR UPDATE SKIP LOCKED, and a
 * cron-syntax scheduler — replacing the brittle "external cron-job.org hits
 * an HTTP endpoint that loops users" pattern.
 *
 * Job naming convention:
 *   - `<cron-name>.tick`  — fan-out trigger that runs on a cron schedule.
 *                           Its handler enumerates active users and enqueues
 *                           one `.user` job per user.
 *   - `<cron-name>.user`  — per-user work, payload `{ userId }`. Has its own
 *                           retry/backoff so a flaky user doesn't tank the
 *                           batch and a tick-level outage doesn't lose work.
 *
 * Global (non-per-user) jobs use only `.tick`.
 */

import { PgBoss } from "pg-boss";

let bossInstance: PgBoss | null = null;
let starting: Promise<PgBoss> | null = null;

/**
 * Lazily start the pg-boss instance. Subsequent calls return the same one.
 * Idempotent — calling twice is safe; the second await resolves to the same
 * instance.
 */
export async function getBoss(): Promise<PgBoss> {
  if (bossInstance) return bossInstance;
  if (starting) return starting;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set — pg-boss can't start");
  }

  starting = (async () => {
    // pg-boss v12: connection options at constructor, retry/retention at
    // per-queue level via createQueue(). We tune those in jobs/handlers.ts.
    const boss = new PgBoss({ connectionString });
    boss.on("error", (err: unknown) => {
      console.error("[pg-boss] error event:", err);
    });
    await boss.start();
    console.log("[pg-boss] started");
    bossInstance = boss;
    return boss;
  })();

  return starting;
}

export async function stopBoss(): Promise<void> {
  if (bossInstance) {
    await bossInstance.stop({ graceful: true, timeout: 10_000 });
    bossInstance = null;
    starting = null;
  }
}

/**
 * Test seam — inject a mock boss for unit tests that don't want real PG.
 */
export function __setBossForTests(boss: PgBoss | null): void {
  bossInstance = boss;
  starting = boss ? Promise.resolve(boss) : null;
}
