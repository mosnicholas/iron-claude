/**
 * Coach Agent
 *
 * The main Claude-powered fitness coach agent.
 * Handles conversations, tool execution, and workout management.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam,
  ContentBlock,
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

  /**
   * Process a user message and generate a response
   */
  async chat(userMessage: string): Promise<CoachResponse> {
    // Build context for system prompt
    const context = await buildAgentContext(this.storage, this.config.timezone);
    const contextSection = formatContextForPrompt(context, this.config.timezone);
    const systemPrompt = buildSystemPrompt(contextSection);

    // Initialize conversation
    const messages: MessageParam[] = [
      { role: 'user', content: userMessage },
    ];

    const toolsUsed: string[] = [];
    let turnsUsed = 0;

    // Agent loop
    while (turnsUsed < this.config.maxTurns) {
      turnsUsed++;

      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: 4096,
        system: systemPrompt,
        tools: COACH_TOOLS,
        messages,
      });

      // Check if we need to process tool calls
      const toolUseBlocks = response.content.filter(
        (block): block is ToolUseBlock => block.type === 'tool_use'
      );

      if (toolUseBlocks.length === 0) {
        // No tool calls, extract the final text response
        const textBlocks = response.content.filter(
          (block): block is TextBlock => block.type === 'text'
        );
        const finalMessage = textBlocks.map(b => b.text).join('\n');

        return {
          message: finalMessage,
          toolsUsed,
          turnsUsed,
        };
      }

      // Execute tool calls
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
          content: result.success
            ? result.result || 'Success'
            : `Error: ${result.error}`,
          is_error: !result.success,
        });
      }

      // Add assistant message with tool use
      messages.push({
        role: 'assistant',
        content: response.content,
      });

      // Add tool results
      messages.push({
        role: 'user',
        content: toolResults,
      });

      // Check stop reason
      if (response.stop_reason === 'end_turn') {
        // Extract any text from the response
        const textBlocks = response.content.filter(
          (block): block is TextBlock => block.type === 'text'
        );
        if (textBlocks.length > 0) {
          return {
            message: textBlocks.map(b => b.text).join('\n'),
            toolsUsed,
            turnsUsed,
          };
        }
      }
    }

    // Max turns reached
    return {
      message: "I've been working on this for a while. Let me know if you need anything specific!",
      toolsUsed,
      turnsUsed,
    };
  }

  /**
   * Run a specific coaching task (for cron jobs)
   */
  async runTask(taskPrompt: string, additionalContext?: string): Promise<CoachResponse> {
    const context = await buildAgentContext(this.storage, this.config.timezone);
    const contextSection = formatContextForPrompt(context, this.config.timezone);

    let systemPrompt = buildSystemPrompt(contextSection);

    if (additionalContext) {
      systemPrompt += `\n\n## Additional Task Context\n\n${additionalContext}`;
    }

    const messages: MessageParam[] = [
      { role: 'user', content: taskPrompt },
    ];

    const toolsUsed: string[] = [];
    let turnsUsed = 0;

    while (turnsUsed < this.config.maxTurns) {
      turnsUsed++;

      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: 8192, // Higher limit for planning/retro tasks
        system: systemPrompt,
        tools: COACH_TOOLS,
        messages,
      });

      const toolUseBlocks = response.content.filter(
        (block): block is ToolUseBlock => block.type === 'tool_use'
      );

      if (toolUseBlocks.length === 0) {
        const textBlocks = response.content.filter(
          (block): block is TextBlock => block.type === 'text'
        );
        return {
          message: textBlocks.map(b => b.text).join('\n'),
          toolsUsed,
          turnsUsed,
        };
      }

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
          content: result.success
            ? result.result || 'Success'
            : `Error: ${result.error}`,
          is_error: !result.success,
        });
      }

      messages.push({
        role: 'assistant',
        content: response.content,
      });

      messages.push({
        role: 'user',
        content: toolResults,
      });

      if (response.stop_reason === 'end_turn') {
        const textBlocks = response.content.filter(
          (block): block is TextBlock => block.type === 'text'
        );
        if (textBlocks.length > 0) {
          return {
            message: textBlocks.map(b => b.text).join('\n'),
            toolsUsed,
            turnsUsed,
          };
        }
      }
    }

    return {
      message: 'Task processing reached maximum turns.',
      toolsUsed,
      turnsUsed,
    };
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
