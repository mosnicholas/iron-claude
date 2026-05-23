/**
 * Full e2e — model selected by tier.
 *
 * The coach handler maps tier → model:
 *   - athlete / comped / trial → claude-opus-4-7
 *   - regular                  → claude-sonnet-4-6
 *
 * We verify the routing by sending one message from an athlete-tier user and
 * one from a regular-tier user, then comparing the `model` column on the
 * assistant rows in `messages`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import { asc, eq } from "drizzle-orm";
import { E2EHarness } from "../harness/index.js";
import { seedUser } from "../harness/builders.js";
import { eventually } from "../harness/waiters.js";
import { getDb } from "../../../src/db/client.js";
import { messages } from "../../../src/db/schema.js";

const HAS_API_KEY = !!process.env.ANTHROPIC_API_KEY;
const describeMaybe = HAS_API_KEY ? describe : describe.skip;

describeMaybe("e2e full / tier → model selection", () => {
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

  it("routes athlete users to Opus and regular users to Sonnet", async () => {
    const athlete = await seedUser({
      displayName: "PaidAthlete",
      tier: "athlete",
      telegramChatId: "9601",
      profileBody: "## Goals\nstrength\n## Equipment\nfull gym\n## Schedule\n4x/week",
    });
    const regular = await seedUser({
      displayName: "PaidRegular",
      tier: "regular",
      telegramChatId: "9602",
      profileBody: "## Goals\nstrength\n## Equipment\nfull gym\n## Schedule\n3x/week",
    });

    try {
      const [a, r] = await Promise.all([
        env.sendTelegramUpdate({ chatId: 9601, text: "what should I train today?", updateId: 96011 }),
        env.sendTelegramUpdate({ chatId: 9602, text: "what should I train today?", updateId: 96021 }),
      ]);
      expect(a.status).toBe(200);
      expect(r.status).toBe(200);

      // Wait for both assistant rows to land with their `model` columns set.
      const { athleteModel, regularModel } = await eventually(
        async () => {
          const db = getDb();
          const aRows = await db
            .select()
            .from(messages)
            .where(eq(messages.userId, athlete.id))
            .orderBy(asc(messages.ts));
          const rRows = await db
            .select()
            .from(messages)
            .where(eq(messages.userId, regular.id))
            .orderBy(asc(messages.ts));
          const aAssist = aRows.find((m) => m.role === "assistant" && m.model);
          const rAssist = rRows.find((m) => m.role === "assistant" && m.model);
          if (!aAssist?.model || !rAssist?.model) return null;
          return { athleteModel: aAssist.model, regularModel: rAssist.model };
        },
        { timeoutMs: 120_000, pollIntervalMs: 500, label: "both tiers have an assistant row with model set" }
      );

      // We don't pin exact strings (model names may bump). The structural
      // assertion is: they must DIFFER, AND the athlete should be on an
      // Opus-family model while the regular should be on Sonnet.
      expect(athleteModel).not.toBe(regularModel);
      expect(athleteModel.toLowerCase()).toContain("opus");
      expect(regularModel.toLowerCase()).toContain("sonnet");
    } catch (err) {
      env.printTimeline("tier-model-selection failure");
      throw err;
    }
  }, 300_000);
});
