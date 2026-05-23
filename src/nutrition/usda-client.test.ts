import { parseFoodNutrients } from "./usda-client.js";

describe("parseFoodNutrients", () => {
  it("extracts the standard macros from a USDA Foundation food", () => {
    const food = {
      fdcId: 748967,
      description: "Egg, whole, cooked, scrambled",
      dataType: "Foundation",
      servingSize: 100,
      servingSizeUnit: "g",
      foodNutrients: [
        { nutrientId: 1003, value: 9.99, unitName: "G" },
        { nutrientId: 1004, value: 11.0, unitName: "G" },
        { nutrientId: 1005, value: 1.6, unitName: "G" },
        { nutrientId: 1008, value: 149, unitName: "KCAL" },
      ],
    };

    const parsed = parseFoodNutrients(food);
    expect(parsed.per100g.kcal).toBe(149);
    expect(parsed.per100g.protein_g).toBe(10);
    expect(parsed.per100g.fat_g).toBe(11);
    expect(parsed.per100g.carbs_g).toBe(1.6);
    expect(parsed.per100g.fiber_g).toBeUndefined();
    expect(parsed.servingSize).toBe(100);
  });

  it("falls back to nutrientNumber when nutrientId is missing (Branded foods)", () => {
    const food = {
      fdcId: 1,
      description: "Whey protein, vanilla",
      dataType: "Branded",
      foodNutrients: [
        { nutrientNumber: "1003", value: 80 },
        { nutrientNumber: "1008", value: 380 },
      ],
    };
    const parsed = parseFoodNutrients(food);
    expect(parsed.per100g.protein_g).toBe(80);
    expect(parsed.per100g.kcal).toBe(380);
    expect(parsed.per100g.fat_g).toBe(0);
  });

  it("includes fiber only when > 0", () => {
    const withFiber = parseFoodNutrients({
      fdcId: 2,
      description: "Oats",
      dataType: "Foundation",
      foodNutrients: [{ nutrientId: 1079, value: 10.6 }],
    });
    const withoutFiber = parseFoodNutrients({
      fdcId: 3,
      description: "Chicken breast",
      dataType: "Foundation",
      foodNutrients: [{ nutrientId: 1003, value: 31 }],
    });
    expect(withFiber.per100g.fiber_g).toBe(10.6);
    expect(withoutFiber.per100g.fiber_g).toBeUndefined();
  });

  it("rounds protein/carbs/fat to one decimal place", () => {
    const parsed = parseFoodNutrients({
      fdcId: 4,
      description: "Greek yogurt",
      dataType: "Foundation",
      foodNutrients: [
        { nutrientId: 1003, value: 10.123 },
        { nutrientId: 1004, value: 0.456 },
        { nutrientId: 1005, value: 3.876 },
      ],
    });
    expect(parsed.per100g.protein_g).toBe(10.1);
    expect(parsed.per100g.fat_g).toBe(0.5);
    expect(parsed.per100g.carbs_g).toBe(3.9);
  });
});
