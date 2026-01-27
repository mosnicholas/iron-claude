/**
 * Integration Data Storage
 *
 * Stores normalized integration data in the fitness-data repository.
 * Data is organized by week (matching the existing structure) with integration
 * data stored alongside workout logs and plans.
 *
 * Structure:
 *   weeks/YYYY-WXX/
 *   ├── plan.md
 *   ├── retro.md
 *   ├── YYYY-MM-DD.md (workout logs)
 *   └── integrations/
 *       ├── YYYY-MM-DD-whoop-sleep.json
 *       ├── YYYY-MM-DD-whoop-recovery.json
 *       └── YYYY-MM-DD-whoop-workout-weightlifting.json
 */

import { createGitHubStorage } from "../storage/github.js";
import type { WebhookEvent, SleepData, RecoveryData, WorkoutData } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Date/Week Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the ISO week string (YYYY-WXX) for a given date.
 */
export function getISOWeek(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00Z"); // Noon UTC to avoid timezone issues
  const year = date.getFullYear();

  // Get the first Thursday of the year (ISO week 1 contains first Thursday)
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = jan4.getDay() || 7; // Sunday = 7
  const firstThursday = new Date(jan4);
  firstThursday.setDate(jan4.getDate() - dayOfWeek + 4);

  // Calculate week number
  const diffMs = date.getTime() - firstThursday.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  const weekNum = Math.ceil((diffDays + 1) / 7);

  // Handle year boundaries (week 52/53 spillover)
  if (weekNum < 1) {
    return getISOWeek(`${year - 1}-12-28`);
  }
  if (weekNum > 52) {
    const dec28 = new Date(year, 11, 28);
    const lastWeekDay = dec28.getDay() || 7;
    const lastThursday = new Date(dec28);
    lastThursday.setDate(dec28.getDate() - lastWeekDay + 4);
    if (date > lastThursday) {
      return `${year + 1}-W01`;
    }
  }

  return `${year}-W${String(weekNum).padStart(2, "0")}`;
}

/**
 * Get today's date in YYYY-MM-DD format.
 */
function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage Paths
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the storage path for integration data.
 *
 * Format: weeks/YYYY-WXX/integrations/YYYY-MM-DD-{source}-{type}[-{subtype}].json
 */
function getStoragePath(
  source: string,
  type: "sleep" | "recovery" | "workout",
  date: string,
  workoutType?: string
): string {
  const week = getISOWeek(date);
  const basePath = `weeks/${week}/integrations`;

  switch (type) {
    case "sleep":
      return `${basePath}/${date}-${source}-sleep.json`;
    case "recovery":
      return `${basePath}/${date}-${source}-recovery.json`;
    case "workout": {
      const sanitizedType = (workoutType || "activity").toLowerCase().replace(/\s+/g, "-");
      return `${basePath}/${date}-${source}-workout-${sanitizedType}.json`;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Store Data
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Store normalized integration data in the fitness-data repo.
 */
export async function storeIntegrationData(event: WebhookEvent): Promise<void> {
  const storage = createGitHubStorage();

  let path: string;
  let content: string;
  let message: string;

  switch (event.type) {
    case "sleep":
      path = getStoragePath(event.data.source, "sleep", event.data.date);
      content = JSON.stringify(event.data, null, 2);
      message = `Sync ${event.data.source} sleep data for ${event.data.date}`;
      break;

    case "recovery":
      path = getStoragePath(event.data.source, "recovery", event.data.date);
      content = JSON.stringify(event.data, null, 2);
      message = `Sync ${event.data.source} recovery data for ${event.data.date}`;
      break;

    case "workout":
      path = getStoragePath(event.data.source, "workout", event.data.date, event.data.type);
      content = JSON.stringify(event.data, null, 2);
      message = `Sync ${event.data.source} ${event.data.type} workout for ${event.data.date}`;
      break;
  }

  await storage.writeFile(path, content, message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Read Data
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read sleep data for a specific date and source.
 */
export async function readSleepData(source: string, date: string): Promise<SleepData | null> {
  const storage = createGitHubStorage();
  const path = getStoragePath(source, "sleep", date);

  const content = await storage.readFile(path);
  if (!content) return null;

  return JSON.parse(content) as SleepData;
}

/**
 * Read recovery data for a specific date and source.
 */
export async function readRecoveryData(source: string, date: string): Promise<RecoveryData | null> {
  const storage = createGitHubStorage();
  const path = getStoragePath(source, "recovery", date);

  const content = await storage.readFile(path);
  if (!content) return null;

  return JSON.parse(content) as RecoveryData;
}

/**
 * Read workout data for a specific date, source, and type.
 */
export async function readWorkoutData(
  source: string,
  date: string,
  workoutType: string
): Promise<WorkoutData | null> {
  const storage = createGitHubStorage();
  const path = getStoragePath(source, "workout", date, workoutType);

  const content = await storage.readFile(path);
  if (!content) return null;

  return JSON.parse(content) as WorkoutData;
}

// ─────────────────────────────────────────────────────────────────────────────
// Latest Data Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the most recent recovery data for a source.
 * Tries today first, then yesterday.
 */
export async function getLatestRecoveryData(source: string): Promise<RecoveryData | null> {
  // Try today
  let data = await readRecoveryData(source, getToday());
  if (data) return data;

  // Try yesterday
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  data = await readRecoveryData(source, yesterdayStr);
  return data;
}

/**
 * Get the most recent sleep data for a source.
 */
export async function getLatestSleepData(source: string): Promise<SleepData | null> {
  // Try today
  let data = await readSleepData(source, getToday());
  if (data) return data;

  // Try yesterday
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  data = await readSleepData(source, yesterdayStr);
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format recovery data as a human-readable summary.
 */
export function formatRecoverySummary(data: RecoveryData): string {
  const lines: string[] = [];

  lines.push(`Recovery Score: ${data.score}%`);

  if (data.hrv !== undefined) {
    lines.push(`HRV: ${data.hrv.toFixed(1)} ms`);
  }

  if (data.restingHeartRate !== undefined) {
    lines.push(`Resting HR: ${data.restingHeartRate} bpm`);
  }

  if (data.spo2 !== undefined) {
    lines.push(`SpO2: ${data.spo2}%`);
  }

  return lines.join("\n");
}

/**
 * Format sleep data as a human-readable summary.
 */
export function formatSleepSummary(data: SleepData): string {
  const lines: string[] = [];

  const hours = Math.floor(data.durationMinutes / 60);
  const mins = data.durationMinutes % 60;
  lines.push(`Sleep Duration: ${hours}h ${mins}m`);

  if (data.score !== undefined) {
    lines.push(`Sleep Score: ${data.score}%`);
  }

  if (data.stages) {
    lines.push(
      `Stages: ${data.stages.deep}m deep, ${data.stages.rem}m REM, ${data.stages.light}m light`
    );
  }

  return lines.join("\n");
}

/**
 * Get a recovery-based training recommendation.
 */
export function getRecoveryRecommendation(score: number): string {
  if (score >= 80) {
    return "High recovery - good day for intense training or PRs";
  } else if (score >= 60) {
    return "Moderate recovery - standard training intensity recommended";
  } else if (score >= 40) {
    return "Low recovery - consider lighter intensity or active recovery";
  } else {
    return "Very low recovery - prioritize rest and recovery today";
  }
}
