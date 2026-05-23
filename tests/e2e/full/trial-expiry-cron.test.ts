/**
 * Full e2e — trial-expiry job (pg-boss tick → user fan-out).
 *
 * The harness boots pg-boss with `skipSchedules: true`, so the daily cron
 * never fires automatically. We manually enqueue `trial-expiry.tick`, the
 * registered handler fans out one `.user` job per active user, the per-user
 * job flips tier→expired for users past their trial deadline, and the user
 * gets a "subscribe" prompt via the bot.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import { E2EHarness } from "../harness/index.js";
import { seedUser, reloadUser } from "../harness/builders.js";
import { eventually } from "../harness/waiters.js";
import { getBoss } from "../../../src/jobs/queue.js";

describe("e2e full / trial-expiry pg-boss job", () => {
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

  it("flips tier=trial+expired users to expired and notifies them", async () => {
    // Seed a user whose trial ends yesterday — eligible for expiry.
    const user = await seedUser({
      displayName: "ExpiringAthlete",
      tier: "trial",
      telegramChatId: "9301",
      trialEndsAt: new Date(Date.now() - 24 * 3600 * 1000),
    });

    const boss = await getBoss();
    await boss.send("trial-expiry.tick", {});

    // Eventually the user's tier flips to "expired".
    await eventually(
      async () => {
        const fresh = await reloadUser(user.id);
        return fresh.tier === "expired";
      },
      { timeoutMs: 30_000, pollIntervalMs: 200, label: "trial → expired" }
    );

    // And the bot should send a "subscribe" prompt.
    await eventually(
      async () => {
        const text = env.telegram.sentText().toLowerCase();
        return text.includes("subscribe") || text.includes("trial");
      },
      { timeoutMs: 30_000, pollIntervalMs: 200, label: "subscribe/trial message sent" }
    );
  });
});
