/**
 * Mode router — decides which handler answers a Telegram message.
 *
 * Per-message, stateless. Coach handles everything except /debug, including
 * planning/retro/daily-reminder via the load_skill tool.
 */

import type { HarnessResult } from "./harness.js";
import { runCoach } from "./handlers/coach.js";
import { runDebug } from "./handlers/debug.js";
import type { ImageBlock } from "./llm-client.js";

export type Mode = "coach" | "debug";

export interface RouterContext {
  userId: string;
  timezone: string;
  /** The (raw) message text from the user. */
  message: string;
  /** Optional images attached to this turn. */
  images?: ImageBlock[];
  onStatus?: (status: string) => void;
  onTextDelta?: (delta: string) => void;
  onThinkingDelta?: (delta: string) => void;
}

export interface RoutedResult extends HarnessResult {
  mode: Mode;
}

function classifyMode(message: string): Mode {
  return message.trim().startsWith("/debug") ? "debug" : "coach";
}

export async function route(ctx: RouterContext): Promise<RoutedResult> {
  const mode = classifyMode(ctx.message);

  if (mode === "debug") {
    // Debug is text-only — drop any attached images.
    const { images: _images, ...debugCtx } = ctx;
    void _images;
    const stripped =
      ctx.message.replace(/^\/debug\s*/, "").trim() ||
      "Diagnose recent system behavior. Anything unusual?";
    const r = await runDebug({ ...debugCtx, message: stripped });
    return { ...r, mode };
  }

  const r = await runCoach(ctx);
  return { ...r, mode };
}
