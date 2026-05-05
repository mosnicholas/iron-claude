/**
 * Harness tests with a fake LLM client.
 *
 * Verifies that the tool-use loop:
 *   - Routes tool calls to the correct tool handler
 *   - Stops on end_turn
 *   - Records every tool call to state/tool-calls.jsonl
 *   - Reports schema validation errors back to the model rather than crashing
 *   - Caps at maxTurns
 */

import { execSync } from "child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { z } from "zod";
import { runHarness } from "./harness.js";
import { defineTool } from "./tool.js";
import type { AssistantContentBlock, LLMClient, LLMResponse } from "./llm-client.js";

class ScriptedLLM implements LLMClient {
  private idx = 0;
  constructor(private responses: LLMResponse[]) {}
  async query(): Promise<LLMResponse> {
    const r = this.responses[this.idx++];
    if (!r) throw new Error("ScriptedLLM: ran out of canned responses");
    return r;
  }
}

function setupRepo(): string {
  const path = mkdtempSync(join(tmpdir(), "ironclaude-harness-"));
  execSync("git init", { cwd: path, stdio: "pipe" });
  execSync('git config user.email "test@test.dev"', { cwd: path, stdio: "pipe" });
  execSync('git config user.name "test"', { cwd: path, stdio: "pipe" });
  execSync("git config commit.gpgsign false", { cwd: path, stdio: "pipe" });
  writeFileSync(join(path, ".keep"), "");
  execSync("git add -A && git commit -m init", { cwd: path, stdio: "pipe" });
  return path;
}

function textBlock(text: string): AssistantContentBlock {
  return { type: "text", text };
}

function toolUseBlock(
  id: string,
  name: string,
  input: Record<string, unknown>
): AssistantContentBlock {
  return { type: "tool_use", id, name, input };
}

const noopUsage = {
  input_tokens: 10,
  output_tokens: 5,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};

describe("harness loop", () => {
  let repoPath: string;
  beforeEach(() => {
    repoPath = setupRepo();
  });
  afterEach(() => rmSync(repoPath, { recursive: true, force: true }));

  it("runs a simple tool call then ends on end_turn", async () => {
    const echo = defineTool({
      name: "echo",
      description: "Echo back the message",
      schema: z.object({ msg: z.string() }),
      handler: async (input) => `echoed: ${input.msg}`,
    });

    const llm = new ScriptedLLM([
      {
        stop_reason: "tool_use",
        content: [toolUseBlock("u1", "echo", { msg: "hi" })],
        usage: noopUsage,
      },
      {
        stop_reason: "end_turn",
        content: [textBlock("Done.")],
        usage: noopUsage,
      },
    ]);

    const result = await runHarness({
      model: "test-model",
      system: [{ type: "text", text: "system" }],
      userMessage: "test",
      tools: [echo],
      ctx: { repoPath, timezone: "America/New_York", handler: "test" },
      llm,
    });

    expect(result.message).toBe("Done.");
    expect(result.toolsUsed).toEqual(["echo"]);
    expect(result.turnsUsed).toBe(2);
  });

  it("logs every tool call to state/tool-calls.jsonl", async () => {
    const echo = defineTool({
      name: "echo",
      description: "echo",
      schema: z.object({ msg: z.string() }),
      handler: async (i) => `echoed: ${i.msg}`,
    });
    const llm = new ScriptedLLM([
      {
        stop_reason: "tool_use",
        content: [toolUseBlock("u1", "echo", { msg: "hi" })],
        usage: noopUsage,
      },
      {
        stop_reason: "end_turn",
        content: [textBlock("ok")],
        usage: noopUsage,
      },
    ]);
    await runHarness({
      model: "test-model",
      system: [{ type: "text", text: "s" }],
      userMessage: "u",
      tools: [echo],
      ctx: { repoPath, timezone: "America/New_York", handler: "test" },
      llm,
    });

    const path = join(repoPath, "state", "tool-calls.jsonl");
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, "utf-8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
    const echoCall = lines.find((l) => l.tool === "echo");
    expect(echoCall).toBeDefined();
    expect(echoCall.ok).toBe(true);
    expect(echoCall.args).toEqual({ msg: "hi" });
  });

  it("returns a tool error to the model on schema validation failure", async () => {
    const strictTool = defineTool({
      name: "strict",
      description: "needs a positive int",
      schema: z.object({ n: z.number().int().positive() }),
      handler: async () => "ok",
    });
    const llm = new ScriptedLLM([
      {
        stop_reason: "tool_use",
        content: [toolUseBlock("u1", "strict", { n: -5 })],
        usage: noopUsage,
      },
      {
        stop_reason: "end_turn",
        content: [textBlock("recovered")],
        usage: noopUsage,
      },
    ]);
    const result = await runHarness({
      model: "test-model",
      system: [{ type: "text", text: "s" }],
      userMessage: "u",
      tools: [strictTool],
      ctx: { repoPath, timezone: "America/New_York", handler: "test" },
      llm,
    });
    expect(result.message).toBe("recovered");
    const log = readFileSync(join(repoPath, "state", "tool-calls.jsonl"), "utf-8");
    expect(log).toMatch(/"ok":false/);
    expect(log).toMatch(/Invalid input for strict/);
  });

  it("handles unknown tool names gracefully", async () => {
    const llm = new ScriptedLLM([
      {
        stop_reason: "tool_use",
        content: [toolUseBlock("u1", "nonexistent", {})],
        usage: noopUsage,
      },
      {
        stop_reason: "end_turn",
        content: [textBlock("recovered")],
        usage: noopUsage,
      },
    ]);
    const result = await runHarness({
      model: "test-model",
      system: [{ type: "text", text: "s" }],
      userMessage: "u",
      tools: [],
      ctx: { repoPath, timezone: "America/New_York", handler: "test" },
      llm,
    });
    expect(result.message).toBe("recovered");
    const log = readFileSync(join(repoPath, "state", "tool-calls.jsonl"), "utf-8");
    expect(log).toContain("Unknown tool: nonexistent");
  });
});
