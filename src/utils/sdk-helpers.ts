/**
 * SDK Helper Functions
 *
 * Utilities for working with Claude Agent SDK messages.
 */

import type { SDKAssistantMessage } from "@anthropic-ai/claude-agent-sdk";

type ContentBlock = { type: string; text?: string; name?: string };

export function extractTextFromMessage(message: SDKAssistantMessage): string {
  const content = message.message.content as ContentBlock[];
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text || "")
    .join("\n");
}

export function extractToolsFromMessage(message: SDKAssistantMessage): string[] {
  const content = message.message.content as ContentBlock[];
  return content.filter((block) => block.type === "tool_use").map((block) => block.name || "");
}
