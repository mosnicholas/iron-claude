/**
 * Coach Agent
 *
 * The main Claude-powered fitness coach agent.
 * Handles conversations, tool execution, and workout management.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlock,
  MessageParam,
  ToolUseBlock,
  ToolResultBlockParam,
  TextBlock,
} from '@anthropic-ai/sdk/resources/messages.js';
import { GitHubStorage, createGitHubStorage } from '../storage/github.js';
import { COACH_TOOLS, ToolExecutor } from './tools.js';
import { buildAgentContext, formatContextForPrompt } from './context.js';
import { buildSystemPrompt } from './prompts.js';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const MAX_TURNS = 10;

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

/**
 * The main Coach Agent class
 */
export class CoachAgent {
  private client: Anthropic;
  private storage: GitHubStorage;
  private toolExecutor: ToolExecutor;
  private config: Required<CoachConfig>;

  constructor(config: CoachConfig = {}) {
    this.client = new Anthropic();
    this.storage = createGitHubStorage();
    this.toolExecutor = new ToolExecutor(this.storage);
    this.config = {
      model: config.model || DEFAULT_MODEL,
      timezone: config.timezone || process.env.TIMEZONE || 'America/New_York',
      maxTurns: config.maxTurns || MAX_TURNS,
    };
  }

  private extractTextResponse(content: ContentBlock[]): string {
    return content
      .filter((block): block is TextBlock => block.type === 'text')
      .map(b => b.text)
      .join('\n');
  }

  private async runAgentLoop(
    userMessage: string,
    systemPrompt: string,
    maxTokens: number
  ): Promise<CoachResponse> {
    const messages: MessageParam[] = [{ role: 'user', content: userMessage }];
    const toolsUsed: string[] = [];
    let turnsUsed = 0;

    while (turnsUsed < this.config.maxTurns) {
      turnsUsed++;

      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: maxTokens,
        system: systemPrompt,
        tools: COACH_TOOLS,
        messages,
      });

      const toolUseBlocks = response.content.filter(
        (block): block is ToolUseBlock => block.type === 'tool_use'
      );

      // No tools to execute or model signaled end of turn
      const isComplete = toolUseBlocks.length === 0 || response.stop_reason === 'end_turn';
      if (isComplete) {
        const message = this.extractTextResponse(response.content);
        if (message || toolUseBlocks.length === 0) {
          return { message, toolsUsed, turnsUsed };
        }
      }

      // Execute tools and collect results
      const toolResults: ToolResultBlockParam[] = [];
      for (const toolUse of toolUseBlocks) {
        toolsUsed.push(toolUse.name);
        const result = await this.toolExecutor.execute(
          toolUse.name,
          toolUse.input as Record<string, unknown>
        );
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: result.success ? result.result || 'Success' : `Error: ${result.error}`,
          is_error: !result.success,
        });
      }

      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });
    }

    return {
      message: 'Processing reached maximum turns.',
      toolsUsed,
      turnsUsed,
    };
  }

  async chat(userMessage: string): Promise<CoachResponse> {
    const context = await buildAgentContext(this.storage, this.config.timezone);
    const contextSection = formatContextForPrompt(context, this.config.timezone);
    const systemPrompt = buildSystemPrompt(contextSection);
    return this.runAgentLoop(userMessage, systemPrompt, 4096);
  }

  async runTask(taskPrompt: string, additionalContext?: string): Promise<CoachResponse> {
    const context = await buildAgentContext(this.storage, this.config.timezone);
    const contextSection = formatContextForPrompt(context, this.config.timezone);
    let systemPrompt = buildSystemPrompt(contextSection);
    if (additionalContext) {
      systemPrompt += `\n\n## Additional Task Context\n\n${additionalContext}`;
    }
    return this.runAgentLoop(taskPrompt, systemPrompt, 8192);
  }

  /**
   * Get the GitHub storage instance for direct operations
   */
  getStorage(): GitHubStorage {
    return this.storage;
  }
}

/**
 * Create a coach agent with default configuration
 */
export function createCoachAgent(config?: CoachConfig): CoachAgent {
  return new CoachAgent(config);
}

/**
 * Quick helper to process a single message
 */
export async function processMessage(
  message: string,
  config?: CoachConfig
): Promise<string> {
  const agent = createCoachAgent(config);
  const response = await agent.chat(message);
  return response.message;
}
