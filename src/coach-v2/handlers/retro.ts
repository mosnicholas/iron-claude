/**
 * Retro handler — Opus 4.7 for weekly retrospectives.
 */

import { runHarness, type HarnessResult } from "../harness.js";
import { READ_TOOLS } from "../tools/reads.js";
import { WRITE_TOOLS } from "../tools/writes.js";
import { buildCoachSystem, loadCoachContext } from "../context-loader.js";
import { RETRO_BASE_PROMPT } from "../prompts/retro.js";

export interface RetroHandlerOptions {
  repoPath: string;
  timezone: string;
  message: string;
  model?: string;
  onStatus?: (status: string) => void;
}

const RETRO_TOOLS = [...READ_TOOLS, ...WRITE_TOOLS];

export async function runRetro(opts: RetroHandlerOptions): Promise<HarnessResult> {
  const ctx = loadCoachContext(opts.repoPath, opts.timezone);
  const system = buildCoachSystem(ctx, RETRO_BASE_PROMPT);
  return runHarness({
    model: opts.model ?? "claude-opus-4-7",
    system,
    userMessage: opts.message,
    tools: RETRO_TOOLS,
    ctx: { repoPath: opts.repoPath, timezone: opts.timezone, handler: "retro" },
    onStatus: opts.onStatus,
    maxTurns: 20,
  });
}
