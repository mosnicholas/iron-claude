/**
 * Coach handler — the single entry point for Telegram chat AND every cron-driven
 * task (weekly planning, retrospective, daily reminder).
 *
 * Specialized modes are no longer separate handlers; the coach loads the
 * relevant skill (plan-week, retro, daily-reminder) via load_skill when it
 * detects one is needed. Model: Opus 4.7 across the board.
 *
 * Debug is the only handler that stays separate (read-only toolset).
 */

import { runHarness, type HarnessResult } from "../harness.js";
import type { ImageBlock } from "../llm-client.js";
import { READ_TOOLS } from "../tools/reads.js";
import { WRITE_TOOLS } from "../tools/writes.js";
import { REMINDER_TOOLS } from "../tools/reminders.js";
import { SKILL_TOOLS } from "../tools/skills.js";
import { NUTRITION_TOOLS } from "../tools/nutrition.js";
import { buildCoachSystem, loadCoachContext } from "../context-loader.js";
import { COACH_BASE_PROMPT } from "../prompts/coach.js";

export interface CoachHandlerOptions {
  repoPath: string;
  timezone: string;
  message: string;
  /** Optional images attached to this turn (e.g. a Telegram photo). */
  images?: ImageBlock[];
  model?: string;
  maxTurns?: number;
  onStatus?: (status: string) => void;
  onTextDelta?: (delta: string) => void;
  onThinkingDelta?: (delta: string) => void;
}

const COACH_TOOLS = [
  ...READ_TOOLS,
  ...WRITE_TOOLS,
  ...REMINDER_TOOLS,
  ...SKILL_TOOLS,
  ...NUTRITION_TOOLS,
];

export async function runCoach(opts: CoachHandlerOptions): Promise<HarnessResult> {
  const ctx = loadCoachContext(opts.repoPath, opts.timezone);
  const system = buildCoachSystem(ctx, COACH_BASE_PROMPT);
  // When images are present, build a multimodal user turn (images first so the
  // model has the visual context before reading the caption / question).
  const userMessage =
    opts.images && opts.images.length > 0
      ? [...opts.images, { type: "text" as const, text: opts.message || "" }]
      : opts.message;
  return runHarness({
    model: opts.model ?? "claude-opus-4-7",
    system,
    userMessage,
    tools: COACH_TOOLS,
    ctx: { repoPath: opts.repoPath, timezone: opts.timezone, handler: "coach" },
    onStatus: opts.onStatus,
    onTextDelta: opts.onTextDelta,
    onThinkingDelta: opts.onThinkingDelta,
    maxTurns: opts.maxTurns ?? 30,
  });
}
