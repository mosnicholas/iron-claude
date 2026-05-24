/**
 * Smoke: pg-boss fan-out actually creates one .user job per active user.
 *
 * Replaces the mocked tautology in tests/integration/jobs.test.ts. Drives the
 * real pg-boss instance: seed users, manually trigger `trial-expiry.tick`,
 * and observe the fan-out produce `trial-expiry.user` jobs.
 *
 * trial-expiry.tick is the cheapest pick because trial-expiry.user is a pure
 * DB operation (no LLM, no profile gate — `requireProfile: false` per
 * src/jobs/handlers.ts).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import { eq, sql } from "drizzle-orm";
import { E2EHarness } from "../harness/index.js";
import { seedUser } from "../harness/builders.js";
import { eventually } from "../harness/waiters.js";
import { getDb } from "../../../src/db/client.js";
import { users } from "../../../src/db/schema.js";
import { getBoss } from "../../../src/jobs/queue.js";

describe("e2e smoke / pg-boss fanout", () => {
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

  it("fans out one trial-expiry.user job per active user", async () => {
    // Two active users (one with profile, one without) and one inactive user.
    // listActiveUsers() filters on users.active = true, so the inactive user
    // should be skipped entirely. trial-expiry doesn't require a profile, so
    // both active users get a .user job.
    const userWithProfile = await seedUser({
      phoneE164: "+15555550701",
      profileBody: "## Goals\nstrength",
    });
    const userNoProfile = await seedUser({ phoneE164: "+15555550702" });
    const inactiveUser = await seedUser({ phoneE164: "+15555550703" });

    const db = getDb();
    await db.update(users).set({ active: false }).where(eq(users.id, inactiveUser.id));

    const boss = await getBoss();
    await boss.send("trial-expiry.tick", {});

    // pg-boss v12 keeps all jobs (including completed/expired) in pgboss.job
    // with the lifecycle in the `state` column. There is no separate archive
    // table in this version — jobs are deleted directly after `keep_until`.
    const countJobs = async (): Promise<number> => {
      const res = await db.execute(sql`
        SELECT COUNT(*)::text AS count
        FROM pgboss.job
        WHERE name = 'trial-expiry.user'
      `);
      const rows = (res as unknown as { rows: Array<{ count: string }> }).rows;
      return Number(rows?.[0]?.count ?? "0");
    };

    await eventually(
      async () => {
        const c = await countJobs();
        return c >= 2 ? c : false;
      },
      { timeoutMs: 15_000, label: "two trial-expiry.user jobs fanned out" }
    );

    // Confirm the inactive user was NOT fanned out by checking total count.
    const total = await countJobs();
    expect(total).toBe(2);

    // Reference the seeded users so unused-var lint stays quiet.
    expect(userWithProfile.id).toBeTruthy();
    expect(userNoProfile.id).toBeTruthy();
  });
});
