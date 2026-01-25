/**
 * SDK Helper Functions
 *
 * Utilities for working with Claude Agent SDK messages.
 */

import type { SDKAssistantMessage } from '@anthropic-ai/claude-agent-sdk';

/**
 * Extract text content from an SDK assistant message
 */
export function extractTextFromMessage(message: SDKAssistantMessage): string {
  return message.message.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { type: 'text'; text: string }).text)
    .join('\n');
}

/**
 * Extract tool names used in an SDK assistant message
 */
export function extractToolsFromMessage(message: SDKAssistantMessage): string[] {
  return message.message.content
    .filter((block) => block.type === 'tool_use')
    .map((block) => (block as { type: 'tool_use'; name: string }).name);
}
