/**
 * Coach v2 — public API.
 *
 * Mirrors the v1 shape (createCoachAgent / chat / runTask) so the
 * existing webhook + cron callers can swap in v2 with a flag flip.
 */

import { syncRepo } from "../storage/repo-sync.js";
import { getTimezone } from "../utils/date.js";
import { route, type RoutedResult } from "./router.js";
import { runCoach } from "./handlers/coach.js";
import { runPlanner } from "./handlers/planner.js";
import { runRetro } from "./handlers/retro.js";
import { runDailyReminder as runDailyReminderHandler } from "./handlers/daily-reminder.js";
import type { HarnessResult } from "./harness.js";

export interface CoachV2Config {
  /** Test override — skips GitHub sync. */
  repoPath?: string;
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
}

async function ensureRepo(config: CoachV2Config): Promise<string> {
  if (config.repoPath) return config.repoPath;
  const repoName = process.env.DATA_REPO;
  const token = process.env.GITHUB_TOKEN;
  if (!repoName || !token) {
    throw new Error("DATA_REPO and GITHUB_TOKEN must be set");
  }
  return syncRepo({ repoUrl: `https://github.com/${repoName}.git`, token });
}

function toResponse(r: HarnessResult, mode?: string): CoachV2Response {
  return {
    message: r.message,
    toolsUsed: r.toolsUsed,
    turnsUsed: r.turnsUsed,
    mode,
  };
}

export class CoachAgentV2 {
  constructor(private config: CoachV2Config = {}) {}

  /**
   * Conversational entry point — used by the Telegram webhook.
   *
   * The second argument can be a plain status callback (legacy form) or an
   * options bag for full streaming (status + thinking + reply text deltas).
   */
  async chat(
    message: string,
    onStatusOrOpts?:
      | ((s: string) => void)
      | {
          onStatus?: (s: string) => void;
          onThinking?: (delta: string) => void;
          onText?: (delta: string) => void;
        }
  ): Promise<CoachV2Response> {
    const repoPath = await ensureRepo(this.config);
    const timezone = this.config.timezone ?? getTimezone();
    const opts =
      typeof onStatusOrOpts === "function" ? { onStatus: onStatusOrOpts } : (onStatusOrOpts ?? {});
    const result: RoutedResult = await route({
      repoPath,
      timezone,
      message,
      onStatus: opts.onStatus,
      onThinking: opts.onThinking,
      onText: opts.onText,
    });
    return toResponse(result, result.mode);
  }

  /** Cron entry point — runs the planner directly. */
  async runPlanning(message: string): Promise<CoachV2Response> {
    const repoPath = await ensureRepo(this.config);
    const timezone = this.config.timezone ?? getTimezone();
    const r = await runPlanner({
      repoPath,
      timezone,
      message,
      model: this.config.model,
    });
    return toResponse(r, "planner");
  }

  async runRetrospective(message: string): Promise<CoachV2Response> {
    const repoPath = await ensureRepo(this.config);
    const timezone = this.config.timezone ?? getTimezone();
    const r = await runRetro({
      repoPath,
      timezone,
      message,
      model: this.config.model,
    });
    return toResponse(r, "retro");
  }

  async runDailyReminder(message: string): Promise<CoachV2Response> {
    const repoPath = await ensureRepo(this.config);
    const timezone = this.config.timezone ?? getTimezone();
    const r = await runDailyReminderHandler({
      repoPath,
      timezone,
      message,
      model: this.config.model,
    });
    return toResponse(r, "daily-reminder");
  }

  /** Force-run a specific handler — useful for tests. */
  async runCoach(message: string): Promise<CoachV2Response> {
    const repoPath = await ensureRepo(this.config);
    const timezone = this.config.timezone ?? getTimezone();
    const r = await runCoach({ repoPath, timezone, message, model: this.config.model });
    return toResponse(r, "coach");
  }
}

export function createCoachAgentV2(config?: CoachV2Config): CoachAgentV2 {
  return new CoachAgentV2(config);
}
