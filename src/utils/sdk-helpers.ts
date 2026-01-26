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

/**
 * Format a tool execution into a human-readable status message
 */
export function formatToolStatus(
  toolName: string,
  input: Record<string, unknown>,
  elapsedSeconds?: number
): string {
  let action: string;

  switch (toolName) {
    case "Read":
      if (input.file_path) {
        const path = String(input.file_path);
        const fileName = path.split("/").pop() || path;
        action = `Reading ${fileName}`;
      } else {
        action = "Reading file";
      }
      break;

    case "Write":
      if (input.file_path) {
        const path = String(input.file_path);
        const fileName = path.split("/").pop() || path;
        action = `Writing ${fileName}`;
      } else {
        action = "Writing file";
      }
      break;

    case "Edit":
      if (input.file_path) {
        const path = String(input.file_path);
        const fileName = path.split("/").pop() || path;
        action = `Editing ${fileName}`;
      } else {
        action = "Editing file";
      }
      break;

    case "Bash":
      if (input.command) {
        const cmd = String(input.command);
        // Show first part of command, truncated
        const shortCmd = cmd.length > 30 ? cmd.slice(0, 27) + "..." : cmd;
        action = `Running ${shortCmd}`;
      } else {
        action = "Running command";
      }
      break;

    case "Glob":
      if (input.pattern) {
        action = `Searching for ${input.pattern}`;
      } else {
        action = "Searching files";
      }
      break;

    case "Grep":
      if (input.pattern) {
        action = `Searching for "${input.pattern}"`;
      } else {
        action = "Searching content";
      }
      break;

    default:
      action = `Using ${toolName}`;
  }

  // Add elapsed time indicator for long operations
  if (elapsedSeconds !== undefined && elapsedSeconds > 3) {
    action += ` (${Math.round(elapsedSeconds)}s)`;
  }

  return action + "...";
}
