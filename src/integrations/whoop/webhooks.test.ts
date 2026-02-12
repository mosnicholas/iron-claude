import crypto from "node:crypto";
import {
  normalizeSleep,
  normalizeRecovery,
  normalizeWorkout,
  verifyWhoopWebhook,
} from "./webhooks.js";
import type { WhoopSleep, WhoopRecovery, WhoopWorkout } from "./client.js";
import type { Request } from "express";

describe("Whoop webhook normalization", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, TIMEZONE: "America/New_York" };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("normalizeSleep", () => {
    const mockWhoopSleep: WhoopSleep = {
      id: 12345,
      user_id: 67890,
      created_at: "2026-01-27T08:00:00.000Z",
      updated_at: "2026-01-27T08:30:00.000Z",
      start: "2026-01-26T23:00:00.000Z",
      end: "2026-01-27T07:00:00.000Z",
      timezone_offset: "-05:00",
      nap: false,
      score_state: "SCORED",
      score: {
        stage_summary: {
          total_in_bed_time_milli: 28800000, // 8 hours
          total_awake_time_milli: 2700000, // 45 min
          total_no_data_time_milli: 0,
          total_light_sleep_time_milli: 12000000, // 200 min
          total_slow_wave_sleep_time_milli: 5100000, // 85 min
          total_rem_sleep_time_milli: 5400000, // 90 min
          sleep_cycle_count: 4,
          disturbance_count: 2,
        },
        sleep_needed: {
          baseline_milli: 28800000,
          need_from_sleep_debt_milli: 0,
          need_from_recent_strain_milli: 1800000,
          need_from_recent_nap_milli: 0,
        },
        respiratory_rate: 14.5,
        sleep_performance_percentage: 85,
        sleep_consistency_percentage: 90,
        sleep_efficiency_percentage: 88,
      },
    };

    it("normalizes sleep data correctly", () => {
      const normalized = normalizeSleep(mockWhoopSleep);

      expect(normalized.source).toBe("whoop");
      expect(normalized.date).toBe("2026-01-26");
      expect(normalized.startTime).toBe("2026-01-26T23:00:00.000Z");
      expect(normalized.endTime).toBe("2026-01-27T07:00:00.000Z");
      expect(normalized.durationMinutes).toBe(480); // 8 hours
      expect(normalized.score).toBe(85);
    });

    it("calculates sleep stages correctly", () => {
      const normalized = normalizeSleep(mockWhoopSleep);

      expect(normalized.stages).toBeDefined();
      expect(normalized.stages?.rem).toBe(90); // 5400000 / 60000
      expect(normalized.stages?.deep).toBe(85); // 5100000 / 60000
      expect(normalized.stages?.light).toBe(200); // 12000000 / 60000
      expect(normalized.stages?.awake).toBe(45); // 2700000 / 60000
    });

    it("includes raw data", () => {
      const normalized = normalizeSleep(mockWhoopSleep);

      expect(normalized.raw).toBe(mockWhoopSleep);
    });

    it("handles sleep without score", () => {
      const unscoredSleep: WhoopSleep = {
        ...mockWhoopSleep,
        score_state: "PENDING_SCORE",
        score: undefined,
      };

      const normalized = normalizeSleep(unscoredSleep);

      expect(normalized.stages).toBeUndefined();
      expect(normalized.score).toBeUndefined();
    });

    it("uses local timezone date when UTC date differs from local date", () => {
      // 3am UTC on Jan 27 = 10pm EST on Jan 26
      const crossMidnightSleep: WhoopSleep = {
        ...mockWhoopSleep,
        start: "2026-01-27T03:00:00.000Z",
        end: "2026-01-27T11:00:00.000Z",
      };

      const normalized = normalizeSleep(crossMidnightSleep);

      // Should use the EST date (Jan 26), not the UTC date (Jan 27)
      expect(normalized.date).toBe("2026-01-26");
    });
  });

  describe("normalizeRecovery", () => {
    const mockWhoopRecovery: WhoopRecovery = {
      cycle_id: 11111,
      sleep_id: 12345,
      user_id: 67890,
      created_at: "2026-01-27T08:00:00.000Z",
      updated_at: "2026-01-27T08:30:00.000Z",
      score_state: "SCORED",
      score: {
        user_calibrating: false,
        recovery_score: 78,
        resting_heart_rate: 52,
        hrv_rmssd_milli: 45.2,
        spo2_percentage: 98,
        skin_temp_celsius: 0.2,
      },
    };

    it("normalizes recovery data correctly", () => {
      const normalized = normalizeRecovery(mockWhoopRecovery);

      expect(normalized.source).toBe("whoop");
      expect(normalized.date).toBe("2026-01-27");
      expect(normalized.score).toBe(78);
      expect(normalized.hrv).toBe(45.2);
      expect(normalized.restingHeartRate).toBe(52);
      expect(normalized.spo2).toBe(98);
      expect(normalized.skinTempDeviation).toBe(0.2);
    });

    it("includes raw data", () => {
      const normalized = normalizeRecovery(mockWhoopRecovery);

      expect(normalized.raw).toBe(mockWhoopRecovery);
    });

    it("handles recovery without score", () => {
      const unscoredRecovery: WhoopRecovery = {
        ...mockWhoopRecovery,
        score_state: "PENDING_SCORE",
        score: undefined,
      };

      const normalized = normalizeRecovery(unscoredRecovery);

      expect(normalized.score).toBe(0);
      expect(normalized.hrv).toBeUndefined();
    });

    it("uses local timezone date when UTC date differs from local date", () => {
      // 4am UTC on Jan 28 = 11pm EST on Jan 27
      const crossMidnightRecovery: WhoopRecovery = {
        ...mockWhoopRecovery,
        created_at: "2026-01-28T04:00:00.000Z",
      };

      const normalized = normalizeRecovery(crossMidnightRecovery);

      // Should use the EST date (Jan 27), not the UTC date (Jan 28)
      expect(normalized.date).toBe("2026-01-27");
    });
  });

  describe("normalizeWorkout", () => {
    const mockWhoopWorkout: WhoopWorkout = {
      id: 99999,
      user_id: 67890,
      created_at: "2026-01-27T10:00:00.000Z",
      updated_at: "2026-01-27T11:30:00.000Z",
      start: "2026-01-27T09:00:00.000Z",
      end: "2026-01-27T10:30:00.000Z",
      timezone_offset: "-05:00",
      sport_id: 45, // Weightlifting
      score_state: "SCORED",
      score: {
        strain: 12.5,
        average_heart_rate: 125,
        max_heart_rate: 165,
        kilojoule: 1255, // ~300 calories
        percent_recorded: 98,
        distance_meter: undefined,
        altitude_gain_meter: undefined,
        altitude_change_meter: undefined,
        zone_duration: {
          zone_zero_milli: 300000,
          zone_one_milli: 900000,
          zone_two_milli: 1800000,
          zone_three_milli: 1500000,
          zone_four_milli: 600000,
          zone_five_milli: 300000,
        },
      },
    };

    it("normalizes workout data correctly", () => {
      const normalized = normalizeWorkout(mockWhoopWorkout);

      expect(normalized.source).toBe("whoop");
      expect(normalized.date).toBe("2026-01-27");
      expect(normalized.type).toBe("Weightlifting");
      expect(normalized.durationMinutes).toBe(90); // 1.5 hours
      expect(normalized.strain).toBe(12.5);
      expect(normalized.heartRateAvg).toBe(125);
      expect(normalized.heartRateMax).toBe(165);
    });

    it("converts kilojoules to calories", () => {
      const normalized = normalizeWorkout(mockWhoopWorkout);

      // 1255 kJ / 4.184 = ~300 calories
      expect(normalized.calories).toBe(300);
    });

    it("includes raw data", () => {
      const normalized = normalizeWorkout(mockWhoopWorkout);

      expect(normalized.raw).toBe(mockWhoopWorkout);
    });

    it("handles workout without score", () => {
      const unscoredWorkout: WhoopWorkout = {
        ...mockWhoopWorkout,
        score_state: "PENDING_SCORE",
        score: undefined,
      };

      const normalized = normalizeWorkout(unscoredWorkout);

      expect(normalized.strain).toBeUndefined();
      expect(normalized.calories).toBeUndefined();
      expect(normalized.heartRateAvg).toBeUndefined();
    });

    it("maps unknown sport_id to Activity", () => {
      const unknownSportWorkout: WhoopWorkout = {
        ...mockWhoopWorkout,
        sport_id: 9999,
      };

      const normalized = normalizeWorkout(unknownSportWorkout);

      expect(normalized.type).toBe("Activity");
    });

    it("uses local timezone date when UTC date differs from local date", () => {
      // 2am UTC on Jan 28 = 9pm EST on Jan 27
      const crossMidnightWorkout: WhoopWorkout = {
        ...mockWhoopWorkout,
        start: "2026-01-28T02:00:00.000Z",
        end: "2026-01-28T03:30:00.000Z",
      };

      const normalized = normalizeWorkout(crossMidnightWorkout);

      // Should use the EST date (Jan 27), not the UTC date (Jan 28)
      expect(normalized.date).toBe("2026-01-27");
    });
  });
});

