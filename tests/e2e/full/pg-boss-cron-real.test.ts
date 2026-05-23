/**
 * Full e2e — real pg-boss fan-out, the part that pg-mem couldn't cover.
 *
 * Verifies the tick → user fan-out actually creates per-user jobs in the
 * `pgboss.job` table. Five users get seeded; we send check-reminders.tick
 * once; pg-boss should enqueue exactly five `check-reminders.user` jobs and
 * run each successfully.
 *
 * No reminders are due, so no Telegram messages should fly. (If any did, the
 * test would still pass — the assertion is on job count, not on bot output.)
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import { Pool } from "pg";
import { E2EHarness } from "../harness/index.js";
import { seedUser } from "../harness/builders.js";
import { eventually } from "../harness/waiters.js";
import { getBoss } from "../../../src/jobs/queue.js";

describe("e2e full / pg-boss real fan-out", () => {
  let env: E2EHarness;

  beforeAll(async () => {
    env = await E2EHarness.start();
  });

  afterAll(async () => {
    await env.stop();
  });

  beforeEach(async () => {
    await env.beforeEach();
  });

  it("tick fans out one .user job per active user and each completes", async () => {
    // Seed 5 users with profiles + telegram chat ids.
    const chatIdBase = 9400;
    for (let i = 0; i < 5; i++) {
      await seedUser({
        displayName: `BatchAthlete${i}`,
        timezone: "America/New_York",
        telegramChatId: String(chatIdBase + i),
        profileBody: "## Goals\nstrength\n## Equipment\nfull gym\n## Schedule\n3x/week",
      });
    }

    const boss = await getBoss();
    await boss.send("check-reminders.tick", {});

    // pg-boss writes jobs to `pgboss.job`. Eventually 5 user jobs should be
    // visible (in any state — pending or completed).
    const dbUrl = process.env.DATABASE_URL!;
    const pool = new Pool({ connectionString: dbUrl, max: 1 });
    try {
      await eventually(
        async () => {
          const { rows } = await pool.query(
            `SELECT COUNT(*)::int AS n FROM pgboss.job WHERE name = $1`,
            ["check-reminders.user"]
          );
          return rows[0].n >= 5 && rows;
        },
        { timeoutMs: 30_000, pollIntervalMs: 250, label: "5 .user jobs created" }
      );

      // Each .user job should eventually reach a terminal success state
      // (`completed`). pg-boss v12 uses "completed" as the success state.
      await eventually(
        async () => {
          const { rows } = await pool.query(
            `SELECT state, COUNT(*)::int AS n
             FROM pgboss.job
             WHERE name = $1
             GROUP BY state`,
            ["check-reminders.user"]
          );
          const stateCounts: Record<string, number> = {};
          for (const r of rows) stateCounts[r.state as string] = r.n as number;
          // All 5 must be in a terminal-good state. pg-boss writes to
          // `pgboss.archive` on completion — so we accept either: 5 still in
          // `job` table as `completed`, or 0 in `job` and 5 in `archive`.
          const totalInJob = Object.values(stateCounts).reduce((a, b) => a + b, 0);
          if (totalInJob === 5 && (stateCounts.completed ?? 0) === 5) return true;
          if (totalInJob === 0) {
            const { rows: arch } = await pool.query(
              `SELECT COUNT(*)::int AS n FROM pgboss.archive WHERE name = $1 AND state = $2`,
              ["check-reminders.user", "completed"]
            );
            if ((arch[0]?.n ?? 0) >= 5) return true;
          }
          return false;
        },
        { timeoutMs: 30_000, pollIntervalMs: 250, label: "5 .user jobs completed" }
      );

      // No reminders were seeded → no telegram messages should be sent.
      expect(env.telegram.callsTo("sendMessage").length).toBe(0);
    } finally {
      await pool.end();
    }
  }, 90_000);
});
