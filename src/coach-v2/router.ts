/**
 * Mode router — decides which handler answers a Telegram message.
 *
 * Per-message, stateless. No persistent "mode". /debug is per-message.
 */

import { existsSync } from "fs";
import { join } from "path";
import type { HarnessResult } from "./harness.js";
import { runCoach } from "./handlers/coach.js";
import { runPlanner } from "./handlers/planner.js";
import { runDebug } from "./handlers/debug.js";

export type Mode = "coach" | "planner" | "debug";

export interface RouterContext {
  repoPath: string;
  timezone: string;
  /** The (raw) message text from the user. */
  message: string;
  onStatus?: (status: string) => void;
}

export interface RoutedResult extends HarnessResult {
  mode: Mode;
}

export function classifyMode(message: string, repoPath: string): Mode {
  const trimmed = message.trim();
  if (trimmed.startsWith("/debug")) return "debug";
  // Planning state file = the cron previously asked planning Qs and is waiting
  // for the athlete's answer.
  if (existsSync(join(repoPath, "state", "planning-pending.md"))) return "planner";
  return "coach";
}

export async function route(ctx: RouterContext): Promise<RoutedResult> {
  const mode = classifyMode(ctx.message, ctx.repoPath);

  switch (mode) {
    case "debug": {
      // Strip "/debug" prefix before passing to the handler.
      const stripped =
        ctx.message.replace(/^\/debug\s*/, "").trim() ||
        "Diagnose recent system behavior. Anything unusual?";
      const r = await runDebug({ ...ctx, message: stripped });
      return { ...r, mode };
    }
    case "planner": {
      const r = await runPlanner(ctx);
      return { ...r, mode };
    }
    case "coach": {
      const r = await runCoach(ctx);
      return { ...r, mode };
    }
  }
}
