/**
 * Tool-call logging.
 *
 * Every tool invocation is appended as one JSON line to
 * `state/tool-calls.jsonl` in the fitness-data repo. This file is the source
 * of truth for /debug queries about why something did or didn't happen.
 *
 * Append-only, never edited. Each line is self-contained JSON.
 */

import { appendFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { randomUUID } from "crypto";

const RELATIVE_PATH = "state/tool-calls.jsonl";

export interface ToolCallRecord {
  ts: string;
  turn: string;
  handler: string;
  tool: string;
  args: Record<string, unknown>;
  ms: number;
  ok: boolean;
  /** Truncated result preview (writes only). Helps debug "did it actually persist". */
  result_preview?: string;
  error?: string;
  /** Commit hash, if the tool committed to git. */
  commit?: string;
}

export function newTurnId(): string {
  return randomUUID();
}

export function logToolCall(repoPath: string, record: ToolCallRecord): void {
  const path = join(repoPath, RELATIVE_PATH);
  try {
    if (!existsSync(dirname(path))) {
      mkdirSync(dirname(path), { recursive: true });
    }
    appendFileSync(path, JSON.stringify(record) + "\n", "utf-8");
  } catch (err) {
    // Observability must never break the coach. Log to stderr and continue.
    console.error("[observability] Failed to write tool-call log:", err);
  }
}

/**
 * Log entries created by the harness itself (e.g., LLM call summaries).
 * Same file, same shape — just `tool: "_meta"` to distinguish.
 */
export function logMeta(
  repoPath: string,
  meta: Omit<ToolCallRecord, "tool"> & { tool?: string }
): void {
  logToolCall(repoPath, { ...meta, tool: meta.tool ?? "_meta" });
}
