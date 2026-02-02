import { localToUtcSchedule, adjustDayOfWeek, generateCrontab } from "./generate-crontab.js";

describe("generate-crontab", () => {
  const originalEnv = process.env.TIMEZONE;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.TIMEZONE;
    } else {
      process.env.TIMEZONE = originalEnv;
    }
  });

  describe("localToUtcSchedule", () => {
    it("converts America/New_York time to UTC (EST = UTC-5)", () => {
      // 6:00 AM EST = 11:00 AM UTC
      const result = localToUtcSchedule(6, 0, "America/New_York");
      expect(result.utcHour).toBe(11);
      expect(result.utcMinute).toBe(0);
      expect(result.dayOffset).toBe(0);
    });

    it("converts America/New_York evening to next day UTC", () => {
      // 8:00 PM EST = 1:00 AM UTC next day
      const result = localToUtcSchedule(20, 0, "America/New_York");
      expect(result.utcHour).toBe(1);
      expect(result.utcMinute).toBe(0);
      expect(result.dayOffset).toBe(1);
    });

    it("converts Europe/London time to UTC (same in winter)", () => {
      // Note: This test assumes we're not in DST
      // In winter, London is UTC+0, so times are the same
      const result = localToUtcSchedule(6, 0, "Europe/London");
      // Should be same time (offset depends on DST)
      expect(result.utcHour + result.dayOffset * 24).toBeGreaterThanOrEqual(5);
      expect(result.utcHour + result.dayOffset * 24).toBeLessThanOrEqual(7);
    });

    it("converts Asia/Tokyo time to UTC (JST = UTC+9)", () => {
      // 6:00 AM JST = 9:00 PM UTC previous day (21:00)
      const result = localToUtcSchedule(6, 0, "Asia/Tokyo");
      expect(result.utcHour).toBe(21);
      expect(result.utcMinute).toBe(0);
      expect(result.dayOffset).toBe(-1);
    });

    it("handles minutes correctly", () => {
      const result = localToUtcSchedule(19, 30, "America/New_York");
      expect(result.utcMinute).toBe(30);
    });
  });

  describe("adjustDayOfWeek", () => {
    it("returns same day spec when offset is 0", () => {
      expect(adjustDayOfWeek("0", 0)).toBe("0");
      expect(adjustDayOfWeek("1-5", 0)).toBe("1-5");
      expect(adjustDayOfWeek("*", 0)).toBe("*");
    });

    it("shifts single day forward by 1", () => {
      expect(adjustDayOfWeek("0", 1)).toBe("1"); // Sunday -> Monday
      expect(adjustDayOfWeek("6", 1)).toBe("0"); // Saturday -> Sunday (wraps)
    });

    it("shifts single day backward by 1", () => {
      expect(adjustDayOfWeek("1", -1)).toBe("0"); // Monday -> Sunday
      expect(adjustDayOfWeek("0", -1)).toBe("6"); // Sunday -> Saturday (wraps)
    });

    it("shifts day range forward by 1", () => {
      expect(adjustDayOfWeek("1-5", 1)).toBe("2-6"); // Mon-Fri -> Tue-Sat
    });

    it("shifts day range backward by 1", () => {
      expect(adjustDayOfWeek("1-5", -1)).toBe("0-4"); // Mon-Fri -> Sun-Thu
    });
  });

  describe("generateCrontab", () => {
    it("generates crontab with default timezone", () => {
      delete process.env.TIMEZONE;
      const crontab = generateCrontab();

      expect(crontab).toContain("# Generated for timezone: America/New_York");
      expect(crontab).toContain("check-reminders");
      expect(crontab).toContain("daily-reminder");
      expect(crontab).toContain("weekly-plan");
    });

    it("uses TIMEZONE env var when set", () => {
      process.env.TIMEZONE = "Europe/London";
      const crontab = generateCrontab();

      expect(crontab).toContain("# Generated for timezone: Europe/London");
    });

    it("generates valid cron expressions", () => {
      const crontab = generateCrontab();
      const lines = crontab.split("\n").filter((l) => l && !l.startsWith("#"));

      for (const line of lines) {
        // Each cron line should have 5 time fields + command
        const parts = line.split(" ");
        expect(parts.length).toBeGreaterThanOrEqual(6);

        // First 5 parts should be valid cron fields
        const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
        expect(minute).toMatch(/^\d+$|^\*$/);
        expect(hour).toMatch(/^\d+$|^\*$/);
        expect(dayOfMonth).toMatch(/^\d+$|^\*$/);
        expect(month).toMatch(/^\d+$|^\*$/);
        expect(dayOfWeek).toMatch(/^[\d-]+$|^\*$/);
      }
    });

    it("includes hourly check-reminders", () => {
      const crontab = generateCrontab();
      expect(crontab).toContain("0 * * * *");
    });
  });
});
