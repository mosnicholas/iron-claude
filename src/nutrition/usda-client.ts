/**
 * USDA FoodData Central API client.
 *
 * Free at https://fdc.nal.usda.gov/api-key-signup.html. Without USDA_API_KEY
 * we fall back to "DEMO_KEY" — works but rate-limited to 30 req/hr per IP.
 *
 * We use /foods/search and return the top matches across data types
 * (Foundation > SR Legacy > Branded — Foundation is the most reliable for
 * generic single-ingredient foods).
 */

const USDA_BASE = "https://api.nal.usda.gov/fdc/v1";

const NUTRIENT_IDS = {
  PROTEIN: 1003,
  FAT: 1004,
  CARBS: 1005,
  ENERGY_KCAL: 1008,
  FIBER: 1079,
} as const;

export interface FoodMatch {
  fdcId: number;
  description: string;
  brandOwner?: string;
  dataType: string;
  servingSize?: number;
  servingSizeUnit?: string;
  /** Macros per 100g of the food. */
  per100g: {
    kcal: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    fiber_g?: number;
  };
}

interface UsdaApiNutrient {
  nutrientId?: number;
  nutrientNumber?: string;
  nutrientName?: string;
  unitName?: string;
  value?: number;
}

interface UsdaApiFood {
  fdcId: number;
  description: string;
  brandOwner?: string;
  dataType: string;
  servingSize?: number;
  servingSizeUnit?: string;
  foodNutrients?: UsdaApiNutrient[];
}

interface UsdaSearchResponse {
  foods?: UsdaApiFood[];
}

export function parseFoodNutrients(food: UsdaApiFood): FoodMatch {
  const valueOf = (id: number): number => {
    const n = (food.foodNutrients || []).find(
      (x) => x.nutrientId === id || x.nutrientNumber === String(id)
    );
    return typeof n?.value === "number" ? n.value : 0;
  };
  const fiber = valueOf(NUTRIENT_IDS.FIBER);
  return {
    fdcId: food.fdcId,
    description: food.description,
    brandOwner: food.brandOwner,
    dataType: food.dataType,
    servingSize: food.servingSize,
    servingSizeUnit: food.servingSizeUnit,
    per100g: {
      kcal: Math.round(valueOf(NUTRIENT_IDS.ENERGY_KCAL)),
      protein_g: round1(valueOf(NUTRIENT_IDS.PROTEIN)),
      carbs_g: round1(valueOf(NUTRIENT_IDS.CARBS)),
      fat_g: round1(valueOf(NUTRIENT_IDS.FAT)),
      fiber_g: fiber > 0 ? round1(fiber) : undefined,
    },
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export async function searchFoods(query: string, limit = 5): Promise<FoodMatch[]> {
  const apiKey = process.env.USDA_API_KEY || "DEMO_KEY";
  const params = new URLSearchParams({
    api_key: apiKey,
    query,
    pageSize: String(limit),
    dataType: "Foundation,SR Legacy,Branded",
  });
  const res = await fetch(`${USDA_BASE}/foods/search?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`USDA API ${res.status}: ${await res.text().catch(() => "")}`.trim());
  }
  const data = (await res.json()) as UsdaSearchResponse;
  return (data.foods || []).map(parseFoodNutrients);
}
