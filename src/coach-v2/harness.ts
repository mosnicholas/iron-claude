/**
 * Harness — the tool-use loop.
 *
 * Given a system prompt, a user message, and a set of tools, runs the model
 * to a final text response, executing tool calls along the way and logging
 * every one to state/tool-calls.jsonl.
 */

import { z } from "zod";
import {
  createLLMClient,
  type AssistantContentBlock,
  type LLMClient,
  type Message,
  type SystemBlock,
  type ToolUseBlock,
  type ToolResultBlock,
} from "./llm-client.js";
import { logMeta, logToolCall, newTurnId } from "./observability.js";
import { toolToAnthropic, type Tool, type ToolContext } from "./tool.js";

export interface HarnessOptions {
  model: string;
  system: SystemBlock[];
  userMessage: string;
  tools: Tool[];
  ctx: Omit<ToolContext, "turnId">;
  /** Hard cap on tool-use rounds. Default 12. */
  maxTurns?: number;
  /** Optional progress callback — fires when a tool is about to run. */
  onStatus?: (status: string) => void;
  /** Custom LLM client (used by tests / OpenRouter swap). */
  llm?: LLMClient;
}

export interface HarnessResult {
  message: string;
  toolsUsed: string[];
  turnsUsed: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
}

const TOOL_RESULT_TRUNCATE = 16_000;

export async function runHarness(opts: HarnessOptions): Promise<HarnessResult> {
  const llm = opts.llm ?? createLLMClient();
  const turnId = newTurnId();
  const ctx: ToolContext = { ...opts.ctx, turnId };
  const toolsByName = new Map(opts.tools.map((t) => [t.name, t] as const));
  const anthropicTools = opts.tools.map((t) => toolToAnthropic(t));

  const messages: Message[] = [{ role: "user", content: opts.userMessage }];
  const toolsUsed: string[] = [];
  const usage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };

  const maxTurns = opts.maxTurns ?? 12;

  for (let turn = 0; turn < maxTurns; turn++) {
    const llmStart = Date.now();
    const response = await llm.query({
      model: opts.model,
      system: opts.system,
      messages,
      tools: anthropicTools,
      maxTokens: 4096,
    });

    usage.input_tokens += response.usage.input_tokens;
    usage.output_tokens += response.usage.output_tokens;
    usage.cache_read_input_tokens += response.usage.cache_read_input_tokens ?? 0;
    usage.cache_creation_input_tokens += response.usage.cache_creation_input_tokens ?? 0;

    logMeta(ctx.repoPath, {
      ts: new Date().toISOString(),
      turn: turnId,
      handler: ctx.handler,
      tool: "_llm_call",
      args: { model: opts.model, turn },
      ms: Date.now() - llmStart,
      ok: true,
      result_preview: `stop=${response.stop_reason} in=${response.usage.input_tokens} out=${response.usage.output_tokens}`,
    });

    messages.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter((b): b is ToolUseBlock => b.type === "tool_use");

    if (response.stop_reason === "end_turn" || toolUses.length === 0) {
      const text = extractText(response.content);
      return {
        message: text,
        toolsUsed,
        turnsUsed: turn + 1,
        usage,
      };
    }

    const toolResults: ToolResultBlock[] = [];
    for (const block of toolUses) {
      toolsUsed.push(block.name);
      opts.onStatus?.(`Using ${block.name}…`);
      const result = await executeTool(toolsByName, block, ctx);
      toolResults.push(result);
    }

    messages.push({ role: "user", content: toolResults });
  }

  // Hit max turns — return whatever text we have.
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const text = lastAssistant
    ? extractText(lastAssistant.content as AssistantContentBlock[])
    : "(coach exhausted tool turns without producing a reply)";
  return { message: text, toolsUsed, turnsUsed: maxTurns, usage };
}

function extractText(blocks: AssistantContentBlock[]): string {
  return blocks
    .filter((b): b is Extract<AssistantContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

async function executeTool(
  toolsByName: Map<string, Tool>,
  block: ToolUseBlock,
  ctx: ToolContext
): Promise<ToolResultBlock> {
  const start = Date.now();
  const tool = toolsByName.get(block.name);

  if (!tool) {
    const error = `Unknown tool: ${block.name}`;
    logToolCall(ctx.repoPath, {
      ts: new Date().toISOString(),
      turn: ctx.turnId,
      handler: ctx.handler,
      tool: block.name,
      args: block.input,
      ms: Date.now() - start,
      ok: false,
      error,
    });
    return {
      type: "tool_result",
      tool_use_id: block.id,
      content: error,
      is_error: true,
    };
  }

  // Validate input against the zod schema.
  const parsed = tool.schema.safeParse(block.input);
  if (!parsed.success) {
    const error = `Invalid input for ${block.name}: ${z.prettifyError(parsed.error)}`;
    logToolCall(ctx.repoPath, {
      ts: new Date().toISOString(),
      turn: ctx.turnId,
      handler: ctx.handler,
      tool: block.name,
      args: block.input,
      ms: Date.now() - start,
      ok: false,
      error,
    });
    return {
      type: "tool_result",
      tool_use_id: block.id,
      content: error,
      is_error: true,
    };
  }

  try {
    const result = await tool.handler(parsed.data, ctx);
    const truncated =
      result.length > TOOL_RESULT_TRUNCATE
        ? result.slice(0, TOOL_RESULT_TRUNCATE) + "\n…[truncated]"
        : result;
    logToolCall(ctx.repoPath, {
      ts: new Date().toISOString(),
      turn: ctx.turnId,
      handler: ctx.handler,
      tool: block.name,
      args: parsed.data as Record<string, unknown>,
      ms: Date.now() - start,
      ok: true,
      result_preview: truncated.slice(0, 200),
    });
    return {
      type: "tool_result",
      tool_use_id: block.id,
      content: truncated,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logToolCall(ctx.repoPath, {
      ts: new Date().toISOString(),
      turn: ctx.turnId,
      handler: ctx.handler,
      tool: block.name,
      args: parsed.data as Record<string, unknown>,
      ms: Date.now() - start,
      ok: false,
      error,
    });
    return {
      type: "tool_result",
      tool_use_id: block.id,
      content: `Tool error: ${error}`,
      is_error: true,
    };
  }
}
