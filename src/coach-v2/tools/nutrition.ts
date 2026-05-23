/**
 * Nutrition tools — food lookup and meal logging.
 *
 * Meals live in the `meals` + `meal_items` tables, keyed by `(user_id, date)`.
 * The coach's prompt surfaces today's rolled-up macros via
 * `Storage.getDailyNutritionRollup` (see context-loader.ts), so the agent
 * doesn't need to call a tool just to see daily totals.
 *
 * Macro grounding: log_meal requires `protein_g` and `kcal` per item. The
 * model is expected to call `lookup_food` first and base its numbers on
 * USDA results — that's what stops the bot from fabricating macros.
 */

import { z } from "zod";
import { defineTool } from "../tool.js";
import { calendarInfoFor, getCurrentWeek, getDateInfoTZAware, getToday } from "../../utils/date.js";
import { searchFoods } from "../../nutrition/usda-client.js";

const DateOverrideSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
  .optional()
  .describe(
    "Optional YYYY-MM-DD override for back-filling a past meal (e.g. logging yesterday's dinner). Defaults to today."
  );

function dateInfoFor(timezone: string, explicitDate?: string): {
  date: string;
  isoWeek: string;
  isBackfill: boolean;
} {
  const today = getToday(timezone);
  if (explicitDate && explicitDate !== today) {
    const info = calendarInfoFor(explicitDate);
    return { date: info.date, isoWeek: info.week, isBackfill: true };
  }
  return { date: today, isoWeek: getCurrentWeek(timezone), isBackfill: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// lookup_food
// ─────────────────────────────────────────────────────────────────────────────

export const lookupFood = defineTool({
  name: "lookup_food",
  description:
    "Search USDA FoodData Central for nutrition info. Returns top matches with per-100g " +
    "macros. ALWAYS call this before log_meal — never fabricate macro values. Pick the " +
    "closest match by description, preferring Foundation > SR Legacy > Branded data for " +
    "generic foods. When the athlete reports portion sizes (e.g. '3 eggs'), scale the " +
    "per-100g values by the portion you estimate. Standard reference weights: 1 large egg " +
    "~50g, 1 slice bread ~28g, 1 slice deli ham ~28g, 1 oz chicken breast ~28g.",
  schema: z.object({
    query: z
      .string()
      .describe(
        "Food to search for. Use simple noun phrases — 'eggs', 'whole wheat bread', 'chicken breast cooked'. Avoid quantities ('3 eggs') — search the food, then scale."
      ),
    limit: z.number().int().min(1).max(10).default(5).describe("How many matches to return."),
  }),
  handler: async (input) => {
    const limit = input.limit ?? 5;
    try {
      const matches = await searchFoods(input.query, limit);
      if (matches.length === 0) {
        return `No USDA matches for "${input.query}". Try a simpler query — e.g. "eggs" instead of "3 scrambled eggs".`;
      }
      const lines = matches.map((m, i) => {
        const n = m.per100g;
        const serving = m.servingSize
          ? ` (serving: ${m.servingSize}${m.servingSizeUnit || ""})`
          : "";
        const fiber = n.fiber_g ? `, ${n.fiber_g}g fiber` : "";
        return (
          `${i + 1}. ${m.description} [${m.dataType}]${serving}\n` +
          `   Per 100g: ${n.kcal} kcal, ${n.protein_g}g protein, ${n.carbs_g}g carbs, ${n.fat_g}g fat${fiber}`
        );
      });
      return lines.join("\n\n");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return (
        `lookup_food error: ${msg}. ` +
        `If USDA is unreachable, ask the athlete for portion size and explicitly flag your macros as estimates rather than logging fabricated numbers.`
      );
    }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// log_meal
// ─────────────────────────────────────────────────────────────────────────────

const FoodItemSchema = z.object({
  food: z
    .string()
    .describe(
      "Item as the athlete would read it, e.g. '3 scrambled eggs' or '1 slice whole wheat toast'"
    ),
  protein_g: z
    .number()
    .nonnegative()
    .describe("Protein grams for this item (grounded via lookup_food)"),
  kcal: z.number().nonnegative().describe("Calories for this item (grounded via lookup_food)"),
  carbs_g: z.number().nonnegative().optional().describe("Carb grams, if known"),
  fat_g: z.number().nonnegative().optional().describe("Fat grams, if known"),
});

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export const logMeal = defineTool({
  name: "log_meal",
  description:
    "Log a meal to the day's nutrition record. " +
    "Each item must include protein_g and kcal — call lookup_food first to ground them. " +
    "The coach prompt surfaces the running daily total automatically, so don't compute it " +
    "yourself. Defaults to today; pass `date` to log into a past day. " +
    "ALWAYS call this when the athlete reports eating — never just respond in text with macros.",
  schema: z.object({
    meal: z
      .string()
      .describe(
        "Meal label, e.g. 'Breakfast', 'Lunch', 'Dinner', 'Snack', 'Pre-workout', 'Post-workout'."
      ),
    items: z
      .array(FoodItemSchema)
      .min(1)
      .describe("Food items in this meal, each with grounded macros."),
    notes: z
      .string()
      .optional()
      .describe("Optional one-line note, e.g. 'felt heavy', 'rushed between meetings'."),
    date: DateOverrideSchema,
  }),
  handler: async (input, ctx) => {
    const { date, isoWeek, isBackfill } = dateInfoFor(ctx.timezone, input.date);
    const nowInfo = getDateInfoTZAware();
    const loggedAt = isBackfill ? undefined : nowInfo.time;

    const mealProtein = round1(input.items.reduce((s, i) => s + i.protein_g, 0));
    const mealKcal = Math.round(input.items.reduce((s, i) => s + i.kcal, 0));

    await ctx.storage.logMeal(ctx.userId, {
      date,
      isoWeek,
      label: input.meal,
      loggedAt,
      notes: input.notes,
      items: input.items.map((it) => ({
        food: it.food,
        proteinG: it.protein_g,
        kcal: it.kcal,
        carbsG: it.carbs_g,
        fatG: it.fat_g,
      })),
    });

    const rollup = await ctx.storage.getDailyNutritionRollup(ctx.userId, date);
    const lines = [
      `Logged ${input.meal} (${input.items.length} item${input.items.length === 1 ? "" : "s"}): ${mealProtein}g protein, ${mealKcal} kcal.`,
    ];
    if (rollup) {
      lines.push(`Daily total so far: ${rollup.protein_g}g protein, ${rollup.kcal} kcal.`);
    }
    return lines.join("\n");
  },
});

export const NUTRITION_TOOLS = [lookupFood, logMeal];
