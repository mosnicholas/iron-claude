/**
 * Per-user job handlers and the fan-out ticks that spawn them.
 *
 * Each scheduled cron has a `.tick` job (runs on a cron schedule, enumerates
 * active users, enqueues one `.user` job per user) and a `.user` job
 * (executes the work for one user with its own retry budget).
 *
 * The per-user functions accept a thin `JobCtx` so they're easy to unit-test
 * without going through pg-boss.
 */

import { PgBoss, type Job } from "pg-boss";
import type { User } from "../db/schema.js";
import { listActiveUsers, getUserById } from "../auth/identity.js";
import { getStorage } from "../storage/db.js";
import { sendBotMessageForUser } from "../bot/telegram-for-user.js";
import { captureError } from "../observability/sentry.js";
import type { Storage } from "../storage/storage.js";

// Per-user logic, factored out of the legacy `src/cron/*.ts` files. The
// existing module files still export `run*` for backward-compat callers and
// tests, but the job runtime drives these directly.
import { processDailyReminderForUser } from "../cron/daily-reminder.js";
import { processWeeklyPlanForUser } from "../cron/weekly-plan.js";
import { processCheckRemindersForUser } from "../cron/check-reminders.js";
import { processRefreshTokensForUser } from "../cron/refresh-tokens.js";
import { processDailyCompactionForUser } from "../cron/daily-compaction.js";
import { processTrialExpiryForUser } from "../cron/trial-expiry.js";
import { runLogRetention } from "../cron/log-retention.js";

export interface JobCtx {
  user: User;
  storage: Storage;
  sendMessage: (text: string) => Promise<void>;
}

type PerUserJobFn = (ctx: JobCtx) => Promise<{ success: boolean; message?: string; error?: string }>;

interface JobSpec {
  /** Name pg-boss sees, e.g. "daily-reminder.user". */
  name: string;
  /** Whether to skip users without a profile row. */
  requireProfile: boolean;
  /** The per-user function. */
  fn: PerUserJobFn;
  /** Retry tuning — overrides the queue-wide defaults. */
  retryLimit?: number;
  retryDelay?: number;
}

const PER_USER_JOBS: JobSpec[] = [
  {
    name: "daily-reminder.user",
    requireProfile: true,
    fn: processDailyReminderForUser,
    retryLimit: 2,
    retryDelay: 300, // 5 min
  },
  {
    name: "weekly-plan.user",
    requireProfile: true,
    fn: processWeeklyPlanForUser,
    retryLimit: 2,
    retryDelay: 600, // 10 min — LLM-heavy
  },
  {
    name: "check-reminders.user",
    requireProfile: false,
    fn: processCheckRemindersForUser,
    retryLimit: 3,
    retryDelay: 60,
  },
  {
    name: "refresh-tokens.user",
    requireProfile: false,
    fn: processRefreshTokensForUser,
    retryLimit: 3,
    retryDelay: 600, // 10 min
  },
  {
    name: "daily-compaction.user",
    requireProfile: false,
    fn: processDailyCompactionForUser,
    retryLimit: 2,
    retryDelay: 600,
  },
  {
    name: "trial-expiry.user",
    requireProfile: false,
    fn: processTrialExpiryForUser,
    retryLimit: 2,
    retryDelay: 300,
  },
];

const TICK_TO_USER: Record<string, string> = Object.fromEntries(
  PER_USER_JOBS.map((s) => [s.name.replace(".user", ".tick"), s.name])
);

/**
 * Tick handler: fan out one per-user job per active user.
 * The `tickName` is used purely for logs.
 */
async function fanOutTick(boss: PgBoss, tickName: string): Promise<void> {
  const userJobName = TICK_TO_USER[tickName];
  if (!userJobName) throw new Error(`No user job mapped for tick ${tickName}`);
  const users = await listActiveUsers();
  if (users.length === 0) {
    console.log(`[jobs] ${tickName}: no active users`);
    return;
  }
  // pg-boss v12: insert(queueName, jobs[]).
  await boss.insert(
    userJobName,
    users.map((u) => ({ data: { userId: u.id } }))
  );
  console.log(`[jobs] ${tickName}: fanned out ${users.length} ${userJobName} job(s)`);
}

