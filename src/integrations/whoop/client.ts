/**
 * Whoop API Client
 *
 * Wraps the Whoop Developer API v2 for fetching user data.
 * Based on: https://developer.whoop.com/api
 */

import type { TokenSet } from "../types.js";
import {
  getStoredTokens,
  getTokensFromGitHub,
  isTokenExpired,
  refreshAccessToken,
  persistTokens,
} from "./oauth.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const WHOOP_API = "https://api.prod.whoop.com/developer/v2";

// ─────────────────────────────────────────────────────────────────────────────
// API Response Types (from Whoop API)
// ─────────────────────────────────────────────────────────────────────────────

export interface WhoopUser {
  user_id: number;
  email: string;
  first_name: string;
  last_name: string;
}

export interface WhoopSleep {
  id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;
  end: string;
  timezone_offset: string;
  nap: boolean;
  score_state: "SCORED" | "PENDING_SCORE" | "UNSCORABLE";
  score?: {
    stage_summary: {
      total_in_bed_time_milli: number;
      total_awake_time_milli: number;
      total_no_data_time_milli: number;
      total_light_sleep_time_milli: number;
      total_slow_wave_sleep_time_milli: number;
      total_rem_sleep_time_milli: number;
      sleep_cycle_count: number;
      disturbance_count: number;
    };
    sleep_needed: {
      baseline_milli: number;
      need_from_sleep_debt_milli: number;
      need_from_recent_strain_milli: number;
      need_from_recent_nap_milli: number;
    };
    respiratory_rate: number;
    sleep_performance_percentage: number;
    sleep_consistency_percentage: number;
    sleep_efficiency_percentage: number;
  };
}

export interface WhoopRecovery {
  cycle_id: number;
  sleep_id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  score_state: "SCORED" | "PENDING_SCORE" | "UNSCORABLE";
  score?: {
    user_calibrating: boolean;
    recovery_score: number;
    resting_heart_rate: number;
    hrv_rmssd_milli: number;
    spo2_percentage?: number;
    skin_temp_celsius?: number;
  };
}

export interface WhoopWorkout {
  id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;
  end: string;
  timezone_offset: string;
  sport_id: number;
  score_state: "SCORED" | "PENDING_SCORE" | "UNSCORABLE";
  score?: {
    strain: number;
    average_heart_rate: number;
    max_heart_rate: number;
    kilojoule: number;
    percent_recorded: number;
    distance_meter?: number;
    altitude_gain_meter?: number;
    altitude_change_meter?: number;
    zone_duration: {
      zone_zero_milli: number;
      zone_one_milli: number;
      zone_two_milli: number;
      zone_three_milli: number;
      zone_four_milli: number;
      zone_five_milli: number;
    };
  };
}

export interface WhoopCycle {
  id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;
  end?: string;
  timezone_offset: string;
  score_state: "SCORED" | "PENDING_SCORE" | "UNSCORABLE";
  score?: {
    strain: number;
    kilojoule: number;
    average_heart_rate: number;
    max_heart_rate: number;
  };
}

