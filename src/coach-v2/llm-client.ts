/**
 * LLM client interface — the single seam between the harness and the model
 * provider. Built on @anthropic-ai/sdk today; OpenRouter/GPT/etc. would be a
 * new file implementing LLMClient, not a rewrite of the harness.
 */

import Anthropic from "@anthropic-ai/sdk";

export interface ToolDef {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface SystemBlock {
  type: "text";
  text: string;
  /** When set to "ephemeral", the SDK will mark this block for prompt caching. */
  cache_control?: { type: "ephemeral" };
}

export interface UserMessage {
  role: "user";
  content: string | UserContentBlock[];
}

export interface AssistantMessage {
  role: "assistant";
  content: AssistantContentBlock[];
}

export type Message = UserMessage | AssistantMessage;

export type UserContentBlock = ToolResultBlock | { type: "text"; text: string };

export type AssistantContentBlock = TextBlock | ToolUseBlock;

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface LLMRequest {
  model: string;
  system: SystemBlock[];
  messages: Message[];
  tools: ToolDef[];
}

// Coach replies are short (a few hundred tokens). 6K leaves plenty of headroom
// while staying well under the SDK's non-streaming 10-minute timeout threshold.
const MAX_OUTPUT_TOKENS = 6_000;

export interface LLMResponse {
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | string;
  content: AssistantContentBlock[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export interface LLMClient {
  query(req: LLMRequest): Promise<LLMResponse>;
}

export class AnthropicLLMClient implements LLMClient {
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });
  }

  async query(req: LLMRequest): Promise<LLMResponse> {
    const response = await this.client.messages.create({
      model: req.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: req.system,
      // SDK message types are slightly stricter than ours, but the runtime
      // shape is identical for the blocks we use.
      messages: req.messages as unknown as Anthropic.MessageParam[],
      tools: req.tools,
    });

    return {
      stop_reason: response.stop_reason ?? "end_turn",
      content: response.content as unknown as AssistantContentBlock[],
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
      },
    };
  }
}

export function createLLMClient(): LLMClient {
  return new AnthropicLLMClient();
}
