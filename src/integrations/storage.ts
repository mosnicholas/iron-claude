/**
 * Integration Data Storage
 *
 * Stores normalized integration data with key metrics in frontmatter
 * and detailed data in a readable markdown table in the document body.
 *
 * Example workout file with integration data:
 * ```markdown
 * ---
 * date: "2026-01-27"
 * type: upper
 * status: in_progress
 * recovery_score: 78
 * sleep_hours: 7.0
 * ---
 * # 2026-01-27
 *
 * ## Whoop Data
 *
 * | Metric | Value |
 * |--------|-------|
 * | Recovery Score | 78% |
 * | HRV | 45.2 ms |
 * | Resting HR | 52 bpm |
 * | Sleep Duration | 7h 0m |
 * | Sleep Score | 85% |
 *
 * *No workout logged yet.*
 * ```
 */

import { createGitHubStorage } from "../storage/github.js";
import { formatISOWeek, getTimezone } from "../utils/date.js";
import { toZonedTime } from "date-fns-tz";
import { subDays, format } from "date-fns";
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
// Markdown Table Formatting
// ─────────────────────────────────────────────────────────────────────────────

interface TableRow {
  metric: string;
  value: string;
}

/**
 * Format integration data as a markdown table.
 * Combines sleep, recovery, and workout data into a readable format.
 */
function formatIntegrationTable(data: {
  sleep?: SleepData;
  recovery?: RecoveryData;
  workouts?: WorkoutData[];
}): string {
  const rows: TableRow[] = [];

  // Recovery data first (most important for training decisions)
  if (data.recovery) {
    rows.push({ metric: "Recovery Score", value: `${data.recovery.score}%` });
    if (data.recovery.hrv !== undefined) {
      rows.push({ metric: "HRV", value: `${data.recovery.hrv.toFixed(1)} ms` });
    }
    if (data.recovery.restingHeartRate !== undefined) {
      rows.push({ metric: "Resting HR", value: `${data.recovery.restingHeartRate} bpm` });
    }
    if (data.recovery.spo2 !== undefined) {
      rows.push({ metric: "SpO2", value: `${data.recovery.spo2}%` });
    }
    if (data.recovery.skinTempDeviation !== undefined) {
      rows.push({
        metric: "Skin Temp Deviation",
        value: `${data.recovery.skinTempDeviation > 0 ? "+" : ""}${data.recovery.skinTempDeviation.toFixed(1)}°C`,
      });
    }
  }

  // Sleep data
  if (data.sleep) {
    const hours = Math.floor(data.sleep.durationMinutes / 60);
    const mins = data.sleep.durationMinutes % 60;
    rows.push({ metric: "Sleep Duration", value: `${hours}h ${mins}m` });
    if (data.sleep.score !== undefined) {
      rows.push({ metric: "Sleep Score", value: `${data.sleep.score}%` });
    }
    if (data.sleep.stages) {
      rows.push({ metric: "Deep Sleep", value: `${data.sleep.stages.deep} min` });
      rows.push({ metric: "REM Sleep", value: `${data.sleep.stages.rem} min` });
      rows.push({ metric: "Light Sleep", value: `${data.sleep.stages.light} min` });
      if (data.sleep.stages.awake) {
        rows.push({ metric: "Awake", value: `${data.sleep.stages.awake} min` });
      }
    }
  }

  // Workout data
  if (data.workouts && data.workouts.length > 0) {
    for (const workout of data.workouts) {
      const hours = Math.floor(workout.durationMinutes / 60);
      const mins = workout.durationMinutes % 60;
      const durationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
      rows.push({ metric: `Workout (${workout.type})`, value: durationStr });
      if (workout.strain !== undefined) {
        rows.push({ metric: "Strain", value: workout.strain.toFixed(1) });
      }
      if (workout.calories !== undefined) {
        rows.push({ metric: "Calories", value: `${workout.calories} kcal` });
      }
      if (workout.heartRateAvg !== undefined) {
        rows.push({ metric: "Avg HR", value: `${workout.heartRateAvg} bpm` });
      }
      if (workout.heartRateMax !== undefined) {
        rows.push({ metric: "Max HR", value: `${workout.heartRateMax} bpm` });
      }
    }
  }

  if (rows.length === 0) {
    return "";
  }

  // Build the table
  const lines: string[] = ["| Metric | Value |", "|--------|-------|"];
  for (const row of rows) {
    lines.push(`| ${row.metric} | ${row.value} |`);
  }

  return lines.join("\n");
}

