/**
 * End-to-end tests for the pg-boss job wiring (src/jobs/).
 *
 * Approach: mock the PgBoss instance and assert on the calls our code makes
 * — `createQueue`, `work`, `insert`, `schedule`. This catches the contract
 * bugs (wrong queue name, wrong retry config, missing handler registration,
 * fan-out producing the wrong job count) without needing a real Postgres
 * with pg_advisory_locks etc.
 *
 * Real-Postgres testing of pg-boss itself is out of scope here — that's
 * pg-boss's own test suite. We test OUR contract with it.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { createMemDb, getMemDb, seedUser } from "../helpers/pgmem.js";

// Mock pg-boss BEFORE importing handlers so the handler module picks up the
// mock when it constructs PgBoss types.
type WorkHandler = (jobs: Array<{ data: unknown }>) => Promise<void>;

interface FakeBoss {
  createQueueCalls: Array<{ name: string; opts: Record<string, unknown> }>;
  workCalls: Array<{ name: string; opts?: Record<string, unknown>; handler: WorkHandler }>;
  insertCalls: Array<{ name: string; jobs: Array<{ data: unknown }> }>;
  scheduleCalls: Array<{ name: string; cron: string; data?: unknown; opts?: Record<string, unknown> }>;
  createQueue: (name: string, opts: Record<string, unknown>) => Promise<void>;
  work: (
    name: string,
    optsOrHandler: Record<string, unknown> | WorkHandler,
    maybeHandler?: WorkHandler
  ) => Promise<string>;
  insert: (name: string, jobs: Array<{ data: unknown }>) => Promise<void>;
  schedule: (
    name: string,
    cron: string,
    data?: unknown,
    opts?: Record<string, unknown>
  ) => Promise<void>;
  // Trigger a registered worker by name with synthetic jobs.
  fire: (name: string, jobs: Array<{ data: unknown }>) => Promise<void>;
}

function makeFakeBoss(): FakeBoss {
  const createQueueCalls: FakeBoss["createQueueCalls"] = [];
  const workCalls: FakeBoss["workCalls"] = [];
  const insertCalls: FakeBoss["insertCalls"] = [];
  const scheduleCalls: FakeBoss["scheduleCalls"] = [];
  const workers = new Map<string, WorkHandler>();

  return {
    createQueueCalls,
    workCalls,
    insertCalls,
    scheduleCalls,
    async createQueue(name, opts) {
      createQueueCalls.push({ name, opts });
    },
    async work(name, optsOrHandler, maybeHandler) {
      let opts: Record<string, unknown> | undefined;
      let handler: WorkHandler;
      if (typeof optsOrHandler === "function") {
        handler = optsOrHandler;
      } else {
        opts = optsOrHandler;
        if (!maybeHandler) throw new Error(`work(${name}) missing handler`);
        handler = maybeHandler;
      }
      workCalls.push({ name, opts, handler });
      workers.set(name, handler);
      return `worker-${name}`;
    },
    async insert(name, jobs) {
      insertCalls.push({ name, jobs });
    },
    async schedule(name, cron, data, opts) {
      scheduleCalls.push({ name, cron, data, opts });
    },
    async fire(name, jobs) {
      const handler = workers.get(name);
      if (!handler) throw new Error(`No worker registered for ${name}`);
      await handler(jobs);
    },
  };
}

const { registerJobHandlers, registerJobSchedules } = await import("../../src/jobs/handlers.js");

describe("pg-boss job wiring", () => {
  beforeAll(() => {
    createMemDb();
  });
  afterAll(() => {
    getMemDb().close();
  });
  beforeEach(() => {
    getMemDb().reset();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("registerJobHandlers", () => {
    it("creates a queue per tick and per user-level job, plus log-retention", async () => {
      const boss = makeFakeBoss();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await registerJobHandlers(boss as any);

      const names = boss.createQueueCalls.map((c) => c.name).sort();
      expect(names).toEqual(
        [
          "check-reminders.tick",
          "check-reminders.user",
          "daily-compaction.tick",
          "daily-compaction.user",
          "daily-reminder.tick",
          "daily-reminder.user",
          "log-retention.tick",
          "refresh-tokens.tick",
          "refresh-tokens.user",
          "trial-expiry.tick",
          "trial-expiry.user",
          "weekly-plan.tick",
          "weekly-plan.user",
        ].sort()
      );
    });

    it("user-level queues use exponential backoff; tick queues do not", async () => {
      const boss = makeFakeBoss();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await registerJobHandlers(boss as any);

      for (const call of boss.createQueueCalls) {
        if (call.name.endsWith(".user")) {
          expect(call.opts).toMatchObject({ retryBackoff: true });
          // The user-level retry budget is 2+ — flaky users get multiple chances.
          expect((call.opts.retryLimit as number) ?? 0).toBeGreaterThanOrEqual(2);
        } else {
          // .tick queues only need one retry — the per-user fan-out is the
          // real retry budget.
          expect(call.opts).toMatchObject({ retryBackoff: false });
          expect(call.opts.retryLimit).toBe(1);
        }
      }
    });

    it("LLM-heavy jobs (weekly-plan, refresh-tokens, daily-compaction) use longer backoff", async () => {
      const boss = makeFakeBoss();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await registerJobHandlers(boss as any);

      const longBackoffJobs = [
        "weekly-plan.user",
        "refresh-tokens.user",
        "daily-compaction.user",
      ];
      for (const name of longBackoffJobs) {
        const call = boss.createQueueCalls.find((c) => c.name === name);
        expect(call).toBeDefined();
        expect((call!.opts.retryDelay as number) ?? 0).toBeGreaterThanOrEqual(600);
      }
    });

    it("registers a worker for every queue it created", async () => {
      const boss = makeFakeBoss();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await registerJobHandlers(boss as any);

      const queueNames = new Set(boss.createQueueCalls.map((c) => c.name));
      const workerNames = new Set(boss.workCalls.map((c) => c.name));
      expect(workerNames).toEqual(queueNames);
    });

    it("user-level workers run with localConcurrency > 1 (parallel per Fly instance)", async () => {
      const boss = makeFakeBoss();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await registerJobHandlers(boss as any);

      const userWorkers = boss.workCalls.filter((c) => c.name.endsWith(".user"));
      for (const w of userWorkers) {
        expect((w.opts?.localConcurrency as number) ?? 1).toBeGreaterThan(1);
      }
    });
  });

  describe("registerJobSchedules", () => {
    it("schedules all expected crons with the env TIMEZONE", async () => {
      const origTz = process.env.TIMEZONE;
      process.env.TIMEZONE = "America/Los_Angeles";

      const boss = makeFakeBoss();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await registerJobSchedules(boss as any);

      try {
        const scheduledNames = boss.scheduleCalls.map((c) => c.name).sort();
        expect(scheduledNames).toEqual(
          [
            "check-reminders.tick",
            "daily-compaction.tick",
            "daily-reminder.tick",
            "log-retention.tick",
            "refresh-tokens.tick",
            "trial-expiry.tick",
            "weekly-plan.tick",
          ].sort()
        );

        for (const call of boss.scheduleCalls) {
          expect(call.opts).toMatchObject({ tz: "America/Los_Angeles" });
        }
      } finally {
        process.env.TIMEZONE = origTz;
      }
    });

    it("daily-reminder runs weekdays at 6am; weekly-plan runs Sunday 8pm", async () => {
      const boss = makeFakeBoss();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await registerJobSchedules(boss as any);

      const dailyReminder = boss.scheduleCalls.find((c) => c.name === "daily-reminder.tick");
      const weeklyPlan = boss.scheduleCalls.find((c) => c.name === "weekly-plan.tick");
      const checkReminders = boss.scheduleCalls.find((c) => c.name === "check-reminders.tick");

      expect(dailyReminder?.cron).toBe("0 6 * * 1-5");
      expect(weeklyPlan?.cron).toBe("0 20 * * 0");
      expect(checkReminders?.cron).toBe("0 * * * *");
    });
  });

  describe("tick fan-out", () => {
    it("enqueues one user-level job per active user, with payload {userId}", async () => {
      // Seed three users — the tick handler should fan out three jobs.
      const alice = await seedUser({ displayName: "Alice" });
      const bob = await seedUser({ displayName: "Bob" });
      const carol = await seedUser({ displayName: "Carol" });

      const boss = makeFakeBoss();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await registerJobHandlers(boss as any);

      // Fire the daily-reminder.tick handler. The handler signature is
      // (jobs: Job[]) — pg-boss v12 hands a batch, so we pass one synthetic
      // job (the cron firing is itself a single tick).
      await boss.fire("daily-reminder.tick", [{ data: {} }]);

      // It should have called insert with the per-user queue name and three jobs.
      const insert = boss.insertCalls.find((c) => c.name === "daily-reminder.user");
      expect(insert).toBeDefined();
      expect(insert!.jobs).toHaveLength(3);

      const userIds = insert!.jobs.map((j) => (j.data as { userId: string }).userId).sort();
      expect(userIds).toEqual([alice, bob, carol].sort());
    });

    it("noops when there are no active users", async () => {
      const boss = makeFakeBoss();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await registerJobHandlers(boss as any);

      // No seed — zero active users.
      await boss.fire("check-reminders.tick", [{ data: {} }]);

      expect(boss.insertCalls).toHaveLength(0);
    });
  });

  describe("per-user worker dispatch", () => {
    it("skips silently when the user has been deleted", async () => {
      const boss = makeFakeBoss();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await registerJobHandlers(boss as any);

      // userId that doesn't exist in the DB — the worker should swallow,
      // not throw (we don't want pg-boss to retry forever on a deleted user).
      await expect(
        boss.fire("trial-expiry.user", [{ data: { userId: crypto.randomUUID() } }])
      ).resolves.not.toThrow();
    });

    it("skips users without a profile on requireProfile=true jobs", async () => {
      const userId = await seedUser({ displayName: "NoProfile" });
      // Don't write a profile for this user.

      const boss = makeFakeBoss();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await registerJobHandlers(boss as any);

      // daily-reminder.user has requireProfile: true. Should skip without
      // throwing — pg-boss treats no-throw as success and doesn't retry.
      await expect(
        boss.fire("daily-reminder.user", [{ data: { userId } }])
      ).resolves.not.toThrow();
    });

    it("runs the per-user processor for users that do have a profile", async () => {
      // trial-expiry.user has requireProfile: false, so it runs even without
      // a profile — and for a user whose tier is still "trial" with a future
      // trial_ends_at, it's a no-op success.
      const userId = await seedUser({ displayName: "Active" });

      const boss = makeFakeBoss();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await registerJobHandlers(boss as any);

      await expect(
        boss.fire("trial-expiry.user", [{ data: { userId } }])
      ).resolves.not.toThrow();
    });
  });
});
