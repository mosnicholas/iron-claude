/**
 * Coach v2 — public API.
 *
 * Mirrors the v1 shape (createCoachAgent / chat / runTask) so the
 * existing webhook + cron callers can swap in v2 with a flag flip.
 *
 * Specialized cron tasks (planning, retrospective, daily reminder) all run
 * through the coach handler; the model loads the relevant skill via load_skill.
 */

import { getTimezone } from "../utils/date.js";
import { route, type RoutedResult } from "./router.js";
import { runCoach } from "./handlers/coach.js";
import type { HarnessResult } from "./harness.js";
import type { ImageBlock } from "./llm-client.js";

export interface CoachV2Config {
  userId: string;
  timezone?: string;
  model?: string;
  /** Hard cap on tool turns. */
  maxTurns?: number;
}

export interface CoachV2Response {
  message: string;
  toolsUsed: string[];
  turnsUsed: number;
  mode?: string;
  /** Model used (for cost analytics). */
  model: string;
  /** Wall-clock duration of the agent turn. */
  durationMs: number;
  /** Stable id linking this turn to tool_call_log rows. */
  turnId: string;
  /** Aggregated token usage across all LLM round-trips in this turn. */
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
}

function toResponse(r: HarnessResult, mode?: string): CoachV2Response {
  return {
    message: r.message,
    toolsUsed: r.toolsUsed,
    turnsUsed: r.turnsUsed,
    mode,
    model: r.model,
    durationMs: r.durationMs,
    turnId: r.turnId,
    usage: r.usage,
  };
}

export class CoachAgentV2 {
  constructor(private config: CoachV2Config) {}

  /** Conversational entry point — used by the inbox worker. */
  async chat(
    message: string,
    onStatus?: (s: string) => void,
    onTextDelta?: (delta: string) => void,
    onThinkingDelta?: (delta: string) => void,
    images?: ImageBlock[]
  ): Promise<CoachV2Response> {
    const timezone = this.config.timezone ?? getTimezone();
    const result: RoutedResult = await route({
      userId: this.config.userId,
      timezone,
      message,
      images,
      onStatus,
      onTextDelta,
      onThinkingDelta,
    });
    return toResponse(result, result.mode);
  }

  /** Cron entry point — runs the planner skill via the coach. */
  async runPlanning(message: string): Promise<CoachV2Response> {
    return this.runCoachWithMode(message, "planner");
  }

  async runRetrospective(message: string): Promise<CoachV2Response> {
    return this.runCoachWithMode(message, "retro");
  }

  async runDailyReminder(message: string): Promise<CoachV2Response> {
    return this.runCoachWithMode(message, "daily-reminder");
  }

  /** Force-run the coach with a plain user message — useful for tests. */
  async runCoach(message: string): Promise<CoachV2Response> {
    return this.runCoachWithMode(message, "coach");
  }

  private async runCoachWithMode(message: string, mode: string): Promise<CoachV2Response> {
    const timezone = this.config.timezone ?? getTimezone();
    const r = await runCoach({
      userId: this.config.userId,
      timezone,
      message,
      model: this.config.model,
      maxTurns: this.config.maxTurns,
    });
    return toResponse(r, mode);
  }
}

export function createCoachAgentV2(config: CoachV2Config): CoachAgentV2 {
  return new CoachAgentV2(config);
}
