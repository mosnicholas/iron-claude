/**
 * Integration tests for the nutrition tool path (DB-backed).
 *
 * Replaces the markdown-section-helper tests that lived alongside the
 * filesystem-based implementation; meals now have their own DB tables and
 * the rollup is computed via a SUM join.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import { eq } from "drizzle-orm";
import { createMemDb, getMemDb } from "../helpers/pgmem.js";
import { getDb } from "../../src/db/client.js";
import { meals, mealItems } from "../../src/db/schema.js";
import { getStorage } from "../../src/storage/db.js";
import { logMeal } from "../../src/coach-v2/tools/nutrition.js";
import { findOrCreateUserByChannel } from "../../src/auth/identity.js";

describe("nutrition", () => {
  let userId: string;

  beforeAll(() => {
    createMemDb();
  });
  afterAll(() => {
    getMemDb().close();
  });
  beforeEach(async () => {
    getMemDb().reset();
    const user = await findOrCreateUserByChannel("telegram", "555-nutrition");
    userId = user.id;
  });

  it("log_meal inserts a meal row + meal_items and surfaces rollup totals", async () => {
    const result = await logMeal.handler(
      {
        meal: "Breakfast",
        items: [
          { food: "3 scrambled eggs", protein_g: 21, kcal: 220, carbs_g: 1.2, fat_g: 15 },
          { food: "1 slice toast", protein_g: 4, kcal: 75, carbs_g: 14, fat_g: 1 },
        ],
        notes: undefined,
        date: undefined,
      },
      { userId, storage: getStorage(), timezone: "America/New_York", turnId: "t1", handler: "coach" }
    );
    expect(result).toContain("Logged Breakfast");
    expect(result).toContain("25g protein");
    expect(result).toContain("295 kcal");

    const allMeals = await getDb().select().from(meals).where(eq(meals.userId, userId));
    expect(allMeals).toHaveLength(1);
    const items = await getDb().select().from(mealItems).where(eq(mealItems.mealId, allMeals[0].id));
    expect(items).toHaveLength(2);
  });

  it("getDailyNutritionRollup sums across multiple meals on the same day", async () => {
    const storage = getStorage();
    const today = new Date().toISOString().slice(0, 10);
    const ctx = { userId, storage, timezone: "America/New_York", turnId: "t1", handler: "coach" };

    await logMeal.handler(
      {
        meal: "Breakfast",
        items: [{ food: "eggs", protein_g: 21, kcal: 220 }],
        notes: undefined,
        date: today,
      },
      ctx
    );
    await logMeal.handler(
      {
        meal: "Lunch",
        items: [
          { food: "chicken breast", protein_g: 40, kcal: 250, carbs_g: 0, fat_g: 6 },
        ],
        notes: undefined,
        date: today,
      },
      ctx
    );

    const rollup = await storage.getDailyNutritionRollup(userId, today);
    expect(rollup).not.toBeNull();
    expect(rollup!.protein_g).toBeCloseTo(61);
    expect(rollup!.kcal).toBe(470);
  });

  it("getDailyNutritionRollup returns null when no meals on the date", async () => {
    const rollup = await getStorage().getDailyNutritionRollup(userId, "2099-01-01");
    expect(rollup).toBeNull();
  });
});
