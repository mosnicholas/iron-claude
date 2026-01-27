/**
 * Integration Data Storage
 *
 * Stores normalized integration data in the fitness-data repository.
 * Data is organized by source and type for easy access by the coach agent.
 */

import { createGitHubStorage } from "../storage/github.js";
import type { WebhookEvent, SleepData, RecoveryData, WorkoutData } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Storage Paths
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the storage path for a data type.
 *
 * Structure:
 *   integrations/{source}/sleep/{date}.json
 *   integrations/{source}/recovery/{date}.json
 *   integrations/{source}/workouts/{date}-{type}.json
 */
function getStoragePath(
  source: string,
  type: "sleep" | "recovery" | "workout",
  date: string,
  workoutType?: string
): string {
  const basePath = `integrations/${source}`;

  switch (type) {
    case "sleep":
      return `${basePath}/sleep/${date}.json`;
    case "recovery":
      return `${basePath}/recovery/${date}.json`;
    case "workout": {
      // Include workout type in filename to support multiple workouts per day
      const sanitizedType = (workoutType || "activity").toLowerCase().replace(/\s+/g, "-");
      return `${basePath}/workouts/${date}-${sanitizedType}.json`;
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
 * Read all workout data for a specific date from all sources.
 * Note: This requires listing files, which we'll do via the coach agent.
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
 * Get today's date in YYYY-MM-DD format.
 */
function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

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
