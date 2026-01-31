/**
 * Message History Store
 *
 * Stores recent Telegram messages in memory for context when Claude responds.
 * Messages are stored with timestamps and expire after a configurable duration.
 */

export interface StoredMessage {
  text: string;
  timestamp: Date;
  isFromUser: boolean; // true = user message, false = bot response
}

const MAX_MESSAGES = 20;
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-memory store for recent messages
const messageHistory: StoredMessage[] = [];

/**
 * Add a message to the history
 */
export function addMessage(text: string, isFromUser: boolean): void {
  messageHistory.push({
    text,
    timestamp: new Date(),
    isFromUser,
  });

  // Trim to max size
  while (messageHistory.length > MAX_MESSAGES) {
    messageHistory.shift();
  }
}

/**
 * Get recent messages for context
 * @param count Number of messages to return (default: 10)
 * @returns Array of recent messages, oldest first
 */
export function getRecentMessages(count = 10): StoredMessage[] {
  const now = Date.now();

  // Filter out expired messages
  const validMessages = messageHistory.filter((msg) => now - msg.timestamp.getTime() < MAX_AGE_MS);

  // Return the last N messages
  return validMessages.slice(-count);
}

/**
 * Format recent messages for inclusion in a prompt
 * @param count Number of messages to include
 * @returns Formatted string of recent messages
 */
export function formatRecentMessagesForPrompt(count = 10): string {
  const messages = getRecentMessages(count);

  if (messages.length === 0) {
    return "";
  }

  const formatted = messages.map((msg) => {
    const role = msg.isFromUser ? "User" : "Coach";
    const time = msg.timestamp.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    // Truncate long messages
    const text = msg.text.length > 200 ? msg.text.slice(0, 200) + "..." : msg.text;
    return `[${time}] ${role}: ${text}`;
  });

  return `## Recent Conversation History

The following are the last ${messages.length} messages from this conversation:

${formatted.join("\n")}

Use this context to maintain conversation continuity.`;
}

/**
 * Clear all message history (for testing or reset)
 */
export function clearMessageHistory(): void {
  messageHistory.length = 0;
}
