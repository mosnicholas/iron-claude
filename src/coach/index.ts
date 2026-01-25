/**
 * Coach Agent
 *
 * The main Claude-powered fitness coach agent using Claude Agent SDK.
 * Uses local file system access for exploring workout data.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { syncRepo, pushChanges } from "../storage/repo-sync.js";
import { buildSystemPrompt } from "./prompts.js";
import { extractTextFromMessage, extractToolsFromMessage } from "../utils/sdk-helpers.js";

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

export class CoachAgent {
  private config: Required<CoachConfig>;
  private repoPath: string | null = null;

  constructor(config: CoachConfig = {}) {
    this.config = {
      model: config.model || "claude-sonnet-4-5-20250929",
      timezone: config.timezone || process.env.TIMEZONE || "America/New_York",
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

  private async runQuery(prompt: string, systemPrompt: string): Promise<CoachResponse> {
    const repoPath = await this.ensureRepoSynced();

    const toolsUsed: string[] = [];
    let responseText = "";
    let turnsUsed = 0;

    const q = query({
      prompt,
      options: {
        systemPrompt,
        cwd: repoPath,
        maxTurns: this.config.maxTurns,
        model: this.config.model,
        allowedTools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
        permissionMode: "acceptEdits",
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
          TIMEZONE: this.config.timezone,
        },
      },
    });

    for await (const message of q) {
      if (message.type === "assistant") {
        responseText = extractTextFromMessage(message);
        toolsUsed.push(...extractToolsFromMessage(message));
        turnsUsed++;
      }
    }

    await pushChanges("Update from coach conversation");

    return { message: responseText, toolsUsed, turnsUsed };
  }

  async chat(userMessage: string): Promise<CoachResponse> {
    const systemPrompt = buildSystemPrompt(this.config.timezone);
    return this.runQuery(userMessage, systemPrompt);
  }

  async runTask(taskPrompt: string, additionalContext?: string): Promise<CoachResponse> {
    const basePrompt = buildSystemPrompt(this.config.timezone);
    const systemPrompt = additionalContext
      ? `${basePrompt}\n\n## Additional Context\n\n${additionalContext}`
      : basePrompt;
    return this.runQuery(taskPrompt, systemPrompt);
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
