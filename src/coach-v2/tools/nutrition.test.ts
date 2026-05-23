import { __internal } from "./nutrition.js";

const { appendOrCreateNutritionSection, computeDailyRollup } = __internal;

describe("appendOrCreateNutritionSection", () => {
  it("creates the section when absent and inserts before ## Exercises", () => {
    const before = `# Wednesday, 2026-05-21\n\n## Exercises\n\n### Bench Press\n- 175 x 5\n`;
    const meal = `### Breakfast (10:42)\n- 3 eggs — 21g protein, 220 kcal\n_Subtotal: 21g protein, 220 kcal_`;
    const result = appendOrCreateNutritionSection(before, meal);
    expect(result).toContain("## Nutrition");
    expect(result.indexOf("## Nutrition")).toBeLessThan(result.indexOf("## Exercises"));
    expect(result).toContain("3 eggs");
  });

  it("appends a second meal under an existing ## Nutrition section", () => {
    const before = `# Wednesday\n\n## Nutrition\n\n### Breakfast (08:00)\n- eggs — 10g protein, 150 kcal\n_Subtotal: 10g protein, 150 kcal_\n\n## Exercises\n`;
    const meal = `### Lunch (12:30)\n- chicken — 40g protein, 250 kcal\n_Subtotal: 40g protein, 250 kcal_`;
    const result = appendOrCreateNutritionSection(before, meal);
    expect(result.indexOf("Breakfast")).toBeLessThan(result.indexOf("Lunch"));
    expect(result.indexOf("Lunch")).toBeLessThan(result.indexOf("## Exercises"));
  });

  it("appends at the end when neither ## Nutrition nor ## Exercises exist", () => {
    const before = `# Sunday, 2026-05-24\n`;
    const meal = `### Snack (15:00)\n- apple — 0.5g protein, 95 kcal\n_Subtotal: 0.5g protein, 95 kcal_`;
    const result = appendOrCreateNutritionSection(before, meal);
    expect(result).toContain("## Nutrition");
    expect(result).toContain("apple");
  });
});

describe("computeDailyRollup", () => {
  it("sums protein and kcal across multiple subtotal lines", () => {
    const body = `### Breakfast
- eggs — 21g protein, 220 kcal
_Subtotal: 21g protein, 220 kcal_

### Lunch
- chicken — 40g protein, 250 kcal
_Subtotal: 40g protein, 250 kcal_
`;
    const rollup = computeDailyRollup(body);
    expect(rollup.protein_g).toBe(61);
    expect(rollup.kcal).toBe(470);
    expect(rollup.carbs_g).toBeNull();
    expect(rollup.fat_g).toBeNull();
  });

  it("includes carbs and fat when present in every subtotal", () => {
    const body = `_Subtotal: 30g protein, 400 kcal, 50g C, 10g F_
_Subtotal: 20g protein, 200 kcal, 10g C, 5g F_`;
    const rollup = computeDailyRollup(body);
    expect(rollup.protein_g).toBe(50);
    expect(rollup.kcal).toBe(600);
    expect(rollup.carbs_g).toBe(60);
    expect(rollup.fat_g).toBe(15);
  });

  it("returns zeros for an empty body", () => {
    expect(computeDailyRollup("")).toEqual({
      protein_g: 0,
      kcal: 0,
      carbs_g: null,
      fat_g: null,
    });
  });

  it("handles decimal protein values cleanly", () => {
    const body = `_Subtotal: 10.5g protein, 100 kcal_
_Subtotal: 9.7g protein, 80 kcal_`;
    const rollup = computeDailyRollup(body);
    expect(rollup.protein_g).toBe(20.2);
    expect(rollup.kcal).toBe(180);
  });
});