/**
 * Insert or update a section in markdown content.
 * Sections are identified by "## Section Name" headers.
 * Returns the updated content.
 */
function insertOrUpdateSection(
  content: string,
  sectionName: string,
  sectionContent: string
): string {
  const sectionHeader = `## ${sectionName}`;
  const lines = content.split("\n");

  // Find if section already exists
  let sectionStartIndex = -1;
  let sectionEndIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === sectionHeader) {
      sectionStartIndex = i;
      // Find the end of this section (next ## or end of file)
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].startsWith("## ")) {
          sectionEndIndex = j;
          break;
        }
      }
      if (sectionEndIndex === -1) {
        sectionEndIndex = lines.length;
      }
      break;
    }
  }

  const newSection = `${sectionHeader}\n\n${sectionContent}`;

  if (sectionStartIndex !== -1) {
    // Replace existing section
    const before = lines.slice(0, sectionStartIndex);
    const after = lines.slice(sectionEndIndex);
    return [...before, newSection, "", ...after].join("\n");
  } else {
    // Insert new section after the first heading (# Date)
    let insertIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("# ")) {
        insertIndex = i + 1;
        // Skip any blank lines after the heading
        while (insertIndex < lines.length && lines[insertIndex].trim() === "") {
          insertIndex++;
        }
        break;
      }
    }

    const before = lines.slice(0, insertIndex);
    const after = lines.slice(insertIndex);
    return [...before, "", newSection, "", ...after].join("\n");
  }
}

/**
 * Capitalize first letter of a string.
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Store Data
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Internal storage for accumulating integration data during a session.
 * Used to combine multiple events (sleep + recovery) into one table.
 */
interface IntegrationDataAccumulator {
  sleep?: SleepData;
  recovery?: RecoveryData;
  workouts?: WorkoutData[];
}

/**
 * Store normalized integration data with flat frontmatter and readable table.
 * Key metrics go in frontmatter for programmatic access.
 * Full details go in a markdown table in the document body.
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

  // Read any existing integration data from frontmatter (for backwards compat)
  // and from the current event to accumulate all data for the table
  const accumulator: IntegrationDataAccumulator = {};

  // Check for old nested format and migrate
  const oldSourceData = parsed.frontmatter[source] as Frontmatter | undefined;
  if (oldSourceData) {
    if (oldSourceData.sleep) {
      accumulator.sleep = {
        source,
        date,
        ...(oldSourceData.sleep as object),
      } as SleepData;
    }
    if (oldSourceData.recovery) {
      accumulator.recovery = {
        source,
        date,
        ...(oldSourceData.recovery as object),
      } as RecoveryData;
    }
    if (oldSourceData.workouts) {
      accumulator.workouts = (oldSourceData.workouts as object[]).map((w) => ({
        source,
        date,
        ...w,
      })) as WorkoutData[];
    }
    // Remove the old nested format
    delete parsed.frontmatter[source];
  }

  // Add the new event data to the accumulator
  switch (event.type) {
    case "sleep":
      accumulator.sleep = event.data;
      // Add flat metric to frontmatter
      parsed.frontmatter.sleep_hours = Number((event.data.durationMinutes / 60).toFixed(1));
      break;
    case "recovery":
      accumulator.recovery = event.data;
      // Add flat metric to frontmatter
      parsed.frontmatter.recovery_score = event.data.score;
      break;
    case "workout": {
      if (!accumulator.workouts) {
        accumulator.workouts = [];
      }
      // Replace existing workout of same type or add new
      const existingIndex = accumulator.workouts.findIndex((w) => w.type === event.data.type);
      if (existingIndex >= 0) {
        accumulator.workouts[existingIndex] = event.data;
      } else {
        accumulator.workouts.push(event.data);
      }
      break;
    }
  }

  // Generate the table and update the body
  const tableContent = formatIntegrationTable(accumulator);
  if (tableContent) {
    const sectionName = `${capitalize(source)} Data`;
    parsed.content = insertOrUpdateSection(parsed.content, sectionName, tableContent);
  }

  // Clean up any double blank lines that may have been introduced
  parsed.content = parsed.content.replace(/\n{3,}/g, "\n\n").trim();

  // Rebuild the file
  const newFrontmatter = serializeFrontmatter(parsed.frontmatter);
  const newContent = `${newFrontmatter}\n\n${parsed.content}`;

  // Commit message
  const message = `Sync ${source} ${event.type} data for ${date}`;

  await storage.writeFile(filePath, newContent, message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Read Data
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse integration data from a markdown table in the document body.
 * Returns partial data extracted from the table.
 */
