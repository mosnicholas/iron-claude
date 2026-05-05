/**
 * Planner handler — Opus 4.7 for weekly plan generation.
 *
 * Used both by the Sunday cron (after the athlete answers planning Qs)
 * and by /plan-my-week-style commands.
 */

import { runHarness, type HarnessResult } from "../harness.js";
import { READ_TOOLS } from "../tools/reads.js";
import { WRITE_TOOLS } from "../tools/writes.js";
import { REMINDER_TOOLS } from "../tools/reminders.js";
import { WEB_TOOLS } from "../tools/web.js";
import { buildCoachSystem, loadCoachContext } from "../context-loader.js";
import { PLANNER_BASE_PROMPT } from "../prompts/planner.js";

export interface PlannerHandlerOptions {
  repoPath: string;
  timezone: string;
  message: string;
  model?: string;
  onStatus?: (status: string) => void;
}

const PLANNER_TOOLS = [...READ_TOOLS, ...WRITE_TOOLS, ...REMINDER_TOOLS, ...WEB_TOOLS];

export async function runPlanner(opts: PlannerHandlerOptions): Promise<HarnessResult> {
  const ctx = loadCoachContext(opts.repoPath, opts.timezone);
  const system = buildCoachSystem(ctx, PLANNER_BASE_PROMPT);
  return runHarness({
    model: opts.model ?? "claude-opus-4-7",
    system,
    userMessage: opts.message,
    tools: PLANNER_TOOLS,
    ctx: { repoPath: opts.repoPath, timezone: opts.timezone, handler: "planner" },
    onStatus: opts.onStatus,
    maxTurns: 25,
  });
}
