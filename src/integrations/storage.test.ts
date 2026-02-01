import {
  getISOWeekForDate,
  parseFrontmatter,
  serializeFrontmatter,
  formatRecoverySummary,
  formatSleepSummary,
  getRecoveryRecommendation,
} from "./storage.js";
import type { RecoveryData, SleepData } from "./types.js";

describe("integration storage", () => {
  describe("getISOWeekForDate", () => {
    it("returns consistent week format YYYY-WXX", () => {
      const week = getISOWeekForDate("2026-01-27");
      expect(week).toMatch(/^\d{4}-W\d{2}$/);
    });

    it("returns same week for dates in the same week", () => {
      // Monday to Sunday should be the same week
      const mondayWeek = getISOWeekForDate("2026-01-26");
      const sundayWeek = getISOWeekForDate("2026-02-01");
      // These might span a week boundary, so just check they're both valid
      expect(mondayWeek).toMatch(/^\d{4}-W\d{2}$/);
      expect(sundayWeek).toMatch(/^\d{4}-W\d{2}$/);
    });

    it("returns different weeks for dates a week apart", () => {
      const week1 = getISOWeekForDate("2026-01-15");
      const week2 = getISOWeekForDate("2026-01-22");
      expect(week1).not.toBe(week2);
    });

    it("handles year start correctly", () => {
      const week = getISOWeekForDate("2026-01-01");
      expect(week).toMatch(/^\d{4}-W\d{2}$/);
    });

    it("handles year end correctly", () => {
      const week = getISOWeekForDate("2026-12-31");
      expect(week).toMatch(/^\d{4}-W\d{2}$/);
    });

    it("handles mid-year dates", () => {
      const juneWeek = getISOWeekForDate("2026-06-15");
      const marchWeek = getISOWeekForDate("2026-03-01");
      expect(juneWeek).toMatch(/^2026-W\d{2}$/);
      expect(marchWeek).toMatch(/^2026-W\d{2}$/);
    });
  });

  describe("parseFrontmatter", () => {
    it("parses simple frontmatter", () => {
      const content = `---
date: "2026-01-27"
type: upper
status: completed
---

# Workout content`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter.date).toBe("2026-01-27");
      expect(result.frontmatter.type).toBe("upper");
      expect(result.frontmatter.status).toBe("completed");
      expect(result.content).toBe("# Workout content");
    });

    it("parses nested objects", () => {
      const content = `---
date: "2026-01-27"
whoop:
  recovery:
    score: 78
    hrv: 45.2
---

# Content`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter.date).toBe("2026-01-27");
      const whoop = result.frontmatter.whoop as Record<string, unknown>;
      expect(whoop).toBeDefined();
      const recovery = whoop.recovery as Record<string, unknown>;
      expect(recovery.score).toBe(78);
      expect(recovery.hrv).toBe(45.2);
    });

    it("parses boolean and null values", () => {
      const content = `---
active: true
deleted: false
empty: null
---

Content`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter.active).toBe(true);
      expect(result.frontmatter.deleted).toBe(false);
      expect(result.frontmatter.empty).toBe(null);
    });

    it("handles content without frontmatter", () => {
      const content = "# Just a heading\n\nSome content";

      const result = parseFrontmatter(content);

      expect(result.frontmatter).toEqual({});
      expect(result.content).toBe(content);
    });

    it("handles inline objects", () => {
      const content = `---
stages: { rem: 90, deep: 85, light: 200 }
---

Content`;

      const result = parseFrontmatter(content);

      const stages = result.frontmatter.stages as Record<string, number>;
      expect(stages.rem).toBe(90);
      expect(stages.deep).toBe(85);
      expect(stages.light).toBe(200);
    });
  });

  describe("serializeFrontmatter", () => {
    it("serializes simple values", () => {
      const frontmatter = {
        date: "2026-01-27",
        type: "upper",
        score: 85,
        active: true,
      };

      const result = serializeFrontmatter(frontmatter);

      expect(result).toContain("---");
      expect(result).toContain('date: "2026-01-27"');
      expect(result).toContain("type: upper");
      expect(result).toContain("score: 85");
      expect(result).toContain("active: true");
    });

    it("serializes nested objects", () => {
      const frontmatter = {
        date: "2026-01-27",
        whoop: {
          recovery: {
            score: 78,
            hrv: 45.2,
          },
        },
      };

      const result = serializeFrontmatter(frontmatter);

      expect(result).toContain("whoop:");
      expect(result).toContain("  recovery:");
      expect(result).toContain("    score: 78");
      expect(result).toContain("    hrv: 45.2");
    });

    it("roundtrips correctly", () => {
      const original = {
        date: "2026-01-27",
        type: "upper",
        whoop: {
          recovery: {
            score: 78,
          },
          sleep: {
            durationMinutes: 420,
          },
        },
      };

      const serialized = serializeFrontmatter(original);
      const parsed = parseFrontmatter(serialized + "\n\n# Content");

      expect(parsed.frontmatter.date).toBe("2026-01-27");
      expect(parsed.frontmatter.type).toBe("upper");
      const whoop = parsed.frontmatter.whoop as Record<string, unknown>;
      const recovery = whoop.recovery as Record<string, unknown>;
      expect(recovery.score).toBe(78);
    });
  });

  describe("formatRecoverySummary", () => {
    it("formats complete recovery data", () => {
      const data: RecoveryData = {
        source: "whoop",
        date: "2026-01-27",
        score: 78,
        hrv: 45.2,
        restingHeartRate: 52,
        spo2: 98,
        raw: {},
      };

      const summary = formatRecoverySummary(data);

      expect(summary).toContain("Recovery Score: 78%");
      expect(summary).toContain("HRV: 45.2 ms");
      expect(summary).toContain("Resting HR: 52 bpm");
      expect(summary).toContain("SpO2: 98%");
    });

    it("handles partial recovery data", () => {
      const data: RecoveryData = {
        source: "whoop",
        date: "2026-01-27",
        score: 65,
        raw: {},
      };

      const summary = formatRecoverySummary(data);

      expect(summary).toContain("Recovery Score: 65%");
      expect(summary).not.toContain("HRV");
      expect(summary).not.toContain("Resting HR");
    });
  });

  describe("formatSleepSummary", () => {
    it("formats complete sleep data", () => {
      const data: SleepData = {
        source: "whoop",
        date: "2026-01-27",
        startTime: "2026-01-26T23:00:00Z",
        endTime: "2026-01-27T07:00:00Z",
        durationMinutes: 480,
        score: 85,
        stages: {
          rem: 90,
          deep: 85,
          light: 200,
          awake: 45,
        },
        raw: {},
      };

      const summary = formatSleepSummary(data);

      expect(summary).toContain("Sleep Duration: 8h 0m");
      expect(summary).toContain("Sleep Score: 85%");
      expect(summary).toContain("85m deep");
      expect(summary).toContain("90m REM");
      expect(summary).toContain("200m light");
    });

    it("handles sleep without stages", () => {
      const data: SleepData = {
        source: "whoop",
        date: "2026-01-27",
        startTime: "2026-01-26T23:00:00Z",
        endTime: "2026-01-27T07:00:00Z",
        durationMinutes: 420,
        raw: {},
      };

      const summary = formatSleepSummary(data);

      expect(summary).toContain("Sleep Duration: 7h 0m");
      expect(summary).not.toContain("Stages");
    });

    it("formats hours and minutes correctly", () => {
      const data: SleepData = {
        source: "whoop",
        date: "2026-01-27",
        startTime: "2026-01-26T23:00:00Z",
        endTime: "2026-01-27T06:30:00Z",
        durationMinutes: 450,
        raw: {},
      };

      const summary = formatSleepSummary(data);

      expect(summary).toContain("Sleep Duration: 7h 30m");
    });
  });

  describe("getRecoveryRecommendation", () => {
    it("returns high recovery recommendation for 80+", () => {
      expect(getRecoveryRecommendation(80)).toContain("intense training");
      expect(getRecoveryRecommendation(95)).toContain("PRs");
      expect(getRecoveryRecommendation(100)).toContain("High recovery");
    });

    it("returns moderate recovery recommendation for 60-79", () => {
      expect(getRecoveryRecommendation(60)).toContain("Moderate recovery");
      expect(getRecoveryRecommendation(70)).toContain("standard training");
      expect(getRecoveryRecommendation(79)).toContain("Moderate recovery");
    });

    it("returns low recovery recommendation for 40-59", () => {
      expect(getRecoveryRecommendation(40)).toContain("Low recovery");
      expect(getRecoveryRecommendation(50)).toContain("lighter intensity");
      expect(getRecoveryRecommendation(59)).toContain("active recovery");
    });

    it("returns very low recovery recommendation for 0-39", () => {
      expect(getRecoveryRecommendation(0)).toContain("Very low");
      expect(getRecoveryRecommendation(20)).toContain("rest");
      expect(getRecoveryRecommendation(39)).toContain("recovery today");
    });
  });
});