function parseIntegrationTable(
  content: string,
  source: string,
  date: string
): {
  sleep?: Partial<SleepData>;
  recovery?: Partial<RecoveryData>;
  workouts?: Partial<WorkoutData>[];
} {
  const result: {
    sleep?: Partial<SleepData>;
    recovery?: Partial<RecoveryData>;
    workouts?: Partial<WorkoutData>[];
  } = {};

  const sectionHeader = `## ${capitalize(source)} Data`;
  const sectionIndex = content.indexOf(sectionHeader);
  if (sectionIndex === -1) return result;

  // Find the table within the section
  const sectionContent = content.slice(sectionIndex);
  const nextSectionIndex = sectionContent.indexOf("\n## ", 1);
  const tableSection =
    nextSectionIndex === -1 ? sectionContent : sectionContent.slice(0, nextSectionIndex);

  // Parse table rows
  const tableRegex = /\|\s*(.+?)\s*\|\s*(.+?)\s*\|/g;
  let match;
  const rows: { metric: string; value: string }[] = [];

  while ((match = tableRegex.exec(tableSection)) !== null) {
    const metric = match[1].trim();
    const value = match[2].trim();
    // Skip header row
    if (metric !== "Metric" && metric !== "--------") {
      rows.push({ metric, value });
    }
  }

  // Parse values from rows
  for (const row of rows) {
    const { metric, value } = row;

    // Recovery metrics
    if (metric === "Recovery Score") {
      if (!result.recovery) result.recovery = { source, date };
      result.recovery.score = parseInt(value.replace("%", ""));
    } else if (metric === "HRV") {
      if (!result.recovery) result.recovery = { source, date };
      result.recovery.hrv = parseFloat(value.replace(" ms", ""));
    } else if (metric === "Resting HR") {
      if (!result.recovery) result.recovery = { source, date };
      result.recovery.restingHeartRate = parseInt(value.replace(" bpm", ""));
    } else if (metric === "SpO2") {
      if (!result.recovery) result.recovery = { source, date };
      result.recovery.spo2 = parseInt(value.replace("%", ""));
    } else if (metric === "Skin Temp Deviation") {
      if (!result.recovery) result.recovery = { source, date };
      result.recovery.skinTempDeviation = parseFloat(value.replace("°C", ""));
    }

    // Sleep metrics
    else if (metric === "Sleep Duration") {
      if (!result.sleep) result.sleep = { source, date };
      const durationMatch = value.match(/(\d+)h\s*(\d+)m/);
      if (durationMatch) {
        result.sleep.durationMinutes = parseInt(durationMatch[1]) * 60 + parseInt(durationMatch[2]);
      }
    } else if (metric === "Sleep Score") {
      if (!result.sleep) result.sleep = { source, date };
      result.sleep.score = parseInt(value.replace("%", ""));
    } else if (metric === "Deep Sleep") {
      if (!result.sleep) result.sleep = { source, date };
      if (!result.sleep.stages) result.sleep.stages = { deep: 0, rem: 0, light: 0, awake: 0 };
      result.sleep.stages.deep = parseInt(value.replace(" min", ""));
    } else if (metric === "REM Sleep") {
      if (!result.sleep) result.sleep = { source, date };
      if (!result.sleep.stages) result.sleep.stages = { deep: 0, rem: 0, light: 0, awake: 0 };
      result.sleep.stages.rem = parseInt(value.replace(" min", ""));
    } else if (metric === "Light Sleep") {
      if (!result.sleep) result.sleep = { source, date };
      if (!result.sleep.stages) result.sleep.stages = { deep: 0, rem: 0, light: 0, awake: 0 };
      result.sleep.stages.light = parseInt(value.replace(" min", ""));
    } else if (metric === "Awake") {
      if (!result.sleep) result.sleep = { source, date };
      if (!result.sleep.stages) result.sleep.stages = { deep: 0, rem: 0, light: 0, awake: 0 };
      result.sleep.stages.awake = parseInt(value.replace(" min", ""));
    }

    // Workout metrics - format is "Workout (type)"
    else if (metric.startsWith("Workout (")) {
      const typeMatch = metric.match(/Workout \((.+)\)/);
      if (typeMatch) {
        if (!result.workouts) result.workouts = [];
        const workoutType = typeMatch[1];
        let workout = result.workouts.find((w) => w.type === workoutType);
        if (!workout) {
          workout = { source, date, type: workoutType };
          result.workouts.push(workout);
        }
        const durationMatch = value.match(/(?:(\d+)h\s*)?(\d+)m/);
        if (durationMatch) {
          const hours = durationMatch[1] ? parseInt(durationMatch[1]) : 0;
          const mins = parseInt(durationMatch[2]);
          workout.durationMinutes = hours * 60 + mins;
        }
      }
    } else if (metric === "Strain" && result.workouts && result.workouts.length > 0) {
      result.workouts[result.workouts.length - 1].strain = parseFloat(value);
    } else if (metric === "Calories" && result.workouts && result.workouts.length > 0) {
      result.workouts[result.workouts.length - 1].calories = parseInt(value.replace(" kcal", ""));
    } else if (metric === "Avg HR" && result.workouts && result.workouts.length > 0) {
      result.workouts[result.workouts.length - 1].heartRateAvg = parseInt(
        value.replace(" bpm", "")
      );
    } else if (metric === "Max HR" && result.workouts && result.workouts.length > 0) {
      result.workouts[result.workouts.length - 1].heartRateMax = parseInt(
        value.replace(" bpm", "")
      );
    }
  }

  return result;
}

