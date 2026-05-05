/**
 * Debug tools — gated to /debug mode only.
 *
 * These tools let the coach diagnose its own behavior over Telegram:
 * Fly logs, deploy history, our own structured tool-call trace, recent
 * commits in fitness-data, and an escape-hatch file reader.
 *
 * Read-only by design. Debug mode never writes — it just reads and reports.
 */

import { existsSync, readFileSync } from "fs";
import { spawnSync } from "child_process";
import { join } from "path";
import { z } from "zod";
import { defineTool } from "../tool.js";

const FLY_API_BASE = "https://api.machines.dev/v1";

interface FlyLogEntry {
  timestamp?: string;
  level?: string;
  message?: string;
  region?: string;
  instance?: string;
  [k: string]: unknown;
}

async function flyApiRequest<T>(path: string): Promise<T> {
  const token = process.env.FLY_API_TOKEN;
  const appName = process.env.FLY_APP_NAME;
  if (!token || !appName) {
    throw new Error(
      "FLY_API_TOKEN and FLY_APP_NAME must be set on the bot for debug tools to read Fly state."
    );
  }
  const url = `${FLY_API_BASE}${path.replace("{app}", appName)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Fly API ${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

export const getFlyLogs = defineTool({
  name: "get_fly_logs",
  description:
    "Fetch recent app logs from Fly.io. Use to debug missing notifications, cron failures, " +
    "webhook issues, or any 'why didn't X happen' question. Logs are limited to recent history.",
  schema: z.object({
    since: z
      .string()
      .optional()
      .describe(
        "ISO timestamp lower bound, e.g. '2026-05-04T06:00:00Z'. Defaults to last 24h if omitted."
      ),
    filter: z
      .string()
      .optional()
      .describe(
        "Substring to filter log lines, case-insensitive (e.g. 'daily-reminder', 'webhook')"
      ),
    limit: z.number().int().min(1).max(500).default(100),
  }),
  handler: async (input) => {
    // Fly's official logs API is via flyctl; the public Machines API doesn't
    // expose logs. Easiest path: shell out to flyctl if available, otherwise
    // hit the GraphQL API. We try flyctl first since the container has it.
    const since = input.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const limit = input.limit ?? 100;

    const result = spawnSync(process.env.FLY_BIN || "fly", ["logs", "--no-tail", "--json"], {
      encoding: "utf-8",
      stdio: "pipe",
      env: process.env,
    });

    if (result.status !== 0) {
      return (
        `flyctl unavailable or unauthenticated: ${result.stderr || "unknown"}\n` +
        "Set FLY_API_TOKEN and FLY_APP_NAME, or run flyctl auth login on the host."
      );
    }

    const lines = result.stdout
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l) as FlyLogEntry;
        } catch {
          return { message: l } as FlyLogEntry;
        }
      });

    let filtered = lines.filter((e) => !e.timestamp || e.timestamp >= since);
    if (input.filter) {
      const needle = input.filter.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          (e.message ?? "").toLowerCase().includes(needle) ||
          (e.level ?? "").toLowerCase().includes(needle)
      );
    }
    filtered = filtered.slice(-limit);
    if (filtered.length === 0) return `No matching log lines since ${since}.`;
    return filtered
      .map((e) => `[${e.timestamp ?? "?"}] [${e.level ?? "info"}] ${e.message ?? ""}`)
      .join("\n");
  },
});

export const getFlyAppStatus = defineTool({
  name: "get_fly_app_status",
  description: "Get the current state of the Fly app: machines, regions, last deploy.",
  schema: z.object({}),
  handler: async () => {
    try {
      const data = await flyApiRequest<unknown>("/apps/{app}/machines");
      return JSON.stringify(data, null, 2).slice(0, 4000);
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  },
});

export const getRecentDeploys = defineTool({
  name: "get_recent_deploys",
  description:
    "Recent deploy/release history with status. Useful for 'did the latest deploy land?'",
  schema: z.object({
    limit: z.number().int().min(1).max(20).default(5),
  }),
  handler: async (input) => {
    const result = spawnSync(process.env.FLY_BIN || "fly", ["releases", "--json"], {
      encoding: "utf-8",
      stdio: "pipe",
      env: process.env,
    });
    if (result.status !== 0) {
      return `flyctl unavailable: ${result.stderr || "unknown"}`;
    }
    try {
      const releases = JSON.parse(result.stdout) as Array<Record<string, unknown>>;
      return JSON.stringify(releases.slice(0, input.limit ?? 5), null, 2);
    } catch {
      return result.stdout.slice(0, 2000);
    }
  },
});

export const getToolCallLog = defineTool({
  name: "get_tool_call_log",
  description:
    "Read the structured tool-call trace from state/tool-calls.jsonl. " +
    "Each line records one tool call: timestamp, handler, tool, args, duration, ok, commit. " +
    "This is the source of truth for 'did the coach actually save my exercise?'",
  schema: z.object({
    since: z.string().optional().describe("ISO timestamp lower bound. Defaults to last 24h."),
    filter: z
      .string()
      .optional()
      .describe("Substring filter on tool name or content (e.g. 'log_exercise')"),
    limit: z.number().int().min(1).max(500).default(100),
  }),
  handler: async (input, ctx) => {
    const path = join(ctx.repoPath, "state", "tool-calls.jsonl");
    if (!existsSync(path)) return "No tool-call log yet.";
    const since = input.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const lines = readFileSync(path, "utf-8")
      .split("\n")
      .filter((l) => l.trim());
    const parsed = lines.map((l) => {
      try {
        return JSON.parse(l) as Record<string, unknown>;
      } catch {
        return null;
      }
    });
    let filtered = parsed.filter(
      (e): e is Record<string, unknown> => e !== null && (e.ts as string) >= since
    );
    if (input.filter) {
      const needle = input.filter.toLowerCase();
      filtered = filtered.filter((e) => JSON.stringify(e).toLowerCase().includes(needle));
    }
    filtered = filtered.slice(-(input.limit ?? 100));
    if (filtered.length === 0) return `No matching tool calls since ${since}.`;
    return filtered.map((e) => JSON.stringify(e)).join("\n");
  },
});

export const getCronHistory = defineTool({
  name: "get_cron_history",
  description:
    "Recent cron run results from the tool-call log (filtered to LLM calls in cron handlers).",
  schema: z.object({
    task: z.enum(["daily-reminder", "weekly-plan", "check-reminders", "refresh-tokens"]).optional(),
    days: z.number().int().min(1).max(30).default(7),
  }),
  handler: async (input, ctx) => {
    const path = join(ctx.repoPath, "state", "tool-calls.jsonl");
    if (!existsSync(path)) return "No cron history available (tool-call log empty).";
    const cutoff = new Date(Date.now() - (input.days ?? 7) * 24 * 60 * 60 * 1000).toISOString();
    const lines = readFileSync(path, "utf-8")
      .split("\n")
      .filter((l) => l.trim());
    const parsed = lines
      .map((l) => {
        try {
          return JSON.parse(l) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((e): e is Record<string, unknown> => e !== null && (e.ts as string) >= cutoff);
    const cronEntries = parsed.filter((e) => {
      const handler = e.handler as string;
      if (!handler?.startsWith("cron-")) return false;
      if (input.task && !handler.includes(input.task)) return false;
      return true;
    });
    if (cronEntries.length === 0) return `No cron history in the last ${input.days ?? 7} days.`;
    return cronEntries.map((e) => JSON.stringify(e)).join("\n");
  },
});

export const readRepoFile = defineTool({
  name: "read_repo_file",
  description:
    "Escape hatch — read any file in the fitness-data repo by relative path. " +
    "Use for arbitrary inspection during debugging.",
  schema: z.object({
    path: z.string().describe("Path relative to repo root, e.g. 'state/reminders.json'"),
  }),
  handler: async (input, ctx) => {
    if (input.path.includes("..")) return "Refusing path traversal.";
    const full = join(ctx.repoPath, input.path);
    if (!existsSync(full)) return `Not found: ${input.path}`;
    return readFileSync(full, "utf-8").slice(0, 16_000);
  },
});

export const DEBUG_TOOLS = [
  getFlyLogs,
  getFlyAppStatus,
  getRecentDeploys,
  getToolCallLog,
  getCronHistory,
  readRepoFile,
];
