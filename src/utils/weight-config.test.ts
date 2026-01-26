import {
  getWeightUnit,
  getWeightUnitLabel,
  toDisplayWeight,
  fromDisplayWeight,
  getPlateMilestones,
  getMilestoneNames,
  PLATE_MILESTONES_LBS,
  PLATE_MILESTONES_KG,
} from "./weight-config.js";

describe("weight-config", () => {
  const originalEnv = process.env.WEIGHT_UNIT;

  afterEach(() => {
    process.env.WEIGHT_UNIT = originalEnv;
  });

  describe("getWeightUnit", () => {
    it("returns lbs by default", () => {
      delete process.env.WEIGHT_UNIT;
      expect(getWeightUnit()).toBe("lbs");
    });

    it("returns lbs when env is invalid", () => {
      process.env.WEIGHT_UNIT = "invalid";
      expect(getWeightUnit()).toBe("lbs");
    });

    it("returns kg when env is kg", () => {
      process.env.WEIGHT_UNIT = "kg";
      expect(getWeightUnit()).toBe("kg");
    });

    it("returns kg when env is KG (case insensitive)", () => {
      process.env.WEIGHT_UNIT = "KG";
      expect(getWeightUnit()).toBe("kg");
    });
  });

  describe("getWeightUnitLabel", () => {
    it("returns lbs by default", () => {
      delete process.env.WEIGHT_UNIT;
      expect(getWeightUnitLabel()).toBe("lbs");
    });

    it("returns kg when configured", () => {
      process.env.WEIGHT_UNIT = "kg";
      expect(getWeightUnitLabel()).toBe("kg");
    });
  });

  describe("toDisplayWeight", () => {
    it("returns same weight in lbs mode", () => {
      delete process.env.WEIGHT_UNIT;
      expect(toDisplayWeight(225)).toBe(225);
    });

    it("converts lbs to kg when in kg mode", () => {
      process.env.WEIGHT_UNIT = "kg";
      // 225 lbs = 102.06 kg
      expect(toDisplayWeight(225)).toBeCloseTo(102.1, 1);
    });

    it("rounds to one decimal place in kg mode", () => {
      process.env.WEIGHT_UNIT = "kg";
      expect(toDisplayWeight(135)).toBeCloseTo(61.2, 1);
    });
  });

  describe("fromDisplayWeight", () => {
    it("returns same weight in lbs mode", () => {
      delete process.env.WEIGHT_UNIT;
      expect(fromDisplayWeight(225)).toBe(225);
    });

    it("converts kg to lbs when in kg mode", () => {
      process.env.WEIGHT_UNIT = "kg";
      // 100 kg = 220.46 lbs
      expect(fromDisplayWeight(100)).toBeCloseTo(220.5, 1);
    });
  });

  describe("getPlateMilestones", () => {
    it("returns lbs milestones by default", () => {
      delete process.env.WEIGHT_UNIT;
      const milestones = getPlateMilestones();
      expect(milestones).toEqual(PLATE_MILESTONES_LBS);
      expect(milestones.bench_press).toContain(135);
      expect(milestones.bench_press).toContain(225);
    });

    it("returns kg milestones when configured", () => {
      process.env.WEIGHT_UNIT = "kg";
      const milestones = getPlateMilestones();
      expect(milestones).toEqual(PLATE_MILESTONES_KG);
      expect(milestones.bench_press).toContain(60);
      expect(milestones.bench_press).toContain(100);
    });
  });

  describe("getMilestoneNames", () => {
    it("returns lbs milestone names by default", () => {
      delete process.env.WEIGHT_UNIT;
      const names = getMilestoneNames();
      expect(names[135]).toBe("One plate club");
      expect(names[225]).toBe("Two plate club");
      expect(names[315]).toBe("Three plate club");
    });

    it("returns kg milestone names when configured", () => {
      process.env.WEIGHT_UNIT = "kg";
      const names = getMilestoneNames();
      expect(names[60]).toBe("One plate club");
      expect(names[100]).toBe("Two plate club");
      expect(names[140]).toBe("Three plate club");
    });
  });

  describe("PLATE_MILESTONES_LBS", () => {
    it("has correct bench press milestones", () => {
      expect(PLATE_MILESTONES_LBS.bench_press).toEqual([135, 185, 225, 275, 315, 365, 405]);
    });

    it("has correct squat milestones", () => {
      expect(PLATE_MILESTONES_LBS.squat).toEqual([
        135, 185, 225, 275, 315, 365, 405, 455, 495, 545,
      ]);
    });

    it("has correct deadlift milestones", () => {
      expect(PLATE_MILESTONES_LBS.deadlift).toEqual([135, 225, 315, 405, 495, 585, 635]);
    });

    it("has correct overhead press milestones", () => {
      expect(PLATE_MILESTONES_LBS.overhead_press).toEqual([95, 135, 185, 225]);
    });
  });

  describe("PLATE_MILESTONES_KG", () => {
    it("has correct bench press milestones", () => {
      expect(PLATE_MILESTONES_KG.bench_press).toEqual([60, 80, 100, 120, 140, 160, 180]);
    });

    it("has correct squat milestones", () => {
      expect(PLATE_MILESTONES_KG.squat).toEqual([60, 80, 100, 120, 140, 160, 180, 200, 220, 240]);
    });

    it("has correct deadlift milestones", () => {
      expect(PLATE_MILESTONES_KG.deadlift).toEqual([60, 100, 140, 180, 220, 260, 280]);
    });

    it("has correct overhead press milestones", () => {
      expect(PLATE_MILESTONES_KG.overhead_press).toEqual([40, 60, 80, 100]);
    });
  });
});
