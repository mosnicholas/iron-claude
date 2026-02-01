/**
 * Integration Data Storage
 *
 * Stores normalized integration data in workout log frontmatter.
 * This keeps all data for a day in one place, making it easy for the
 * coach agent to read context and provide advice.
 *
 * Example workout file with integration data:
 * ```markdown
 * ---
 * date: "2026-01-27"
 * type: upper
 * status: in_progress
 * whoop:
 *   recovery:
 *     score: 78
 *     hrv: 45.2
 *     restingHeartRate: 52
 *   sleep:
 *     durationMinutes: 420
 *     score: 85
 * ---
 * # Workout — Monday, Jan 27
 * ...
 * ```
 */

import { createGitHubStorage } from "../storage/github.js";
import { formatISOWeek, getTimezone } from "../utils/date.js";
import { toZonedTime } from "date-fns-tz";
import type { WebhookEvent, SleepData, RecoveryData, WorkoutData } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Frontmatter Parsing
// ─────────────────────────────────────────────────────────────────────────────

interface Frontmatter {
  [key: string]: unknown;
}

interface ParsedFile {
  frontmatter: Frontmatter;
  content: string;
}

/**
 * Parse YAML frontmatter from a markdown file.
 * Returns empty frontmatter if none exists.
 */
function parseFrontmatter(fileContent: string): ParsedFile {
  const trimmed = fileContent.trim();

  // Check for frontmatter delimiter
  if (!trimmed.startsWith("---")) {
    return { frontmatter: {}, content: fileContent };
  }

  // Find closing delimiter
  const endIndex = trimmed.indexOf("\n---", 3);
  if (endIndex === -1) {
    return { frontmatter: {}, content: fileContent };
  }

  const yamlContent = trimmed.slice(4, endIndex).trim();
  const content = trimmed.slice(endIndex + 4).trim();

  // Parse simple YAML (handles nested objects, strings, numbers, arrays)
  const frontmatter = parseSimpleYaml(yamlContent);

  return { frontmatter, content };
}

/**
 * Simple YAML parser for frontmatter.
 * Handles: strings, numbers, booleans, nested objects, simple arrays.
 */
function parseSimpleYaml(yaml: string): Frontmatter {
  const result: Frontmatter = {};
  const lines = yaml.split("\n");
  const stack: Array<{ obj: Frontmatter; indent: number }> = [{ obj: result, indent: -1 }];

  for (const line of lines) {
    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith("#")) continue;

    // Calculate indent level
    const indent = line.search(/\S/);
    const trimmedLine = line.trim();

    // Handle array items
    if (trimmedLine.startsWith("- ")) {
      const value = trimmedLine.slice(2).trim();
      const current = stack[stack.length - 1];
      const keys = Object.keys(current.obj);
      const lastKey = keys[keys.length - 1];
      if (lastKey && Array.isArray(current.obj[lastKey])) {
        (current.obj[lastKey] as unknown[]).push(parseYamlValue(value));
      }
      continue;
    }

    // Parse key: value
    const colonIndex = trimmedLine.indexOf(":");
    if (colonIndex === -1) continue;

    const key = trimmedLine.slice(0, colonIndex).trim();
    const rawValue = trimmedLine.slice(colonIndex + 1).trim();

    // Pop stack until we're at the right indent level
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const current = stack[stack.length - 1].obj;

    if (rawValue === "") {
      // Nested object or array starts
      const nextLine = lines[lines.indexOf(line) + 1];
      if (nextLine && nextLine.trim().startsWith("- ")) {
        current[key] = [];
      } else {
        current[key] = {};
      }
      stack.push({ obj: current[key] as Frontmatter, indent });
    } else {
      current[key] = parseYamlValue(rawValue);
    }
  }

  return result;
}

/**
 * Parse a YAML value (string, number, boolean, inline object).
 */