interface PaginatedResponse<T> {
  records: T[];
  next_token?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sport ID Mapping
// ─────────────────────────────────────────────────────────────────────────────

/** Map Whoop sport IDs to human-readable names */
export const SPORT_NAMES: Record<number, string> = {
  [-1]: "Activity",
  0: "Running",
  1: "Cycling",
  16: "Baseball",
  17: "Basketball",
  18: "Rowing",
  19: "Fencing",
  20: "Field Hockey",
  21: "Football",
  22: "Golf",
  24: "Ice Hockey",
  25: "Lacrosse",
  27: "Rugby",
  28: "Sailing",
  29: "Skiing",
  30: "Soccer",
  31: "Softball",
  32: "Squash",
  33: "Swimming",
  34: "Tennis",
  35: "Track & Field",
  36: "Volleyball",
  37: "Water Polo",
  38: "Wrestling",
  39: "Boxing",
  42: "Dance",
  43: "Pilates",
  44: "Yoga",
  45: "Weightlifting",
  47: "Cross Country Skiing",
  48: "Functional Fitness",
  49: "Duathlon",
  51: "Gymnastics",
  52: "Hiking/Rucking",
  53: "Horseback Riding",
  55: "Kayaking",
  56: "Martial Arts",
  57: "Mountain Biking",
  59: "Powerlifting",
  60: "Rock Climbing",
  61: "Paddleboarding",
  62: "Triathlon",
  63: "Walking",
  64: "Surfing",
  65: "Elliptical",
  66: "Stairmaster",
  70: "Meditation",
  71: "Other",
  73: "Diving",
  74: "Operations - Loss",
  75: "Operations - Tactical",
  76: "Operations - High",
  77: "Water Aerobics",
  82: "Spin",
  83: "Jiu Jitsu",
  84: "Stretching",
  85: "Jogging",
  86: "Massage Therapy",
  87: "Sauna",
  88: "Cold Exposure",
  89: "Assault Bike",
  90: "Kickboxing",
  91: "Obstacle Course Racing",
  92: "Motor Racing",
  93: "HIIT",
  94: "Caddying",
  95: "Ultimate Frisbee",
  96: "Breathwork",
  97: "Jumping Rope",
  98: "F45 Training",
  99: "Barry's",
  100: "CrossFit",
  101: "Orange Theory Fitness",
  102: "SoulCycle",
  103: "Peloton Bike",
  104: "Peloton Tread",
  105: "Peloton Floor",
};

/**
 * Get sport name from sport ID
 */
export function getSportName(sportId: number): string {
  return SPORT_NAMES[sportId] || "Activity";
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiting
// ─────────────────────────────────────────────────────────────────────────────

const MAX_RETRIES = 4;
const INITIAL_BACKOFF_MS = 1000;

/**
 * Sleep for a specified number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// Client Class
// ─────────────────────────────────────────────────────────────────────────────

export class WhoopClient {
  private tokens: TokenSet;

  constructor(tokens: TokenSet) {
    this.tokens = tokens;
  }

  /**
   * Update the client's tokens (after refresh).
   */
  updateTokens(tokens: TokenSet): void {
    this.tokens = tokens;
  }

  /**
   * Get the current tokens.
   */
  getTokens(): TokenSet {
    return this.tokens;
  }

  /**
   * Create a client from stored tokens (GitHub-backed).
   * Automatically refreshes if expired and persists the new tokens.
   * If refresh fails (e.g. another instance used the refresh token), re-reads from GitHub.
   */
  static async fromEnvironment(): Promise<WhoopClient> {
    const tokens = await getStoredTokens();
    if (!tokens) {
      throw new Error("Whoop tokens not configured");
    }

    // Refresh if expired
    if (isTokenExpired(tokens)) {
      console.log("[whoop] Access token expired, refreshing...");
      try {
        const newTokens = await refreshAccessToken(tokens.refreshToken);
        await persistTokens(newTokens);
        return new WhoopClient(newTokens);
      } catch (error) {
        // Refresh failed - another instance may have already rotated the refresh token.
        // Re-read from GitHub to get the tokens that instance persisted.
        console.warn("[whoop] Token refresh failed, re-reading from GitHub:", error);
        const freshResult = await getTokensFromGitHub();
        if (freshResult && !isTokenExpired(freshResult.tokens)) {
          return new WhoopClient(freshResult.tokens);
        }
        throw new Error("Whoop token refresh failed and no valid tokens found in GitHub");
      }
    }

    return new WhoopClient(tokens);
  }

  /**
   * Make an authenticated request to the Whoop API with retry logic.
   * Implements exponential backoff for rate limiting (429) and transient errors.
   */
  private async request<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${WHOOP_API}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        console.log(`[whoop] Retry ${attempt}/${MAX_RETRIES} after ${backoffMs}ms`);
        await sleep(backoffMs);
      }

      try {
        const response = await fetch(url.toString(), {
          headers: {
            Authorization: `Bearer ${this.tokens.accessToken}`,
          },
        });

        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = response.headers.get("Retry-After");
          const waitMs = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : INITIAL_BACKOFF_MS * Math.pow(2, attempt);
          console.log(`[whoop] Rate limited, waiting ${waitMs}ms`);
          lastError = new Error("Rate limited by Whoop API");
          continue;
        }

        // Handle server errors (retriable)
        if (response.status >= 500 && response.status < 600) {
          const error = await response.text();
          lastError = new Error(`Whoop API server error: ${response.status} - ${error}`);
          continue;
        }

