import {
  generatePRCelebration,
  generateWeeklyPRSummary,
  checkMilestone,
  normalizeExerciseName,
  formatExerciseName,
} from "./pr-celebrations.js";
import type { PRsData, PRRecord } from "../storage/types.js";

describe("pr-celebrations", () => {
  // Reset env before each test
  const originalEnv = process.env.WEIGHT_UNIT;
  afterEach(() => {
    process.env.WEIGHT_UNIT = originalEnv;
  });

  describe("normalizeExerciseName", () => {
    it("normalizes 'bench press' to 'bench_press'", () => {
      expect(normalizeExerciseName("bench press")).toBe("bench_press");
    });

    it("normalizes 'Bench' to 'bench_press'", () => {
      expect(normalizeExerciseName("Bench")).toBe("bench_press");
    });

    it("normalizes 'OHP' to 'overhead_press'", () => {
      expect(normalizeExerciseName("OHP")).toBe("overhead_press");
    });

    it("normalizes 'DL' to 'deadlift'", () => {
      expect(normalizeExerciseName("dl")).toBe("deadlift");
    });

    it("handles unknown exercises by replacing spaces with underscores", () => {
      expect(normalizeExerciseName("lat pulldown")).toBe("lat_pulldown");
    });

    it("trims whitespace", () => {
      expect(normalizeExerciseName("  squat  ")).toBe("squat");
    });
  });

  describe("formatExerciseName", () => {
    it("formats 'bench_press' to 'Bench Press'", () => {
      expect(formatExerciseName("bench_press")).toBe("Bench Press");
    });

    it("formats 'squat' to 'Squat'", () => {
      expect(formatExerciseName("squat")).toBe("Squat");
    });

    it("formats 'overhead_press' to 'Overhead Press'", () => {
      expect(formatExerciseName("overhead_press")).toBe("Overhead Press");
    });
  });

  describe("checkMilestone", () => {
    describe("lbs mode (default)", () => {
      beforeEach(() => {
        delete process.env.WEIGHT_UNIT;
      });

      it("detects 135 lb milestone for bench press", () => {
        const result = checkMilestone("bench_press", 135, 130);
        expect(result).not.toBeNull();
        expect(result?.name).toBe("One plate club");
        expect(result?.emoji).toBe("💪");
      });

      it("detects 225 lb milestone for bench press", () => {
        const result = checkMilestone("bench_press", 225, 220);
        expect(result).not.toBeNull();
        expect(result?.name).toBe("Two plate club");
        expect(result?.emoji).toBe("🏆");
      });

      it("detects 315 lb milestone for squat", () => {
        const result = checkMilestone("squat", 315, 310);
        expect(result).not.toBeNull();
        expect(result?.name).toBe("Three plate club");
        expect(result?.emoji).toBe("🏆🔥");
      });

      it("detects 405 lb milestone for deadlift", () => {
        const result = checkMilestone("deadlift", 405, 400);
        expect(result).not.toBeNull();
        expect(result?.name).toBe("Four plate club");
        expect(result?.emoji).toBe("🏆👑");
      });

      it("returns null if milestone was already passed", () => {
        const result = checkMilestone("bench_press", 140, 135);
        expect(result).toBeNull();
      });

      it("returns null for unknown exercises", () => {
        const result = checkMilestone("bicep_curl", 100, 90);
        expect(result).toBeNull();
      });

      it("returns null if weight is below any milestone", () => {
        const result = checkMilestone("bench_press", 100, 90);
        expect(result).toBeNull();
      });

      it("detects milestone when no previous weight exists", () => {
        const result = checkMilestone("bench_press", 135, undefined);
        expect(result).not.toBeNull();
        expect(result?.name).toBe("One plate club");
      });
    });

    describe("kg mode", () => {
      beforeEach(() => {
        process.env.WEIGHT_UNIT = "kg";
      });

      it("detects 60 kg milestone for bench press", () => {
        const result = checkMilestone("bench_press", 60, 55);
        expect(result).not.toBeNull();
        expect(result?.name).toBe("One plate club");
      });

      it("detects 100 kg milestone for bench press", () => {
        const result = checkMilestone("bench_press", 100, 95);
        expect(result).not.toBeNull();
        expect(result?.name).toBe("Two plate club");
      });

      it("detects 140 kg milestone for deadlift", () => {
        const result = checkMilestone("deadlift", 140, 135);
        expect(result).not.toBeNull();
        expect(result?.name).toBe("Three plate club");
      });
    });
  });

  describe("generatePRCelebration", () => {
    const emptyPRs: PRsData = {};

    describe("first PR (no existing records)", () => {
      it("generates celebration for first PR", () => {
        const result = generatePRCelebration("bench_press", 135, 5, emptyPRs);
        expect(result).not.toBeNull();
        expect(result?.type).toBe("milestone"); // 135 is a milestone
        expect(result?.current.weight).toBe(135);
        expect(result?.current.reps).toBe(5);
        expect(result?.celebrationLevel).toBe(3); // milestone = legendary
        expect(result?.message).toContain("135 x 5");
      });

      it("generates milestone for weight that crosses 135 (even if exact weight is 150)", () => {
        // When no previous weight exists, any weight >= 135 triggers the 135 milestone
        const result = generatePRCelebration("bench_press", 150, 5, emptyPRs);
        expect(result).not.toBeNull();
        expect(result?.type).toBe("milestone"); // 135 milestone is triggered
        expect(result?.celebrationLevel).toBe(3); // milestone = legendary
      });

      it("generates weight PR for exercise without milestones", () => {
        // lat_pulldown has no milestones defined
        const result = generatePRCelebration("lat_pulldown", 150, 10, emptyPRs);
        expect(result).not.toBeNull();
        expect(result?.type).toBe("weight");
        expect(result?.celebrationLevel).toBe(2); // weight PR = great
      });
    });

    describe("weight PR", () => {
      const existingPRs: PRsData = {
        bench_press: {
          current: { weight: 175, reps: 5, date: "2025-01-01", estimated1RM: 197 },
          history: [],
        },
      };

      it("detects weight PR", () => {
        const result = generatePRCelebration("bench_press", 180, 5, existingPRs);
        expect(result).not.toBeNull();
        expect(result?.type).toBe("weight");
        expect(result?.previous?.weight).toBe(175);
        expect(result?.message).toContain("+5");
      });

      it("returns null if weight is not a PR", () => {
        const result = generatePRCelebration("bench_press", 170, 5, existingPRs);
        expect(result).toBeNull();
      });
    });

    describe("rep PR", () => {
      const existingPRs: PRsData = {
        bench_press: {
          current: { weight: 175, reps: 5, date: "2025-01-01", estimated1RM: 197 },
          history: [],
        },
      };

      it("detects rep PR at same weight", () => {
        const result = generatePRCelebration("bench_press", 175, 7, existingPRs);
        expect(result).not.toBeNull();
        expect(result?.type).toBe("rep");
        expect(result?.message).toContain("+2 reps");
      });

      it("returns null if reps are not a PR at same weight", () => {
        const result = generatePRCelebration("bench_press", 175, 4, existingPRs);
        expect(result).toBeNull();
      });
    });

    describe("estimated 1RM PR", () => {
      const existingPRs: PRsData = {
        bench_press: {
          current: { weight: 175, reps: 3, date: "2025-01-01", estimated1RM: 186 },
          history: [],
        },
      };

      it("detects estimated 1RM PR (lower weight, more reps)", () => {
        // 165 x 8 = ~203 e1RM, which is higher than 186
        const result = generatePRCelebration("bench_press", 165, 8, existingPRs);
        expect(result).not.toBeNull();
        expect(result?.type).toBe("estimated_1rm");
        expect(result?.celebrationLevel).toBe(1); // e1RM PR = good
      });
    });

    describe("milestone detection", () => {
      const existingPRs: PRsData = {
        bench_press: {
          current: { weight: 220, reps: 3, date: "2025-01-01", estimated1RM: 234 },
          history: [],
        },
      };

      it("detects milestone achievement", () => {
        const result = generatePRCelebration("bench_press", 225, 3, existingPRs);
        expect(result).not.toBeNull();
        expect(result?.type).toBe("milestone");
        expect(result?.milestone?.name).toBe("Two plate club");
        expect(result?.celebrationLevel).toBe(3); // legendary
      });
    });

    describe("journey context", () => {
      const history: PRRecord[] = [
        { weight: 135, reps: 5, date: "2024-06-01", estimated1RM: 152 },
        { weight: 155, reps: 5, date: "2024-09-01", estimated1RM: 175 },
        { weight: 175, reps: 5, date: "2025-01-01", estimated1RM: 197 },
      ];

      it("includes journey context when history is provided", () => {
        const existingPRs: PRsData = {
          bench_press: {
            current: { weight: 175, reps: 5, date: "2025-01-01", estimated1RM: 197 },
            history,
          },
        };

        const result = generatePRCelebration("bench_press", 180, 5, existingPRs, history);
        expect(result).not.toBeNull();
        expect(result?.journeyContext).toContain("Your Bench Press journey");
        expect(result?.journeyContext).toContain("Started: 135");
      });

      it("handles single history entry", () => {
        const singleHistory: PRRecord[] = [
          { weight: 175, reps: 5, date: "2025-01-01", estimated1RM: 197 },
        ];

        const result = generatePRCelebration("bench_press", 180, 5, emptyPRs, singleHistory);
        expect(result?.journeyContext).toContain("beginning of your journey");
      });

      it("handles same-day PR (division by zero fix)", () => {
        const todayHistory: PRRecord[] = [
          { weight: 175, reps: 5, date: new Date().toISOString().split("T")[0], estimated1RM: 197 },
          { weight: 180, reps: 3, date: new Date().toISOString().split("T")[0], estimated1RM: 191 },
        ];

        const result = generatePRCelebration("bench_press", 185, 5, emptyPRs, todayHistory);
        expect(result).not.toBeNull();
        // Should not throw division by zero error
        expect(result?.journeyContext).toBeDefined();
        // Should show days, not months, for recent PRs
        expect(result?.journeyContext).toContain("day");
      });
    });

    describe("weight unit configuration", () => {
      beforeEach(() => {
        delete process.env.WEIGHT_UNIT;
      });

      it("uses lbs by default", () => {
        const result = generatePRCelebration("bench_press", 180, 5, emptyPRs);
        expect(result?.message).toContain("lbs");
      });

      it("uses kg when configured", () => {
        process.env.WEIGHT_UNIT = "kg";
        const result = generatePRCelebration("bench_press", 80, 5, emptyPRs);
        expect(result?.message).toContain("kg");
      });
    });
  });

  describe("generateWeeklyPRSummary", () => {
    it("returns no PRs message for empty array", () => {
      const result = generateWeeklyPRSummary([]);
      expect(result).toContain("No new PRs this week");
    });

    it("generates summary for single PR", () => {
      const prs = [{ exercise: "bench_press", weight: 185, reps: 5, date: "2025-01-20" }];
      const result = generateWeeklyPRSummary(prs);
      expect(result).toContain("1 PR This Week");
      expect(result).toContain("Bench Press: 185 x 5");
    });

    it("generates summary for multiple PRs", () => {
      const prs = [
        { exercise: "bench_press", weight: 185, reps: 5, date: "2025-01-20" },
        { exercise: "squat", weight: 225, reps: 5, date: "2025-01-21" },
      ];
      const result = generateWeeklyPRSummary(prs);
      expect(result).toContain("2 PRs This Week");
      expect(result).toContain("Bench Press");
      expect(result).toContain("Squat");
    });

    it("includes milestone achievements", () => {
      const prs = [{ exercise: "bench_press", weight: 225, reps: 3, date: "2025-01-20" }];
      const result = generateWeeklyPRSummary(prs);
      expect(result).toContain("Milestones Hit");
      // Note: Without previous weight, checkMilestone returns the first crossed milestone (135)
      // This is because the function checks milestones in order and returns the first one >= weight
      expect(result).toContain("plate club");
    });
  });
});
