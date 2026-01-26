import {
  analyzeExerciseRPE,
  calculateSessionDifficulty,
  generateRPESummary,
  compareRPEPeriods,
  groupByRPE,
  groupByWeight,
  groupByExercise,
  isIncreasingTrend,
  type RPEDataPoint,
  type RPETrend,
} from "./rpe-analyzer.js";

describe("rpe-analyzer", () => {
  // Reset env before each test
  const originalEnv = process.env.WEIGHT_UNIT;
  afterEach(() => {
    process.env.WEIGHT_UNIT = originalEnv;
  });

  describe("helper functions", () => {
    describe("groupByRPE", () => {
      it("groups data points by RPE value", () => {
        const data: RPEDataPoint[] = [
          {
            date: "2025-01-01",
            exercise: "bench",
            weight: 175,
            reps: 5,
            rpe: 8,
            estimated1RM: 197,
          },
          {
            date: "2025-01-02",
            exercise: "bench",
            weight: 180,
            reps: 5,
            rpe: 8,
            estimated1RM: 203,
          },
          {
            date: "2025-01-03",
            exercise: "bench",
            weight: 165,
            reps: 5,
            rpe: 7,
            estimated1RM: 186,
          },
        ];

        const result = groupByRPE(data);
        expect(Object.keys(result)).toHaveLength(2);
        expect(result["8"]).toHaveLength(2);
        expect(result["7"]).toHaveLength(1);
      });

      it("handles empty array", () => {
        const result = groupByRPE([]);
        expect(result).toEqual({});
      });
    });

    describe("groupByWeight", () => {
      it("groups data points by weight", () => {
        const data: RPEDataPoint[] = [
          {
            date: "2025-01-01",
            exercise: "bench",
            weight: 175,
            reps: 5,
            rpe: 7,
            estimated1RM: 197,
          },
          {
            date: "2025-01-02",
            exercise: "bench",
            weight: 175,
            reps: 5,
            rpe: 8,
            estimated1RM: 197,
          },
          {
            date: "2025-01-03",
            exercise: "bench",
            weight: 180,
            reps: 5,
            rpe: 8,
            estimated1RM: 203,
          },
        ];

        const result = groupByWeight(data);
        expect(Object.keys(result)).toHaveLength(2);
        expect(result["175"]).toHaveLength(2);
        expect(result["180"]).toHaveLength(1);
      });
    });

    describe("groupByExercise", () => {
      it("groups data points by exercise", () => {
        const data: RPEDataPoint[] = [
          {
            date: "2025-01-01",
            exercise: "bench",
            weight: 175,
            reps: 5,
            rpe: 8,
            estimated1RM: 197,
          },
          {
            date: "2025-01-02",
            exercise: "squat",
            weight: 225,
            reps: 5,
            rpe: 8,
            estimated1RM: 253,
          },
          {
            date: "2025-01-03",
            exercise: "bench",
            weight: 180,
            reps: 5,
            rpe: 8,
            estimated1RM: 203,
          },
        ];

        const result = groupByExercise(data);
        expect(Object.keys(result)).toHaveLength(2);
        expect(result["bench"]).toHaveLength(2);
        expect(result["squat"]).toHaveLength(1);
      });
    });

    describe("isIncreasingTrend", () => {
      it("returns true for strictly increasing values", () => {
        expect(isIncreasingTrend([7, 8, 9])).toBe(true);
      });

      it("returns false if there is a plateau (requires strict increases)", () => {
        // The function requires n-1 increases out of n-1 possible (strict)
        expect(isIncreasingTrend([7, 8, 8, 9])).toBe(false);
      });

      it("returns true for two increasing values", () => {
        expect(isIncreasingTrend([7, 8])).toBe(true);
      });

      it("returns false for decreasing values", () => {
        expect(isIncreasingTrend([9, 8, 7])).toBe(false);
      });

      it("returns false for flat values", () => {
        expect(isIncreasingTrend([8, 8, 8])).toBe(false);
      });

      it("returns false for single value", () => {
        expect(isIncreasingTrend([8])).toBe(false);
      });

      it("returns false for empty array", () => {
        expect(isIncreasingTrend([])).toBe(false);
      });
    });
  });

  describe("analyzeExerciseRPE", () => {
    describe("with insufficient data", () => {
      it("returns empty insights for single data point", () => {
        const data: RPEDataPoint[] = [
          {
            date: "2025-01-01",
            exercise: "bench",
            weight: 175,
            reps: 5,
            rpe: 8,
            estimated1RM: 197,
          },
        ];

        const result = analyzeExerciseRPE(data, "bench_press");
        expect(result.insights).toHaveLength(0);
        expect(result.exercise).toBe("bench_press");
      });

      it("returns empty insights for empty data", () => {
        const result = analyzeExerciseRPE([], "bench_press");
        expect(result.insights).toHaveLength(0);
      });
    });

    describe("strength gain detection", () => {
      it("detects strength gain at same RPE", () => {
        const data: RPEDataPoint[] = [
          {
            date: "2025-01-01",
            exercise: "bench",
            weight: 175,
            reps: 5,
            rpe: 8,
            estimated1RM: 197,
          },
          {
            date: "2025-01-15",
            exercise: "bench",
            weight: 185,
            reps: 5,
            rpe: 8,
            estimated1RM: 208,
          },
        ];

        const result = analyzeExerciseRPE(data, "bench_press");
        const strengthInsight = result.insights.find((i) => i.type === "strength_gain");

        expect(strengthInsight).toBeDefined();
        expect(strengthInsight?.severity).toBe("positive");
        expect(strengthInsight?.message).toContain("@8");
        expect(strengthInsight?.message).toContain("175");
        expect(strengthInsight?.message).toContain("185");
        expect(strengthInsight?.data?.improvement).toBe(10);
      });

      it("does not flag strength gain if weight decreased", () => {
        const data: RPEDataPoint[] = [
          {
            date: "2025-01-01",
            exercise: "bench",
            weight: 185,
            reps: 5,
            rpe: 8,
            estimated1RM: 208,
          },
          {
            date: "2025-01-15",
            exercise: "bench",
            weight: 175,
            reps: 5,
            rpe: 8,
            estimated1RM: 197,
          },
        ];

        const result = analyzeExerciseRPE(data, "bench_press");
        const strengthInsight = result.insights.find((i) => i.type === "strength_gain");

        expect(strengthInsight).toBeUndefined();
      });
    });

    describe("fatigue detection", () => {
      it("detects fatigue pattern (increasing RPE at same weight)", () => {
        const data: RPEDataPoint[] = [
          {
            date: "2025-01-01",
            exercise: "bench",
            weight: 175,
            reps: 5,
            rpe: 7,
            estimated1RM: 197,
          },
          {
            date: "2025-01-08",
            exercise: "bench",
            weight: 175,
            reps: 5,
            rpe: 7.5,
            estimated1RM: 197,
          },
          {
            date: "2025-01-15",
            exercise: "bench",
            weight: 175,
            reps: 5,
            rpe: 8.5,
            estimated1RM: 197,
          },
        ];

        const result = analyzeExerciseRPE(data, "bench_press");
        const fatigueInsight = result.insights.find((i) => i.type === "fatigue_warning");

        expect(fatigueInsight).toBeDefined();
        expect(fatigueInsight?.severity).toBe("warning");
        expect(fatigueInsight?.message).toContain("175");
        expect(fatigueInsight?.message).toContain("7");
        expect(fatigueInsight?.message).toContain("8.5");
        expect(fatigueInsight?.message).toContain("deload");
      });

      it("does not flag fatigue if RPE increase is small", () => {
        const data: RPEDataPoint[] = [
          {
            date: "2025-01-01",
            exercise: "bench",
            weight: 175,
            reps: 5,
            rpe: 7,
            estimated1RM: 197,
          },
          {
            date: "2025-01-08",
            exercise: "bench",
            weight: 175,
            reps: 5,
            rpe: 7,
            estimated1RM: 197,
          },
          {
            date: "2025-01-15",
            exercise: "bench",
            weight: 175,
            reps: 5,
            rpe: 7.5,
            estimated1RM: 197,
          },
        ];

        const result = analyzeExerciseRPE(data, "bench_press");
        const fatigueInsight = result.insights.find((i) => i.type === "fatigue_warning");

        expect(fatigueInsight).toBeUndefined();
      });

      it("requires 3+ data points to detect fatigue", () => {
        const data: RPEDataPoint[] = [
          {
            date: "2025-01-01",
            exercise: "bench",
            weight: 175,
            reps: 5,
            rpe: 7,
            estimated1RM: 197,
          },
          {
            date: "2025-01-08",
            exercise: "bench",
            weight: 175,
            reps: 5,
            rpe: 9,
            estimated1RM: 197,
          },
        ];

        const result = analyzeExerciseRPE(data, "bench_press");
        const fatigueInsight = result.insights.find((i) => i.type === "fatigue_warning");

        expect(fatigueInsight).toBeUndefined();
      });
    });

    describe("consistency detection", () => {
      it("detects consistent RPE at same weight", () => {
        const data: RPEDataPoint[] = [
          {
            date: "2025-01-01",
            exercise: "bench",
            weight: 175,
            reps: 5,
            rpe: 8,
            estimated1RM: 197,
          },
          {
            date: "2025-01-08",
            exercise: "bench",
            weight: 175,
            reps: 5,
            rpe: 8,
            estimated1RM: 197,
          },
          {
            date: "2025-01-15",
            exercise: "bench",
            weight: 175,
            reps: 5,
            rpe: 8,
            estimated1RM: 197,
          },
          {
            date: "2025-01-22",
            exercise: "bench",
            weight: 175,
            reps: 5,
            rpe: 8,
            estimated1RM: 197,
          },
        ];

        const result = analyzeExerciseRPE(data, "bench_press");
        const consistencyInsight = result.insights.find((i) => i.type === "consistency");

        expect(consistencyInsight).toBeDefined();
        expect(consistencyInsight?.severity).toBe("info");
        expect(consistencyInsight?.message).toContain("175");
        expect(consistencyInsight?.message).toContain("technique is dialed in");
      });

      it("requires 4+ data points for consistency detection", () => {
        const data: RPEDataPoint[] = [
          {
            date: "2025-01-01",
            exercise: "bench",
            weight: 175,
            reps: 5,
            rpe: 8,
            estimated1RM: 197,
          },
          {
            date: "2025-01-08",
            exercise: "bench",
            weight: 175,
            reps: 5,
            rpe: 8,
            estimated1RM: 197,
          },
          {
            date: "2025-01-15",
            exercise: "bench",
            weight: 175,
            reps: 5,
            rpe: 8,
            estimated1RM: 197,
          },
        ];

        const result = analyzeExerciseRPE(data, "bench_press");
        const consistencyInsight = result.insights.find((i) => i.type === "consistency");

        expect(consistencyInsight).toBeUndefined();
      });
    });

    describe("weight unit configuration", () => {
      it("uses lbs by default in messages", () => {
        delete process.env.WEIGHT_UNIT;
        const data: RPEDataPoint[] = [
          {
            date: "2025-01-01",
            exercise: "bench",
            weight: 175,
            reps: 5,
            rpe: 8,
            estimated1RM: 197,
          },
          {
            date: "2025-01-15",
            exercise: "bench",
            weight: 185,
            reps: 5,
            rpe: 8,
            estimated1RM: 208,
          },
        ];

        const result = analyzeExerciseRPE(data, "bench_press");
        const insight = result.insights.find((i) => i.type === "strength_gain");

        expect(insight?.message).toContain("lbs");
      });

      it("uses kg when configured", () => {
        process.env.WEIGHT_UNIT = "kg";
        const data: RPEDataPoint[] = [
          { date: "2025-01-01", exercise: "bench", weight: 80, reps: 5, rpe: 8, estimated1RM: 90 },
          { date: "2025-01-15", exercise: "bench", weight: 85, reps: 5, rpe: 8, estimated1RM: 96 },
        ];

        const result = analyzeExerciseRPE(data, "bench_press");
        const insight = result.insights.find((i) => i.type === "strength_gain");

        expect(insight?.message).toContain("kg");
      });
    });
  });

  describe("calculateSessionDifficulty", () => {
    describe("edge cases", () => {
      it("returns null for empty sets array", () => {
        const result = calculateSessionDifficulty([]);
        expect(result).toBeNull();
      });

      it("returns null for sets without RPE", () => {
        const result = calculateSessionDifficulty([{ rpe: undefined }, { rpe: undefined }]);
        expect(result).toBeNull();
      });

      it("returns null for sets with RPE of 0", () => {
        const result = calculateSessionDifficulty([{ rpe: 0 }, { rpe: 0 }]);
        expect(result).toBeNull();
      });

      it("filters out sets without valid RPE", () => {
        const result = calculateSessionDifficulty([
          { rpe: 8 },
          { rpe: undefined },
          { rpe: 7 },
          { rpe: 0 },
        ]);
        expect(result).not.toBeNull();
        expect(result?.totalSets).toBe(2);
      });
    });

    describe("difficulty categories", () => {
      it("categorizes low difficulty session as 'easy'", () => {
        // 3 sets at RPE 6 = avg 6, score = 60 * sqrt(3/10) = 60 * 0.55 = 33 = easy
        const result = calculateSessionDifficulty([{ rpe: 6 }, { rpe: 6 }, { rpe: 6 }]);
        expect(result).not.toBeNull();
        expect(result?.category).toBe("easy");
      });

      it("categorizes moderate difficulty session as 'moderate'", () => {
        // 10 sets at RPE 5 = avg 5, score = 50 * sqrt(10/10) = 50 = moderate
        const sets = Array(10).fill({ rpe: 5 });
        const result = calculateSessionDifficulty(sets);
        expect(result).not.toBeNull();
        expect(result?.category).toBe("moderate");
      });

      it("categorizes high difficulty session as 'hard'", () => {
        // 10 sets at RPE 7 = avg 7, score = 70 * 1 = 70 = hard
        const sets = Array(10).fill({ rpe: 7 });
        const result = calculateSessionDifficulty(sets);
        expect(result).not.toBeNull();
        expect(result?.category).toBe("hard");
      });

      it("categorizes very high difficulty session as 'brutal'", () => {
        // 15 sets at RPE 9 = avg 9, score = (90 + 5) * sqrt(15/10) = 95 * 1.22 = 116 (capped at 100)
        const sets = Array(15).fill({ rpe: 9 });
        const result = calculateSessionDifficulty(sets);
        expect(result).not.toBeNull();
        expect(result?.category).toBe("brutal");
        expect(result?.difficultyScore).toBe(100); // capped
      });
    });

    describe("calculation accuracy", () => {
      it("calculates correct average RPE", () => {
        const result = calculateSessionDifficulty([{ rpe: 7 }, { rpe: 8 }, { rpe: 9 }]);
        expect(result?.averageRPE).toBe(8);
      });

      it("calculates correct max RPE", () => {
        const result = calculateSessionDifficulty([{ rpe: 7 }, { rpe: 8 }, { rpe: 9 }]);
        expect(result?.maxRPE).toBe(9);
      });

      it("counts total sets correctly", () => {
        const result = calculateSessionDifficulty([{ rpe: 7 }, { rpe: 8 }, { rpe: 9 }]);
        expect(result?.totalSets).toBe(3);
      });

      it("adds bonus for high max RPE", () => {
        // Same avg RPE but different max
        const lowMax = calculateSessionDifficulty([{ rpe: 7 }, { rpe: 7 }, { rpe: 7 }]);
        const highMax = calculateSessionDifficulty([{ rpe: 6 }, { rpe: 7 }, { rpe: 10 }]);

        // High max should have higher difficulty due to bonus
        expect(highMax?.difficultyScore).toBeGreaterThan(lowMax?.difficultyScore ?? 0);
      });

      it("clamps score to minimum of 1", () => {
        const result = calculateSessionDifficulty([{ rpe: 1 }]);
        expect(result?.difficultyScore).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe("generateRPESummary", () => {
    it("returns empty arrays for no insights", () => {
      const trends: RPETrend[] = [{ exercise: "bench", dataPoints: [], insights: [] }];
      const result = generateRPESummary(trends);

      expect(result.strengthGains).toHaveLength(0);
      expect(result.fatigueWarnings).toHaveLength(0);
      expect(result.highlights).toHaveLength(0);
    });

    it("aggregates strength gains across exercises", () => {
      const trends: RPETrend[] = [
        {
          exercise: "bench",
          dataPoints: [],
          insights: [
            { type: "strength_gain", message: "gained", severity: "positive" },
            { type: "strength_gain", message: "more gains", severity: "positive" },
          ],
        },
        {
          exercise: "squat",
          dataPoints: [],
          insights: [{ type: "strength_gain", message: "squat gains", severity: "positive" }],
        },
      ];

      const result = generateRPESummary(trends);
      expect(result.strengthGains).toHaveLength(3);
      expect(result.highlights).toContain("3 exercise(s) showing strength gains at same RPE");
    });

    it("aggregates fatigue warnings across exercises", () => {
      const trends: RPETrend[] = [
        {
          exercise: "bench",
          dataPoints: [],
          insights: [{ type: "fatigue_warning", message: "fatigued", severity: "warning" }],
        },
      ];

      const result = generateRPESummary(trends);
      expect(result.fatigueWarnings).toHaveLength(1);
      expect(result.highlights).toContain(
        "1 exercise(s) showing fatigue patterns - recovery may help"
      );
    });

    it("prefixes messages with exercise name", () => {
      const trends: RPETrend[] = [
        {
          exercise: "bench",
          dataPoints: [],
          insights: [{ type: "strength_gain", message: "original message", severity: "positive" }],
        },
      ];

      const result = generateRPESummary(trends);
      expect(result.strengthGains[0].message).toContain("bench:");
    });
  });

  describe("compareRPEPeriods", () => {
    it("returns empty array when no matching exercises", () => {
      const current: RPEDataPoint[] = [
        { date: "2025-01-15", exercise: "bench", weight: 185, reps: 5, rpe: 8, estimated1RM: 208 },
      ];
      const previous: RPEDataPoint[] = [
        { date: "2025-01-01", exercise: "squat", weight: 225, reps: 5, rpe: 8, estimated1RM: 253 },
      ];

      const result = compareRPEPeriods(current, previous);
      expect(result).toHaveLength(0);
    });

    it("detects getting stronger (more weight, same/lower RPE)", () => {
      const current: RPEDataPoint[] = [
        { date: "2025-01-15", exercise: "bench", weight: 185, reps: 5, rpe: 8, estimated1RM: 208 },
      ];
      const previous: RPEDataPoint[] = [
        { date: "2025-01-01", exercise: "bench", weight: 175, reps: 5, rpe: 8, estimated1RM: 197 },
      ];

      const result = compareRPEPeriods(current, previous);
      expect(result).toHaveLength(1);
      expect(result[0].interpretation).toContain("Getting stronger");
    });

    it("detects pushing harder (more weight, higher RPE)", () => {
      const current: RPEDataPoint[] = [
        { date: "2025-01-15", exercise: "bench", weight: 185, reps: 5, rpe: 9, estimated1RM: 208 },
      ];
      const previous: RPEDataPoint[] = [
        { date: "2025-01-01", exercise: "bench", weight: 175, reps: 5, rpe: 7, estimated1RM: 197 },
      ];

      const result = compareRPEPeriods(current, previous);
      expect(result).toHaveLength(1);
      expect(result[0].interpretation).toContain("Pushing harder");
    });

    it("detects possible fatigue (same weight, higher RPE)", () => {
      const current: RPEDataPoint[] = [
        { date: "2025-01-15", exercise: "bench", weight: 175, reps: 5, rpe: 9, estimated1RM: 197 },
      ];
      const previous: RPEDataPoint[] = [
        { date: "2025-01-01", exercise: "bench", weight: 175, reps: 5, rpe: 7, estimated1RM: 197 },
      ];

      const result = compareRPEPeriods(current, previous);
      expect(result).toHaveLength(1);
      expect(result[0].interpretation).toContain("Possible fatigue");
    });

    it("detects deload/recovery (lower weight, lower RPE)", () => {
      const current: RPEDataPoint[] = [
        { date: "2025-01-15", exercise: "bench", weight: 155, reps: 5, rpe: 6, estimated1RM: 175 },
      ];
      const previous: RPEDataPoint[] = [
        { date: "2025-01-01", exercise: "bench", weight: 175, reps: 5, rpe: 8, estimated1RM: 197 },
      ];

      const result = compareRPEPeriods(current, previous);
      expect(result).toHaveLength(1);
      expect(result[0].interpretation).toContain("Deload/recovery");
    });

    it("detects maintaining level", () => {
      const current: RPEDataPoint[] = [
        { date: "2025-01-15", exercise: "bench", weight: 175, reps: 5, rpe: 8, estimated1RM: 197 },
      ];
      const previous: RPEDataPoint[] = [
        { date: "2025-01-01", exercise: "bench", weight: 175, reps: 5, rpe: 8, estimated1RM: 197 },
      ];

      const result = compareRPEPeriods(current, previous);
      expect(result).toHaveLength(1);
      expect(result[0].interpretation).toContain("Maintaining");
    });

    it("formats change string with weight unit", () => {
      delete process.env.WEIGHT_UNIT;
      const current: RPEDataPoint[] = [
        { date: "2025-01-15", exercise: "bench", weight: 185, reps: 5, rpe: 8, estimated1RM: 208 },
      ];
      const previous: RPEDataPoint[] = [
        { date: "2025-01-01", exercise: "bench", weight: 175, reps: 5, rpe: 8, estimated1RM: 197 },
      ];

      const result = compareRPEPeriods(current, previous);
      expect(result[0].change).toContain("lbs");
      expect(result[0].change).toContain("+10");
    });
  });
});
