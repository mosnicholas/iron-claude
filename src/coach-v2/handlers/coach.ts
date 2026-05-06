/**
 * Coach handler — default mode for live Telegram chat.
 *
 * Model: Sonnet 4.6.
 * Tools: all reads, all writes, all reminders, search_technique.
 * Debug tools are NOT included — they only appear in debug handler.
 */

import { runHarness, type HarnessResult } from "../harness.js";
import { READ_TOOLS } from "../tools/reads.js";
import { WRITE_TOOLS } from "../tools/writes.js";
import { REMINDER_TOOLS } from "../tools/reminders.js";
import { WEB_TOOLS } from "../tools/web.js";
import { buildCoachSystem, loadCoachContext } from "../context-loader.js";
import { COACH_BASE_PROMPT } from "../prompts/coach.js";

export interface CoachHandlerOptions {
  repoPath: string;
  timezone: string;
  message: string;
  model?: string;
  onStatus?: (status: string) => void;
  onThinking?: (delta: string) => void;
  onText?: (delta: string) => void;
}

const COACH_TOOLS = [...READ_TOOLS, ...WRITE_TOOLS, ...REMINDER_TOOLS, ...WEB_TOOLS];

const COACH_THINKING_BUDGET = 1024;

export async function runCoach(opts: CoachHandlerOptions): Promise<HarnessResult> {
  const ctx = loadCoachContext(opts.repoPath, opts.timezone);
  const system = buildCoachSystem(ctx, COACH_BASE_PROMPT);
  return runHarness({
    model: opts.model ?? "claude-sonnet-4-6",
    system,
    userMessage: opts.message,
    tools: COACH_TOOLS,
    ctx: { repoPath: opts.repoPath, timezone: opts.timezone, handler: "coach" },
    onStatus: opts.onStatus,
    thinking: { budgetTokens: COACH_THINKING_BUDGET },
    onThinking: opts.onThinking,
    onText: opts.onText,
  });
}