        // Handle client errors (not retriable)
        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Whoop API error: ${response.status} - ${error}`);
        }

        return response.json() as Promise<T>;
      } catch (error) {
        // Network errors are retriable
        if (error instanceof TypeError && error.message.includes("fetch")) {
          lastError = error;
          continue;
        }
        throw error;
      }
    }

    throw lastError || new Error("Max retries exceeded");
  }

  /**
   * Get the authenticated user's profile.
   */
  async getUser(): Promise<WhoopUser> {
    return this.request<WhoopUser>("/user/profile/basic");
  }

  /**
   * Get sleep records for a date range.
   *
   * @param startDate - ISO date string (YYYY-MM-DD)
   * @param endDate - ISO date string (YYYY-MM-DD)
   */
  async getSleep(startDate: string, endDate: string): Promise<WhoopSleep[]> {
    const allRecords: WhoopSleep[] = [];
    let nextToken: string | undefined;

    do {
      const params: Record<string, string> = {
        start: `${startDate}T00:00:00.000Z`,
        end: `${endDate}T23:59:59.999Z`,
      };
      if (nextToken) {
        params.nextToken = nextToken;
      }

      const response = await this.request<PaginatedResponse<WhoopSleep>>("/activity/sleep", params);
      allRecords.push(...response.records);
      nextToken = response.next_token;
    } while (nextToken);

    return allRecords;
  }

  /**
   * Get a single sleep record by ID.
   */
  async getSleepById(sleepId: number | string): Promise<WhoopSleep> {
    return this.request<WhoopSleep>(`/activity/sleep/${sleepId}`);
  }

  /**
   * Get recovery records for a date range.
   *
   * @param startDate - ISO date string (YYYY-MM-DD)
   * @param endDate - ISO date string (YYYY-MM-DD)
   */
  async getRecovery(startDate: string, endDate: string): Promise<WhoopRecovery[]> {
    const allRecords: WhoopRecovery[] = [];
    let nextToken: string | undefined;

    do {
      const params: Record<string, string> = {
        start: `${startDate}T00:00:00.000Z`,
        end: `${endDate}T23:59:59.999Z`,
      };
      if (nextToken) {
        params.nextToken = nextToken;
      }

      const response = await this.request<PaginatedResponse<WhoopRecovery>>("/recovery", params);
      allRecords.push(...response.records);
      nextToken = response.next_token;
    } while (nextToken);

    return allRecords;
  }

  /**
   * Get workout records for a date range.
   *
   * @param startDate - ISO date string (YYYY-MM-DD)
   * @param endDate - ISO date string (YYYY-MM-DD)
   */
  async getWorkouts(startDate: string, endDate: string): Promise<WhoopWorkout[]> {
    const allRecords: WhoopWorkout[] = [];
    let nextToken: string | undefined;

    do {
      const params: Record<string, string> = {
        start: `${startDate}T00:00:00.000Z`,
        end: `${endDate}T23:59:59.999Z`,
      };
      if (nextToken) {
        params.nextToken = nextToken;
      }

      const response = await this.request<PaginatedResponse<WhoopWorkout>>(
        "/activity/workout",
        params
      );
      allRecords.push(...response.records);
      nextToken = response.next_token;
    } while (nextToken);

    return allRecords;
  }

  /**
   * Get a single workout record by ID.
   */
  async getWorkoutById(workoutId: number | string): Promise<WhoopWorkout> {
    return this.request<WhoopWorkout>(`/activity/workout/${workoutId}`);
  }

  /**
   * Get cycle (daily strain) records for a date range.
   *
   * @param startDate - ISO date string (YYYY-MM-DD)
   * @param endDate - ISO date string (YYYY-MM-DD)
   */
  async getCycles(startDate: string, endDate: string): Promise<WhoopCycle[]> {
    const allRecords: WhoopCycle[] = [];
    let nextToken: string | undefined;

    do {
      const params: Record<string, string> = {
        start: `${startDate}T00:00:00.000Z`,
        end: `${endDate}T23:59:59.999Z`,
      };
      if (nextToken) {
        params.nextToken = nextToken;
      }

      const response = await this.request<PaginatedResponse<WhoopCycle>>("/cycle", params);
      allRecords.push(...response.records);
      nextToken = response.next_token;
    } while (nextToken);

    return allRecords;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a Whoop client from environment tokens.
 * Returns null if not configured.
 */
export async function createWhoopClient(): Promise<WhoopClient | null> {
  try {
    return await WhoopClient.fromEnvironment();
  } catch (error) {
    console.error("[whoop] Failed to create client:", error);
    return null;
  }
}
