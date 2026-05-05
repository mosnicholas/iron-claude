/**
 * Daily reminder handler — Haiku 4.5.
 *
 * Cron-driven, generates a morning workout reminder. Read-only set of tools
 * (the coach handler does the writes when the athlete actually trains).
 */

import { runHarness, type HarnessResult } from "../harness.js";
import { READ_TOOLS } from "../tools/reads.js";
import { REMINDER_TOOLS } from "../tools/reminders.js";
import { buildCoachSystem, loadCoachContext } from "../context-loader.js";
import { COACH_BASE_PROMPT } from "../prompts/coach.js";

export interface DailyReminderOptions {
  repoPath: string;
  timezone: string;
  message: string;
  model?: string;
}

const REMINDER_HANDLER_TOOLS = [...READ_TOOLS, ...REMINDER_TOOLS];

const REMINDER_INSTRUCTIONS = `You are generating the morning workout reminder. Keep it short, motivating, and concrete.

Steps:
1. Call get_plan for today's planned session
2. Call get_workout for today (you'll usually find no file yet)
3. Compose ONE message:
   - Brief greeting + day
   - Today's workout type and target duration
   - Main lifts with sets/reps/weights
   - Brief warm-up
   - Brief coaching note from the plan
   - Ask what time they're heading to gym so you can schedule a warm-up reminder

Keep it tight. Telegram, not email.`;

export async function runDailyReminder(opts: DailyReminderOptions): Promise<HarnessResult> {
  const ctx = loadCoachContext(opts.repoPath, opts.timezone);
  const system = buildCoachSystem(ctx, `${COACH_BASE_PROMPT}\n\n${REMINDER_INSTRUCTIONS}`);
  return runHarness({
    model: opts.model ?? "claude-haiku-4-5",
    system,
    userMessage: opts.message,
    tools: REMINDER_HANDLER_TOOLS,
    ctx: { repoPath: opts.repoPath, timezone: opts.timezone, handler: "cron-daily-reminder" },
    maxTurns: 10,
  });
}
