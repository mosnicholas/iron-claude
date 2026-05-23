/**
 * Integration Data Storage
 *
 * Persists normalized device-integration events (sleep, recovery, workout)
 * into Postgres via the Storage layer's `integration_metrics` table. Recovery
 * and sleep payloads are automatically mirrored into the matching `workouts`
 * row's `recovery_snapshot` JSON column so the coach can see them in context.
 *
 * Pre-DB versions of this module merged data into per-day workout markdown
 * files; the markdown merging, table formatting, and frontmatter-based reads
 * are gone. `parseFrontmatter` and `serializeFrontmatter` are still exported
 * because the writes tools and importer use them to read/write markdown
 * frontmatter elsewhere in the codebase.
 */

import { getStorage } from "../storage/db.js";
import type { WebhookEvent } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Frontmatter Parsing — retained for the writes tools / importer
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
 * Safe to call on plain strings — returns empty frontmatter if none exists.
 */
export function parseFrontmatter(fileContent: string): ParsedFile {
  const trimmed = (fileContent ?? "").trim();

  // Check for frontmatter delimiter
  if (!trimmed.startsWith("---")) {
    return { frontmatter: {}, content: fileContent ?? "" };
  }

  // Find closing delimiter
  const endIndex = trimmed.indexOf("\n---", 3);
  if (endIndex === -1) {
    return { frontmatter: {}, content: fileContent ?? "" };
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
 * Serialize frontmatter to a YAML block (including --- delimiters).
 */
export function serializeFrontmatter(frontmatter: Frontmatter): string {
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
// Store Data — DB-backed
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Persist a normalized integration webhook event for a user.
 *
 * Writes to `integration_metrics` (unique on user+provider+date+kind, so this
 * is idempotent on replay). For sleep/recovery, the Storage layer also
 * mirrors the payload into the matching workouts row's `recovery_snapshot`
 * column so the coach can see it in context without a join.
 */
export async function storeIntegrationData(userId: string, event: WebhookEvent): Promise<void> {
  const { source, date } = event.data;
  await getStorage().upsertIntegrationMetric(
    userId,
    source,
    date,
    event.type,
    event.data as unknown as Record<string, unknown>
  );
}
