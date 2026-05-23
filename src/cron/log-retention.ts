/**
 * Log retention cron — runs daily.
 *
 * Trims unbounded growth of the `tool_call_log` table by deleting rows older
 * than 30 days. Not user-scoped — we just prune globally.
 *
 * The `messages` table is intentionally NOT pruned here: we use those rows
 * for cost/latency analytics and the operator can prune manually if disk
 * pressure becomes an issue.
 */

import { lt } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { toolCallLog } from "../db/schema.js";

export interface LogRetentionResult {
  success: boolean;
  message?: string;
  error?: string;
}

export async function runLogRetention(): Promise<LogRetentionResult> {
  // Not user-scoped — just prune old rows globally.
  const db = getDb();
  const cutoff30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const toolCallDeleted = await db
    .delete(toolCallLog)
    .where(lt(toolCallLog.ts, cutoff30))
    .returning({ id: toolCallLog.id });

  return {
    success: true,
    message: `Pruned ${toolCallDeleted.length} tool_call_log rows older than 30 days`,
  };
}