function parseYamlValue(value: string): unknown {
  // Remove quotes
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  // Boolean
  if (value === "true") return true;
  if (value === "false") return false;

  // Null
  if (value === "null" || value === "~") return null;

  // Number
  const num = Number(value);
  if (!isNaN(num) && value !== "") return num;

  // Inline object like { rem: 90, deep: 85 }
  if (value.startsWith("{") && value.endsWith("}")) {
    const inner = value.slice(1, -1).trim();
    const obj: Frontmatter = {};
    // Split by comma, handling potential spaces
    const pairs = inner.split(/,\s*/);
    for (const pair of pairs) {
      const [k, v] = pair.split(/:\s*/);
      if (k && v !== undefined) {
        obj[k.trim()] = parseYamlValue(v.trim());
      }
    }
    return obj;
  }

  return value;
}

/**
 * Serialize frontmatter to YAML string.
 */
function serializeFrontmatter(frontmatter: Frontmatter): string {
  const lines: string[] = ["---"];
  serializeObject(frontmatter, lines, 0);
  lines.push("---");
  return lines.join("\n");
}

function serializeObject(obj: Frontmatter, lines: string[], indent: number): void {
  const prefix = "  ".repeat(indent);

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;

    if (typeof value === "object" && !Array.isArray(value)) {
      lines.push(`${prefix}${key}:`);
      serializeObject(value as Frontmatter, lines, indent + 1);
    } else if (Array.isArray(value)) {
      lines.push(`${prefix}${key}:`);
      for (const item of value) {
        if (typeof item === "object") {
          lines.push(`${prefix}  - ${JSON.stringify(item)}`);
        } else {
          lines.push(`${prefix}  - ${serializeValue(item)}`);
        }
      }
    } else {
      lines.push(`${prefix}${key}: ${serializeValue(value)}`);
    }
  }
}

