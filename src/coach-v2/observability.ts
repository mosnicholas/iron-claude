/**
 * Tool-call logging.
 *
 * Every tool invocation is appended as a row to the `tool_call_log` table
 * (replacing the old state/tool-calls.jsonl file). The /debug handler reads
 * this table to answer "why did/didn't X happen?". Writes are best-effort —
 * a logging failure must never break the coach.
 */

import { randomUUID } from "crypto";
import { getDb } from "../db/client.js";
import { toolCallLog } from "../db/schema.js";

export interface ToolCallRecord {
  ts: string;
  turn: string;
  handler: string;
  tool: string;
  args: Record<string, unknown>;
  ms: number;
  ok: boolean;
  result_preview?: string;
  error?: string;
}

export function newTurnId(): string {
  return randomUUID();
}

export function logToolCall(userId: string | null, record: ToolCallRecord): void {
  // Fire-and-forget; observability must never throw.
  void getDb()
    .insert(toolCallLog)
    .values({
      userId: userId ?? null,
      turnId: record.turn,
      handler: record.handler,
      tool: record.tool,
      args: record.args,
      ms: record.ms,
      ok: record.ok,
      resultPreview: record.result_preview ?? null,
      error: record.error ?? null,
      ts: new Date(record.ts),
    })
    .catch((err) => {
      console.error("[observability] Failed to log tool call:", err);
    });
}

export function logMeta(
  userId: string | null,
  meta: Omit<ToolCallRecord, "tool"> & { tool?: string }
): void {
  logToolCall(userId, { ...meta, tool: meta.tool ?? "_meta" });
}
