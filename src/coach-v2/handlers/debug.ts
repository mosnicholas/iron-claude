/**
 * Debug handler — Opus 4.7. Read-only diagnostic mode.
 *
 * Triggered by `/debug <question>`. Per-message, no persistent state.
 * Tools include only reads + debug. No writes, no reminders.
 */

import { runHarness, type HarnessResult } from "../harness.js";
import { READ_TOOLS } from "../tools/reads.js";
import { DEBUG_TOOLS } from "../tools/debug.js";
import type { SystemBlock } from "../llm-client.js";
import { DEBUG_BASE_PROMPT } from "../prompts/debug.js";
import { getStorage } from "../../storage/db.js";

export interface DebugHandlerOptions {
  userId: string;
  timezone: string;
  message: string;
  model?: string;
  onStatus?: (status: string) => void;
  onTextDelta?: (delta: string) => void;
  onThinkingDelta?: (delta: string) => void;
}

const DEBUG_TOOLSET = [...READ_TOOLS, ...DEBUG_TOOLS];

export async function runDebug(opts: DebugHandlerOptions): Promise<HarnessResult> {
  const system: SystemBlock[] = [
    { type: "text", text: DEBUG_BASE_PROMPT, cache_control: { type: "ephemeral" } },
  ];
  return runHarness({
    model: opts.model ?? "claude-opus-4-7",
    system,
    userMessage: opts.message,
    tools: DEBUG_TOOLSET,
    ctx: { userId: opts.userId, storage: getStorage(), timezone: opts.timezone, handler: "debug" },
    onStatus: opts.onStatus,
    onTextDelta: opts.onTextDelta,
    onThinkingDelta: opts.onThinkingDelta,
    maxTurns: 15,
  });
}
