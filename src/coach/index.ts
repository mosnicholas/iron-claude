/**
 * Coach Agent
 *
 * The main Claude-powered fitness coach agent using Claude Agent SDK.
 * Uses local file system access for exploring workout data.
 */

import { spawnSync } from "child_process";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { syncRepo, pushChanges } from "../storage/repo-sync.js";
import { buildSystemPrompt, type WorkoutLogSummary } from "./prompts.js";
import { parseFrontmatter } from "../integrations/storage.js";
import { getCurrentWeek, getToday, getTimezone } from "../utils/date.js";
import {
  extractTextFromMessage,
  extractToolsFromMessage,
  formatToolStatus,
} from "../utils/sdk-helpers.js";

// Cache the git binary path - only need to look it up once
let cachedGitPath: string | null = null;

function getGitBinaryPath(): string {
  if (cachedGitPath) {
    return cachedGitPath;
  }

  // Try 'which git' to find the git binary
  const result = spawnSync("which", ["git"], {
    stdio: "pipe",
    encoding: "utf-8",
  });

  if (result.status === 0 && result.stdout) {
    cachedGitPath = result.stdout.trim();
  } else {
    // Fallback to common locations
    cachedGitPath = "/usr/bin/git";
  }

  return cachedGitPath;
}

export interface CoachConfig {
  model?: string;
  timezone?: string;
  maxTurns?: number;
}

export interface CoachResponse {
  message: string;
  toolsUsed: string[];
  turnsUsed: number;
}

export interface StreamingCallbacks {
  onStatus?: (status: string) => void;
}

export interface QueryOptions {
  additionalTools?: string[];
}

export class CoachAgent {
  private config: Required<CoachConfig>;
  private repoPath: string | null = null;

  constructor(config: CoachConfig = {}) {
    this.config = {
      model: config.model || "claude-sonnet-4-5-20250929",
      timezone: config.timezone || getTimezone(),
      maxTurns: config.maxTurns || 10,
    };
  }

  private async ensureRepoSynced(): Promise<string> {
    if (!this.repoPath) {
      const repoName = process.env.DATA_REPO;
      const token = process.env.GITHUB_TOKEN;

      if (!repoName || !token) {
        throw new Error("DATA_REPO and GITHUB_TOKEN must be set");
      }

      this.repoPath = await syncRepo({
        repoUrl: `https://github.com/${repoName}.git`,
        token,
      });
    }
    return this.repoPath;
  }

  /**
   * Try to read the current week's plan from the local repo
   */
  private getWeeklyPlan(repoPath: string): string | undefined {
    const currentWeek = getCurrentWeek(this.config.timezone);
    const planPath = join(repoPath, "weeks", currentWeek, "plan.md");

    if (existsSync(planPath)) {
      try {
        return readFileSync(planPath, "utf-8");
      } catch {
        console.log(`[Coach] Could not read weekly plan from ${planPath}`);
        return undefined;
      }
    }
    return undefined;
  }

  /**
   * Try to read the PRs file from the local repo
   */
  private getPRs(repoPath: string): string | undefined {
    const prsPath = join(repoPath, "prs.yaml");

    if (existsSync(prsPath)) {
      try {
        return readFileSync(prsPath, "utf-8");
      } catch {
        console.log(`[Coach] Could not read PRs from ${prsPath}`);
        return undefined;
      }
    }
    return undefined;
  }

  /**
   * Try to read today's workout log from the local repo
   */
  private getTodayWorkout(repoPath: string): string | undefined {
    const currentWeek = getCurrentWeek(this.config.timezone);
    const today = getToday(this.config.timezone);
    const workoutPath = join(repoPath, "weeks", currentWeek, `${today}.md`);

    if (existsSync(workoutPath)) {
      try {
        return readFileSync(workoutPath, "utf-8");
      } catch {
        console.log(`[Coach] Could not read today's workout from ${workoutPath}`);
        return undefined;
      }
    }
    return undefined;
  }

  /**
   * Get summaries of all workout logs in the current week's folder
   */
  private getWeekProgress(repoPath: string): WorkoutLogSummary[] {
    const currentWeek = getCurrentWeek(this.config.timezone);
    const weekDir = join(repoPath, "weeks", currentWeek);

    if (!existsSync(weekDir)) return [];

    const files = readdirSync(weekDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));

