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

export type AssistantContentBlock = TextBlock | ToolUseBlock | ThinkingBlock;

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

/**
 * Extended-thinking block. The SDK returns these as part of assistant content
 * when `thinking` is enabled. They MUST be passed back unmodified on the next
 * turn when tool use is involved, otherwise the API rejects the request.
 */
export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
  signature: string;
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
  maxTokens?: number;
  /**
   * Enable Claude extended thinking. When set, the model emits a `thinking`
   * block before its first content block on each assistant turn. Streamed
   * deltas are surfaced via `onThinkingDelta`.
   */
  thinking?: { budgetTokens: number };
  /** Streamed thinking deltas — fired as the model thinks. */
  onThinkingDelta?: (delta: string) => void;
  /** Streamed text deltas — fired as the model writes its visible reply. */
  onTextDelta?: (delta: string) => void;
}

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
    // max_tokens must exceed thinking budget; pad if the caller forgot.
    const baseMax = req.maxTokens ?? 4096;
    const maxTokens = req.thinking ? Math.max(baseMax, req.thinking.budgetTokens + 4096) : baseMax;

    // The SDK's typed params don't always carry `thinking` on older minor
    // versions, so we build the params object once and cast at the seam.
    const params: Record<string, unknown> = {
      model: req.model,
      max_tokens: maxTokens,
      system: req.system,
      messages: req.messages,
      tools: req.tools,
    };
    if (req.thinking) {
      params.thinking = { type: "enabled", budget_tokens: req.thinking.budgetTokens };
    }

    const stream = this.client.messages.stream(params as unknown as Anthropic.MessageStreamParams);

    for await (const event of stream) {
      if (event.type === "content_block_delta") {
        const delta = event.delta as { type: string; text?: string; thinking?: string };
        if (delta.type === "thinking_delta" && delta.thinking) {
          req.onThinkingDelta?.(delta.thinking);
        } else if (delta.type === "text_delta" && delta.text) {
          req.onTextDelta?.(delta.text);
        }
      }
    }

    const message = await stream.finalMessage();

    return {
      stop_reason: message.stop_reason ?? "end_turn",
      content: message.content as unknown as AssistantContentBlock[],
      usage: {
        input_tokens: message.usage.input_tokens,
        output_tokens: message.usage.output_tokens,
        cache_creation_input_tokens: message.usage.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: message.usage.cache_read_input_tokens ?? 0,
      },
    };
  }
}

export function createLLMClient(): LLMClient {
  return new AnthropicLLMClient();
}