/**
 * Per-user handler: resolve the user, build the JobCtx, run the spec's fn.
 */
async function runUserJob(spec: JobSpec, data: { userId: string }): Promise<void> {
  const user = await getUserById(data.userId);
  if (!user) {
    console.log(`[jobs] ${spec.name}: user ${data.userId} not found (deleted?); skipping`);
    return;
  }
  const storage = getStorage();
  if (spec.requireProfile) {
    const profile = await storage.readProfile(user.id);
    if (!profile) {
      console.log(`[jobs] ${spec.name}: user=${user.id} has no profile; skipping`);
      return;
    }
  }

  try {
    const result = await spec.fn({
      user,
      storage,
      sendMessage: (text) => sendBotMessageForUser(user, text),
    });
    if (!result.success) {
      const err = new Error(result.error ?? "handler returned success:false");
      captureError(err, { userId: user.id, handler: spec.name });
      throw err; // pg-boss will retry per spec
    }
  } catch (err) {
    captureError(err, { userId: user.id, handler: spec.name });
    throw err;
  }
}

/**
 * Register every handler with pg-boss. Call once at boot.
 */
export async function registerJobHandlers(boss: PgBoss): Promise<void> {
  // Create queues with per-queue retry/retention tuning before registering
  // workers. createQueue is idempotent — safe to call on every boot.
  for (const spec of PER_USER_JOBS) {
    const tickName = spec.name.replace(".user", ".tick");
    // Tick queue: retry-1 with a short backoff is enough; the user-level jobs
    // own the real retry budget.
    await boss.createQueue(tickName, {
      retryLimit: 1,
      retryDelay: 60,
      retryBackoff: false,
    });
    await boss.createQueue(spec.name, {
      retryLimit: spec.retryLimit ?? 3,
      retryDelay: spec.retryDelay ?? 60,
      retryBackoff: true,
    });
  }
  await boss.createQueue("log-retention.tick", {
    retryLimit: 1,
    retryDelay: 60,
    retryBackoff: false,
  });

  // Tick handlers — each fans out per-user jobs.
  for (const spec of PER_USER_JOBS) {
    const tickName = spec.name.replace(".user", ".tick");
    await boss.work(tickName, async () => {
      await fanOutTick(boss, tickName);
    });
    // localConcurrency=5 — up to 5 concurrent users per Fly instance for this
    // queue. The advisory lock in our inbox worker only covers chat messages;
    // these cron jobs already operate per-user, so parallelism is safe.
    // pg-boss v12 hands the worker a BATCH (Job[]); we process them in order.
    // localConcurrency=5 allows up to 5 of these batches to run in parallel
    // per Fly instance.
    await boss.work(
      spec.name,
      { localConcurrency: 5 },
      async (jobs: Job<{ userId: string }>[]) => {
        for (const job of jobs) {
          await runUserJob(spec, job.data);
        }
      }
    );
  }

  // Global (non-per-user) jobs.
  await boss.work("log-retention.tick", async () => {
    const result = await runLogRetention();
    if (!result.success) {
      throw new Error(result.error ?? "log-retention failed");
    }
    console.log(`[jobs] log-retention.tick: ${result.message}`);
  });
}

/**
 * Register cron schedules. Times are in the server's TIMEZONE env (pg-boss
 * accepts an IANA tz per schedule via the third arg — we pass it explicitly
 * so a deploy in a different region doesn't shift firing times).
 */
export async function registerJobSchedules(boss: PgBoss): Promise<void> {
  const tz = process.env.TIMEZONE ?? "America/New_York";
  const opts = { tz };

  await boss.schedule("daily-reminder.tick", "0 6 * * 1-5", undefined, opts);
  await boss.schedule("weekly-plan.tick", "0 20 * * 0", undefined, opts);
  await boss.schedule("check-reminders.tick", "0 * * * *", undefined, opts);
  await boss.schedule("refresh-tokens.tick", "0 3 * * 3", undefined, opts); // Wed 3am
  await boss.schedule("daily-compaction.tick", "0 3 * * *", undefined, opts);
  await boss.schedule("trial-expiry.tick", "0 9 * * *", undefined, opts);
  await boss.schedule("log-retention.tick", "0 4 * * *", undefined, opts);

  console.log(`[jobs] schedules registered (tz=${tz})`);
}