    return files.map((f) => {
      try {
        const content = readFileSync(join(weekDir, f), "utf-8");
        const { frontmatter } = parseFrontmatter(content);
        return {
          date: f.replace(".md", ""),
          type: (frontmatter.type as string) || "unknown",
          status: (frontmatter.status as string) || "unknown",
        };
      } catch {
        return {
          date: f.replace(".md", ""),
          type: "unknown",
          status: "unknown",
        };
      }
    });
  }

  private async runQuery(
    prompt: string,
    additionalContext?: string,
    callbacks?: StreamingCallbacks,
    options?: QueryOptions
  ): Promise<CoachResponse> {
    const repoPath = await this.ensureRepoSynced();
    const gitBinaryPath = getGitBinaryPath();

    // Pre-load context data for faster responses
    const weeklyPlan = this.getWeeklyPlan(repoPath);
    const prsYaml = this.getPRs(repoPath);
    const todayWorkout = this.getTodayWorkout(repoPath);
    const weekProgress = this.getWeekProgress(repoPath);

    // Build system prompt with environment paths and context
    const basePrompt = buildSystemPrompt({
      repoPath,
      gitBinaryPath,
      weeklyPlan,
      prsYaml,
      todayWorkout,
      weekProgress,
    });
    const systemPrompt = additionalContext
      ? `${basePrompt}\n\n## Additional Context\n\n${additionalContext}`
      : basePrompt;

    const toolsUsed: string[] = [];
    let responseText = "";
    let turnsUsed = 0;

    // Track tool inputs by tool_use_id for accurate status messages
    const toolInputsById: Map<string, { name: string; input: Record<string, unknown> }> = new Map();

    // Send initial "Thinking..." status
    if (callbacks?.onStatus) {
      callbacks.onStatus("Thinking...");
    }

    // Build allowed tools list
    const baseTools = ["Read", "Edit", "Write", "Bash", "Glob", "Grep"];
    const allowedTools = options?.additionalTools
      ? [...baseTools, ...options.additionalTools]
      : baseTools;

    const q = query({
      prompt,
      options: {
        systemPrompt,
        cwd: repoPath,
        maxTurns: this.config.maxTurns,
        model: this.config.model,
        allowedTools,
        permissionMode: "acceptEdits",
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
          TIMEZONE: this.config.timezone,
        },
      },
    });

    try {
      for await (const message of q) {
        if (message.type === "assistant") {
          responseText = extractTextFromMessage(message);
          const tools = extractToolsFromMessage(message);
          toolsUsed.push(...tools);
          turnsUsed++;

          // Extract tool inputs by tool_use_id for status formatting
          const content = message.message.content as Array<{
            type: string;
            id?: string;
            name?: string;
            input?: Record<string, unknown>;
          }>;
          for (const block of content) {
            if (block.type === "tool_use" && block.id && block.name) {
              toolInputsById.set(block.id, {
                name: block.name,
                input: block.input || {},
              });
              // Also send status when tool starts
              if (callbacks?.onStatus) {
                const status = formatToolStatus(block.name, block.input || {});
                callbacks.onStatus(status);
              }
            }
          }
        } else if (message.type === "tool_progress" && callbacks?.onStatus) {
          const progressMsg = message as {
            tool_use_id?: string;
            tool_name?: string;
            elapsed_time_seconds?: number;
          };

          if (progressMsg.tool_use_id) {
            const toolInfo = toolInputsById.get(progressMsg.tool_use_id);
            const toolName = toolInfo?.name || progressMsg.tool_name || "tool";
            const input = toolInfo?.input || {};
            const status = formatToolStatus(toolName, input, progressMsg.elapsed_time_seconds);
            callbacks.onStatus(status);
          }
        }
      }
    } catch (error) {
      console.error("[Coach] Query error:", error);
      throw error;
    }

    await pushChanges("Update from coach conversation");

    return { message: responseText, toolsUsed, turnsUsed };
  }

  async chat(
    userMessage: string,
    callbacks?: StreamingCallbacks,
    options?: QueryOptions
  ): Promise<CoachResponse> {
    return this.runQuery(userMessage, undefined, callbacks, options);
  }

  async runTask(
    taskPrompt: string,
    additionalContext?: string,
    callbacks?: StreamingCallbacks
  ): Promise<CoachResponse> {
    return this.runQuery(taskPrompt, additionalContext, callbacks);
  }
}

export function createCoachAgent(config?: CoachConfig): CoachAgent {
  return new CoachAgent(config);
}

export async function processMessage(message: string, config?: CoachConfig): Promise<string> {
  const agent = createCoachAgent(config);
  const response = await agent.chat(message);
  return response.message;
}
