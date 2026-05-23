/**
 * Nutrition tools — food lookup and meal logging.
 *
 * Daily nutrition lives in the same per-day file as the workout
 * (weeks/YYYY-WXX/YYYY-MM-DD.md) under a `## Nutrition` section.
 * Frontmatter gets rollup fields (protein_g, kcal, carbs_g, fat_g) so other
 * tools can read daily totals without re-parsing the meal body.
 *
 * Macro grounding: log_meal requires protein_g and kcal per item. The model
 * is expected to call lookup_food first and base its numbers on USDA results —
 * this is what kills the fabrication the bot was doing before.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { defineTool } from "../tool.js";
import { writeAndCommit, formatCommitStatus } from "../git.js";
import { parseFrontmatter, serializeFrontmatter } from "../../integrations/storage.js";
import { calendarInfoFor, getCurrentWeek, getDateInfoTZAware, getToday } from "../../utils/date.js";
import { searchFoods } from "../../nutrition/usda-client.js";

// ─────────────────────────────────────────────────────────────────────────────
// Path helper — same per-day file as workouts, just may not contain a workout.
// ─────────────────────────────────────────────────────────────────────────────

interface DailyFile {
  path: string;
  relative: string;
  week: string;
  date: string;
  dayName: string;
  isBackfill: boolean;
}

function dailyFilePath(repoPath: string, timezone: string, explicitDate?: string): DailyFile {
  const today = getToday(timezone);
  if (explicitDate && explicitDate !== today) {
    const info = calendarInfoFor(explicitDate);
    const relative = `weeks/${info.week}/${info.date}.md`;
    return {
      path: join(repoPath, relative),
      relative,
      week: info.week,
      date: info.date,
      dayName: info.dayName,
      isBackfill: true,
    };
  }
  const week = getCurrentWeek(timezone);
  const dayName = getDateInfoTZAware().dayOfWeek;
  const relative = `weeks/${week}/${today}.md`;
  return {
    path: join(repoPath, relative),
    relative,
    week,
    date: today,
    dayName,
    isBackfill: false,
  };
}

function buildFile(fm: Record<string, unknown>, body: string): string {
  const fmBlock = serializeFrontmatter(fm);
  const bodyClean = body.startsWith("\n") ? body : "\n" + body;
  return `${fmBlock}${bodyClean}`;
}

const DateOverrideSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
  .optional()
  .describe(
    "Optional YYYY-MM-DD override for back-filling a past meal (e.g. logging yesterday's dinner). Defaults to today."
  );

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

export const logMeal = defineTool({
  name: "log_meal",
  description:
    "Log a meal to the day's file (weeks/YYYY-WXX/YYYY-MM-DD.md) under ## Nutrition. " +
    "Each item must include protein_g and kcal — call lookup_food first to ground them. " +
    "Frontmatter rollups (protein_g, kcal, carbs_g, fat_g) are recomputed by summing every " +
    "meal subtotal in the file. Defaults to today; pass `date` to log into a past day. " +
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
    const { path, relative, date, dayName } = dailyFilePath(ctx.repoPath, ctx.timezone, input.date);
    const nowInfo = getDateInfoTZAware();
    const time = input.date && input.date !== nowInfo.date ? "—" : nowInfo.time;

    const mealProtein = round1(input.items.reduce((s, i) => s + i.protein_g, 0));
    const mealKcal = Math.round(input.items.reduce((s, i) => s + i.kcal, 0));
    const mealCarbs = sumOptional(input.items.map((i) => i.carbs_g));
    const mealFat = sumOptional(input.items.map((i) => i.fat_g));

    const itemLines = input.items.map((i) => {
      const extras: string[] = [];
      if (i.carbs_g !== undefined) extras.push(`${round1(i.carbs_g)}g C`);
      if (i.fat_g !== undefined) extras.push(`${round1(i.fat_g)}g F`);
      const extra = extras.length ? `, ${extras.join(", ")}` : "";
      return `- ${i.food} — ${round1(i.protein_g)}g protein, ${Math.round(i.kcal)} kcal${extra}`;
    });
    const subtotalParts = [
      `${mealProtein}g protein`,
      `${mealKcal} kcal`,
      mealCarbs !== null ? `${mealCarbs}g C` : null,
      mealFat !== null ? `${mealFat}g F` : null,
    ].filter((s): s is string => s !== null);
    const subtotalLine = `_Subtotal: ${subtotalParts.join(", ")}_`;
    const notes = input.notes ? `\n${input.notes}` : "";
    const newSection = `### ${input.meal} (${time})\n${itemLines.join("\n")}\n${subtotalLine}${notes}`;

    let frontmatter: Record<string, unknown>;
    let content: string;
    if (existsSync(path)) {
      const raw = readFileSync(path, "utf-8");
      const parsed = parseFrontmatter(raw);
      frontmatter = parsed.frontmatter as Record<string, unknown>;
      content = parsed.content;
    } else {
      frontmatter = { date };
      content = `# ${dayName}, ${date}\n`;
    }

    content = appendOrCreateNutritionSection(content, newSection);

    const rollup = computeDailyRollup(content);
    frontmatter.protein_g = rollup.protein_g;
    frontmatter.kcal = rollup.kcal;
    if (rollup.carbs_g !== null) frontmatter.carbs_g = rollup.carbs_g;
    if (rollup.fat_g !== null) frontmatter.fat_g = rollup.fat_g;

    const final = buildFile(frontmatter, content);
    const result = await writeAndCommit(
      ctx.repoPath,
      relative,
      final,
      `Log ${input.meal} on ${date}`
    );
    if (result.noop) {
      return `No change — meal already present in file.`;
    }
    return [
      `Logged ${input.meal} (${input.items.length} item${input.items.length === 1 ? "" : "s"}): ${mealProtein}g protein, ${mealKcal} kcal.`,
      `Daily total so far: ${rollup.protein_g}g protein, ${rollup.kcal} kcal.`,
      formatCommitStatus(result),
    ].join("\n");
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function sumOptional(values: (number | undefined)[]): number | null {
  const present = values.filter((v): v is number => typeof v === "number");
  if (present.length === 0) return null;
  return round1(present.reduce((s, v) => s + v, 0));
}

function appendOrCreateNutritionSection(content: string, mealMarkdown: string): string {
  const lines = content.split("\n");
  const start = lines.findIndex((l) => /^## Nutrition\s*$/.test(l));
  if (start >= 0) {
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^##\s/.test(lines[i])) {
        end = i;
        break;
      }
    }
    // Drop trailing blanks inside the section before inserting.
    let insertAt = end;
    while (insertAt > start + 1 && lines[insertAt - 1].trim() === "") insertAt--;
    const before = lines.slice(0, insertAt);
    const after = lines.slice(insertAt);
    return [...before, "", mealMarkdown, "", ...after].join("\n").replace(/\n{3,}/g, "\n\n");
  }
  // No section yet — insert before ## Exercises if present, else at end.
  const exercisesIdx = lines.findIndex((l) => /^## Exercises\s*$/.test(l));
  const block = `## Nutrition\n\n${mealMarkdown}`;
  if (exercisesIdx >= 0) {
    const before = lines.slice(0, exercisesIdx);
    const after = lines.slice(exercisesIdx);
    return [...before, block, "", ...after].join("\n").replace(/\n{3,}/g, "\n\n");
  }
  return (content.trimEnd() + `\n\n${block}\n`).replace(/\n{3,}/g, "\n\n");
}

interface DailyRollup {
  protein_g: number;
  kcal: number;
  carbs_g: number | null;
  fat_g: number | null;
}

function computeDailyRollup(content: string): DailyRollup {
  // Sum every "Subtotal: ..." line in the file. Order of fields is fixed by
  // how we emit them above, but we parse with a tolerant regex so the model
  // can hand-edit the file without breaking rollups.
  const re =
    /Subtotal:\s*([\d.]+)g\s*protein,\s*([\d.]+)\s*kcal(?:,\s*([\d.]+)g\s*C)?(?:,\s*([\d.]+)g\s*F)?/gi;
  let protein = 0;
  let kcal = 0;
  let carbs = 0;
  let fat = 0;
  let hasCarbs = false;
  let hasFat = false;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    protein += parseFloat(match[1]);
    kcal += parseFloat(match[2]);
    if (match[3] !== undefined) {
      carbs += parseFloat(match[3]);
      hasCarbs = true;
    }
    if (match[4] !== undefined) {
      fat += parseFloat(match[4]);
      hasFat = true;
    }
  }
  return {
    protein_g: round1(protein),
    kcal: Math.round(kcal),
    carbs_g: hasCarbs ? round1(carbs) : null,
    fat_g: hasFat ? round1(fat) : null,
  };
}

export const NUTRITION_TOOLS = [lookupFood, logMeal];

// Exported for unit tests.
export const __internal = {
  appendOrCreateNutritionSection,
  computeDailyRollup,
};
