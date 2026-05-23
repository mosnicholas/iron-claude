import {
  getWeightUnit,
  toDisplayWeight,
  fromDisplayWeight,
  getPlateMilestones,
  getMilestoneNames,
} from "./weight-config.js";

describe("weight-config", () => {
  const originalEnv = process.env.WEIGHT_UNIT;

  afterEach(() => {
    process.env.WEIGHT_UNIT = originalEnv;
  });

  it("getWeightUnit defaults to lbs and respects WEIGHT_UNIT=kg (case-insensitive)", () => {
    delete process.env.WEIGHT_UNIT;
    expect(getWeightUnit()).toBe("lbs");
    process.env.WEIGHT_UNIT = "invalid";
    expect(getWeightUnit()).toBe("lbs");
    process.env.WEIGHT_UNIT = "KG";
    expect(getWeightUnit()).toBe("kg");
  });

  it("toDisplayWeight is identity in lbs mode and converts lbs→kg in kg mode", () => {
    delete process.env.WEIGHT_UNIT;
    expect(toDisplayWeight(225)).toBe(225);

    process.env.WEIGHT_UNIT = "kg";
    // 225 lbs ≈ 102.06 kg, rounded to one decimal
    expect(toDisplayWeight(225)).toBeCloseTo(102.1, 1);
    expect(toDisplayWeight(135)).toBeCloseTo(61.2, 1);
  });

  it("fromDisplayWeight inverts toDisplayWeight", () => {
    delete process.env.WEIGHT_UNIT;
    expect(fromDisplayWeight(225)).toBe(225);

    process.env.WEIGHT_UNIT = "kg";
    // 100 kg ≈ 220.46 lbs
    expect(fromDisplayWeight(100)).toBeCloseTo(220.5, 1);
  });

  it("getPlateMilestones returns the unit-appropriate table", () => {
    delete process.env.WEIGHT_UNIT;
    expect(getPlateMilestones().bench_press).toContain(135);

    process.env.WEIGHT_UNIT = "kg";
    expect(getPlateMilestones().bench_press).toContain(100);
  });

  it("getMilestoneNames keys match the active unit", () => {
    delete process.env.WEIGHT_UNIT;
    expect(getMilestoneNames()[225]).toBe("Two plate club");

    process.env.WEIGHT_UNIT = "kg";
    expect(getMilestoneNames()[100]).toBe("Two plate club");
  });
});