/**
 * Read integration data from a workout file.
 * Supports both old nested frontmatter format and new flat format with table.
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
  const result: { sleep?: SleepData; recovery?: RecoveryData; workouts?: WorkoutData[] } = {};

  // First, try the old nested format for backwards compatibility
  const sourceData = parsed.frontmatter[source] as Frontmatter | undefined;
  if (sourceData) {
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

    // If we found data in old format, return it
    if (result.sleep || result.recovery || result.workouts) {
      return result;
    }
  }

  // Try new format: flat frontmatter + table in body
  const hasFlatMetrics =
    parsed.frontmatter.recovery_score !== undefined || parsed.frontmatter.sleep_hours !== undefined;

  if (hasFlatMetrics) {
    // Parse the table from the body
    const tableData = parseIntegrationTable(parsed.content, source, date);

    if (tableData.sleep) {
      result.sleep = tableData.sleep as SleepData;
    }
    if (tableData.recovery) {
      result.recovery = tableData.recovery as RecoveryData;
    }
    if (tableData.workouts) {
      result.workouts = tableData.workouts as WorkoutData[];
    }

    if (result.sleep || result.recovery || result.workouts) {
      return result;
    }
  }

  return null;
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

  // Try yesterday (timezone-aware)
  const timezone = getTimezone();
  const zonedNow = toZonedTime(new Date(), timezone);
  const yesterdayStr = format(subDays(zonedNow, 1), "yyyy-MM-dd");

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

  // Try yesterday (timezone-aware)
  const timezone = getTimezone();
  const zonedNow = toZonedTime(new Date(), timezone);
  const yesterdayStr = format(subDays(zonedNow, 1), "yyyy-MM-dd");

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
export {
  parseFrontmatter,
  serializeFrontmatter,
  getISOWeekForDate,
  formatIntegrationTable,
  insertOrUpdateSection,
  parseIntegrationTable,
};
