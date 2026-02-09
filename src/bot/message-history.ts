/**
 * Message History Store
 *
 * Stores recent Telegram messages for context when Claude responds.
 * Messages are persisted to disk so history survives restarts/deploys.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";

interface StoredMessage {
  text: string;
  timestamp: string; // ISO string for JSON serialization
  isFromUser: boolean; // true = user message, false = bot response
}

const MAX_MESSAGES = 20;
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const HISTORY_FILE = "/tmp/iron-claude-message-history.json";

// In-memory store for recent messages
let messageHistory: StoredMessage[] = [];
let loaded = false;

/**
 * Load message history from disk (lazy, once)
 */
function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;

  try {
    if (existsSync(HISTORY_FILE)) {
      const data = readFileSync(HISTORY_FILE, "utf-8");
      messageHistory = JSON.parse(data) as StoredMessage[];
      // Filter out expired messages on load
      const now = Date.now();
      messageHistory = messageHistory.filter(
        (msg) => now - new Date(msg.timestamp).getTime() < MAX_AGE_MS
      );
    }
  } catch (err) {
    console.log("[message-history] Could not load history from disk:", err);
    messageHistory = [];
  }
}

/**
 * Persist message history to disk
 */
function saveToDisk(): void {
  try {
    writeFileSync(HISTORY_FILE, JSON.stringify(messageHistory), "utf-8");
  } catch (err) {
    console.log("[message-history] Could not save history to disk:", err);
  }
}

/**
 * Add a message to the history
 */
export function addMessage(text: string, isFromUser: boolean): void {
  ensureLoaded();

  messageHistory.push({
    text,
    timestamp: new Date().toISOString(),
    isFromUser,
  });

  // Trim to max size
  while (messageHistory.length > MAX_MESSAGES) {
    messageHistory.shift();
  }

  saveToDisk();
}

/**
 * Get recent messages for context
 * @param count Number of messages to return (default: 10)
 * @returns Array of recent messages, oldest first
 */
function getRecentMessages(count = 10): StoredMessage[] {
  ensureLoaded();

  const now = Date.now();

  // Filter out expired messages
  const validMessages = messageHistory.filter(
    (msg) => now - new Date(msg.timestamp).getTime() < MAX_AGE_MS
  );

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
    const time = new Date(msg.timestamp).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return `[${time}] ${role}: ${msg.text}`;
  });

  return `## Recent Conversation History

The following are the last ${messages.length} messages from this conversation:

${formatted.join("\n")}

Use this context to maintain conversation continuity.`;
}