function serializeValue(value: unknown): string {
  if (typeof value === "string") {
    // Quote strings that might be ambiguous
    if (value.includes(":") || value.includes("#") || value === "" || /^\d/.test(value)) {
      return `"${value}"`;
    }
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Date/Week Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the ISO week string (YYYY-WXX) for a given date string.
 */
function getISOWeekForDate(dateStr: string): string {
  // Parse as noon UTC to avoid timezone issues
  const date = new Date(dateStr + "T12:00:00Z");
  return formatISOWeek(date);
}

/**
 * Get today's date in YYYY-MM-DD format using configured timezone.
 */
function getToday(): string {
  const timezone = getTimezone();
  const now = toZonedTime(new Date(), timezone);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// File Paths
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the workout file path for a given date.
 * Format: weeks/YYYY-WXX/YYYY-MM-DD.md
 */
function getWorkoutFilePath(date: string): string {
  const week = getISOWeekForDate(date);
  return `weeks/${week}/${date}.md`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Store Data
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Store normalized integration data in the workout file's frontmatter.
 */
export async function storeIntegrationData(event: WebhookEvent): Promise<void> {
  const storage = createGitHubStorage();
  const date = event.data.date;
  const source = event.data.source;
  const filePath = getWorkoutFilePath(date);

  // Read existing file or create new one
  const existingContent = await storage.readFile(filePath);
  let parsed: ParsedFile;

  if (existingContent) {
    parsed = parseFrontmatter(existingContent);
  } else {
    // Create minimal stub file for integration data
    parsed = {
      frontmatter: { date },
      content: `# ${date}\n\n*No workout logged yet.*`,
    };
  }

  // Ensure source namespace exists (e.g., "whoop")
  if (!parsed.frontmatter[source]) {
    parsed.frontmatter[source] = {};
  }
  const sourceData = parsed.frontmatter[source] as Frontmatter;

  // Add the integration data under the appropriate key
  switch (event.type) {
    case "sleep":
      sourceData.sleep = formatSleepForFrontmatter(event.data);
      break;
    case "recovery":
      sourceData.recovery = formatRecoveryForFrontmatter(event.data);
      break;
    case "workout": {
      // Store workouts in an array since there can be multiple
      if (!sourceData.workouts) {
        sourceData.workouts = [];
      }
      const workouts = sourceData.workouts as WorkoutData[];
      // Replace existing workout of same type or add new
      const existingIndex = workouts.findIndex((w) => w.type === event.data.type);
      if (existingIndex >= 0) {
        workouts[existingIndex] = formatWorkoutForFrontmatter(event.data);
      } else {
        workouts.push(formatWorkoutForFrontmatter(event.data));
      }
      break;
    }
  }

  // Rebuild the file
  const newFrontmatter = serializeFrontmatter(parsed.frontmatter);
  const newContent = `${newFrontmatter}\n\n${parsed.content}`;

  // Commit message
  const message = `Sync ${source} ${event.type} data for ${date}`;

  await storage.writeFile(filePath, newContent, message);
}

/**
 * Format sleep data for frontmatter (remove redundant fields).
 */
function formatSleepForFrontmatter(data: SleepData): Frontmatter {
  const result: Frontmatter = {
    durationMinutes: data.durationMinutes,
  };
  if (data.score !== undefined) result.score = data.score;
  if (data.stages) result.stages = data.stages;
  if (data.startTime) result.startTime = data.startTime;
  if (data.endTime) result.endTime = data.endTime;
  return result;
}

/**
 * Format recovery data for frontmatter (remove redundant fields).
 */
function formatRecoveryForFrontmatter(data: RecoveryData): Frontmatter {
  const result: Frontmatter = {
    score: data.score,
  };
  if (data.hrv !== undefined) result.hrv = data.hrv;
  if (data.restingHeartRate !== undefined) result.restingHeartRate = data.restingHeartRate;
  if (data.spo2 !== undefined) result.spo2 = data.spo2;
  if (data.skinTempDeviation !== undefined) result.skinTempDeviation = data.skinTempDeviation;
  return result;
}

/**
 * Format workout data for frontmatter.
 */
function formatWorkoutForFrontmatter(data: WorkoutData): WorkoutData {
  // Return a clean copy without source/date (already in file context)
  const { source: _source, date: _date, ...rest } = data;
  return rest as WorkoutData;
}

// ─────────────────────────────────────────────────────────────────────────────
// Read Data
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read integration data from a workout file's frontmatter.
 */
async function readIntegrationData(
  source: string,
  date: string
): Promise<{ sleep?: SleepData; recovery?: RecoveryData; workouts?: WorkoutData[] } | null> {
  const storage = createGitHubStorage();
  const filePath = getWorkoutFilePath(date);

  const content = await storage.readFile(filePath);
  if (!content) return null;

  const parsed = parseFrontmatter(content);
  const sourceData = parsed.frontmatter[source] as Frontmatter | undefined;
  if (!sourceData) return null;

  const result: { sleep?: SleepData; recovery?: RecoveryData; workouts?: WorkoutData[] } = {};

  if (sourceData.sleep) {
    result.sleep = {
      source,
      date,
      ...(sourceData.sleep as object),
    } as SleepData;
  }

  if (sourceData.recovery) {
    result.recovery = {
      source,
      date,
      ...(sourceData.recovery as object),
    } as RecoveryData;
  }

  if (sourceData.workouts) {
    result.workouts = (sourceData.workouts as object[]).map((w) => ({
      source,
      date,
      ...w,
    })) as WorkoutData[];
  }

  return result;
}

/**
 * Read sleep data for a specific date and source.
 */
export async function readSleepData(source: string, date: string): Promise<SleepData | null> {
  const data = await readIntegrationData(source, date);
  return data?.sleep || null;
}

/**
 * Read recovery data for a specific date and source.
 */
export async function readRecoveryData(source: string, date: string): Promise<RecoveryData | null> {
  const data = await readIntegrationData(source, date);
  return data?.recovery || null;
}

/**
 * Read workout data for a specific date, source, and type.
 */
export async function readWorkoutData(
  source: string,
  date: string,
  workoutType: string
): Promise<WorkoutData | null> {
  const data = await readIntegrationData(source, date);
  return data?.workouts?.find((w) => w.type === workoutType) || null;
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
  const today = getToday();
  let data = await readRecoveryData(source, today);
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
  const today = getToday();
  let data = await readSleepData(source, today);
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

// Export for testing
export { parseFrontmatter, serializeFrontmatter, getISOWeekForDate };