describe("Whoop webhook verification", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function createMockRequest(body: unknown, headers: Record<string, string> = {}): Request {
    return {
      body,
      headers,
    } as unknown as Request;
  }

  describe("payload structure validation", () => {
    it("rejects null payload", () => {
      const req = createMockRequest(null);
      expect(verifyWhoopWebhook(req)).toBe(false);
    });

    it("rejects non-object payload", () => {
      const req = createMockRequest("not an object");
      expect(verifyWhoopWebhook(req)).toBe(false);
    });

    it("rejects payload without type", () => {
      const req = createMockRequest({ user_id: 123, id: 456 });
      expect(verifyWhoopWebhook(req)).toBe(false);
    });

    it("rejects payload with invalid type", () => {
      const req = createMockRequest({ type: "invalid", user_id: 123, id: 456 });
      expect(verifyWhoopWebhook(req)).toBe(false);
    });

    it("rejects payload with old-style type (without action)", () => {
      const req = createMockRequest({ type: "sleep", user_id: 123, id: 456 });
      expect(verifyWhoopWebhook(req)).toBe(false);
    });

    it("rejects payload without user_id", () => {
      const req = createMockRequest({ type: "sleep.updated", id: 456 });
      expect(verifyWhoopWebhook(req)).toBe(false);
    });

    it("rejects payload without id", () => {
      const req = createMockRequest({ type: "sleep.updated", user_id: 123 });
      expect(verifyWhoopWebhook(req)).toBe(false);
    });

    it("accepts valid sleep.updated payload", () => {
      const req = createMockRequest({ type: "sleep.updated", user_id: 123, id: 456 });
      expect(verifyWhoopWebhook(req)).toBe(true);
    });

    it("accepts valid sleep.deleted payload", () => {
      const req = createMockRequest({ type: "sleep.deleted", user_id: 123, id: 456 });
      expect(verifyWhoopWebhook(req)).toBe(true);
    });

    it("accepts valid recovery.updated payload", () => {
      const req = createMockRequest({ type: "recovery.updated", user_id: 123, id: 456 });
      expect(verifyWhoopWebhook(req)).toBe(true);
    });

    it("accepts valid workout.updated payload", () => {
      const req = createMockRequest({ type: "workout.updated", user_id: 123, id: 456 });
      expect(verifyWhoopWebhook(req)).toBe(true);
    });

    it("accepts UUID string id (v2 webhooks)", () => {
      const req = createMockRequest({
        type: "sleep.updated",
        user_id: 123,
        id: "550e8400-e29b-41d4-a716-446655440000",
      });
      expect(verifyWhoopWebhook(req)).toBe(true);
    });
  });

  describe("HMAC signature verification", () => {
    const webhookSecret = "test-webhook-secret";

    beforeEach(() => {
      process.env.WHOOP_WEBHOOK_SECRET = webhookSecret;
    });

    it("rejects request without signature when secret is configured", () => {
      const req = createMockRequest({ type: "sleep.updated", user_id: 123, id: 456 });
      expect(verifyWhoopWebhook(req)).toBe(false);
    });

    it("rejects request with invalid signature", () => {
      const req = createMockRequest(
        { type: "sleep.updated", user_id: 123, id: 456 },
        { "x-whoop-signature": "invalid-signature" }
      );
      expect(verifyWhoopWebhook(req)).toBe(false);
    });

    it("accepts request with valid HMAC signature", () => {
      const payload = { type: "sleep.updated", user_id: 123, id: 456 };
      const payloadString = JSON.stringify(payload);
      const signature = crypto
        .createHmac("sha256", webhookSecret)
        .update(payloadString)
        .digest("hex");

      const req = createMockRequest(payload, { "x-whoop-signature": signature });
      expect(verifyWhoopWebhook(req)).toBe(true);
    });
  });

  describe("user ID verification", () => {
    beforeEach(() => {
      process.env.WHOOP_USER_ID = "12345";
    });

    it("rejects webhook from different user", () => {
      const req = createMockRequest({ type: "sleep.updated", user_id: 99999, id: 456 });
      expect(verifyWhoopWebhook(req)).toBe(false);
    });

    it("accepts webhook from expected user", () => {
      const req = createMockRequest({ type: "sleep.updated", user_id: 12345, id: 456 });
      expect(verifyWhoopWebhook(req)).toBe(true);
    });
  });

  describe("combined verification", () => {
    const webhookSecret = "combined-test-secret";

    beforeEach(() => {
      process.env.WHOOP_WEBHOOK_SECRET = webhookSecret;
      process.env.WHOOP_USER_ID = "12345";
    });

    it("accepts request with valid signature and matching user", () => {
      const payload = { type: "recovery.updated", user_id: 12345, id: 789 };
      const payloadString = JSON.stringify(payload);
      const signature = crypto
        .createHmac("sha256", webhookSecret)
        .update(payloadString)
        .digest("hex");

      const req = createMockRequest(payload, { "x-whoop-signature": signature });
      expect(verifyWhoopWebhook(req)).toBe(true);
    });

    it("rejects request with valid signature but wrong user", () => {
      const payload = { type: "recovery.updated", user_id: 99999, id: 789 };
      const payloadString = JSON.stringify(payload);
      const signature = crypto
        .createHmac("sha256", webhookSecret)
        .update(payloadString)
        .digest("hex");

      const req = createMockRequest(payload, { "x-whoop-signature": signature });
      expect(verifyWhoopWebhook(req)).toBe(false);
    });
  });
});
