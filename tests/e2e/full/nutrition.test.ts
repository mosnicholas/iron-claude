/**
 * Full e2e — nutrition logging via the lookup_food → log_meal flow.
 *
 * The agent is supposed to ground macros in USDA data BEFORE logging. We
 * exercise the real USDA API (DEMO_KEY fallback when USDA_API_KEY isn't set)
 * and assert that a meal row + item rows actually landed in Postgres.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import { eq } from "drizzle-orm";
import { E2EHarness } from "../harness/index.js";
import { seedUser } from "../harness/builders.js";
import { eventually } from "../harness/waiters.js";
import { getDb } from "../../../src/db/client.js";
import { meals, mealItems } from "../../../src/db/schema.js";
import { getStorage } from "../../../src/storage/db.js";
import { getDateInfoTZAware } from "../../../src/utils/date.js";

const HAS_API_KEY = !!process.env.ANTHROPIC_API_KEY;
const describeMaybe = HAS_API_KEY ? describe : describe.skip;

describeMaybe("e2e full / nutrition logging", () => {
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

  it("logs a meal via lookup_food + log_meal", async () => {
    const user = await seedUser({
      displayName: "NutritionAthlete",
      timezone: "America/New_York",
      telegramChatId: "9101",
      profileBody:
        "## Goals\nlean bulk\n## Equipment\nfull gym\n## Schedule\n4x/week\n## Nutrition\nprotein_g: 180\nkcal: 2800",
    });

    try {
      const res = await env.sendTelegramUpdate({
        chatId: 9101,
        text: "had 3 scrambled eggs for breakfast",
        updateId: 91011,
      });
      expect(res.status).toBe(200);

      // The agent should: lookup_food("eggs") → log_meal(...).
      // Assert structurally on the rows that resulted.
      const meal = await eventually(
        async () => {
          const db = getDb();
          const rows = await db.select().from(meals).where(eq(meals.userId, user.id));
          if (rows.length === 0) return null;
          return rows[0];
        },
        { timeoutMs: 90_000, label: "meal row inserted by log_meal" }
      );

      // Label is model-chosen — accept any casing that contains "breakfast".
      expect(meal.label.toLowerCase()).toContain("breakfast");

      const db = getDb();
      const items = await db.select().from(mealItems).where(eq(mealItems.mealId, meal.id));
      expect(items.length).toBeGreaterThanOrEqual(1);

      // Daily rollup must show non-zero protein + kcal (eggs are
      // protein-positive in any sane USDA result).
      const dateInfo = getDateInfoTZAware(user.timezone ?? "America/New_York");
      const rollup = await getStorage().getDailyNutritionRollup(user.id, dateInfo.date);
      expect(rollup).not.toBeNull();
      expect(rollup!.protein_g).toBeGreaterThan(0);
      expect(rollup!.kcal).toBeGreaterThan(0);
    } catch (err) {
      env.printTimeline("nutrition failure");
      throw err;
    }
  }, 180_000);
});
