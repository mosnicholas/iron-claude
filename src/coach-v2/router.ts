/**
 * Mode router — decides which handler answers a Telegram message.
 *
 * Per-message, stateless. Coach handles everything except /debug, including
 * planning/retro/daily-reminder via the load_skill tool.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { HarnessResult } from "./harness.js";
import { runCoach } from "./handlers/coach.js";
import { runDebug } from "./handlers/debug.js";

export type Mode = "coach" | "debug";

export interface RouterContext {
  repoPath: string;
  timezone: string;
  /** The (raw) message text from the user. */
  message: string;
  onStatus?: (status: string) => void;
  onTextDelta?: (delta: string) => void;
}

export interface RoutedResult extends HarnessResult {
  mode: Mode;
}

export function classifyMode(message: string): Mode {
  return message.trim().startsWith("/debug") ? "debug" : "coach";
}

/**
 * If the cron has previously asked planning questions and is awaiting a reply,
 * prepend a hint to the user message so the coach loads the plan-week skill.
 */
function maybeInjectPlanningHint(repoPath: string, message: string): string {
  const signalPath = join(repoPath, "state", "planning-pending.md");
  if (!existsSync(signalPath)) return message;
  const signal = readFileSync(signalPath, "utf-8").trim();
  return `[system: planning-pending state present — the athlete is replying to your earlier planning questions. Load the plan-week skill and incorporate their response into the new plan, then delete state/planning-pending.md when done.\n${signal}]\n\nAthlete: ${message}`;
}

export async function route(ctx: RouterContext): Promise<RoutedResult> {
  const mode = classifyMode(ctx.message);

  if (mode === "debug") {
    const stripped =
      ctx.message.replace(/^\/debug\s*/, "").trim() ||
      "Diagnose recent system behavior. Anything unusual?";
    const r = await runDebug({ ...ctx, message: stripped });
    return { ...r, mode };
  }

  const message = maybeInjectPlanningHint(ctx.repoPath, ctx.message);
  const r = await runCoach({ ...ctx, message });
  return { ...r, mode };
}
