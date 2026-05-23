/**
 * Message History Store
 *
 * Postgres-backed conversation history, scoped per user. Replaces the
 * old /tmp JSON file store. All read/write functions are async since
 * they hit the DB.
 */

import { getStorage } from "../storage/db.js";
import type { Message } from "../db/schema.js";

interface StoredMessage {
  text: string;
  timestamp: string; // ISO string for backward compatibility
  isFromUser: boolean; // true = user message, false = bot response
}

const DEFAULT_RECENT_COUNT = 10;
const DEFAULT_MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours — tides over a daily compaction window

function rowToStored(row: Message): StoredMessage {
  return {
    text: row.text,
    timestamp: row.ts.toISOString(),
    isFromUser: row.role === "user",
  };
}

/**
 * Add a message to the history.
 */
export async function addMessage(
  userId: string,
  role: "user" | "assistant",
  text: string,
  meta?: Record<string, unknown>
): Promise<void> {
  await getStorage().addMessage(userId, { role, text, meta });
}

/**
 * Format recent messages for inclusion in a prompt.
 */
export async function formatRecentMessagesForPrompt(
  userId: string,
  count = DEFAULT_RECENT_COUNT
): Promise<string> {
  const rows = await getStorage().getRecentMessages(userId, count);
  const messages = rows.map(rowToStored);

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

/**
 * Return every stored message since `sinceMs` (defaults to last 48h) — used
 * by the nightly compaction job to archive the day's transcript and generate
 * a summary.
 */
export async function getAllMessages(userId: string, sinceMs?: number): Promise<StoredMessage[]> {
  const cutoff = sinceMs ?? Date.now() - DEFAULT_MAX_AGE_MS;
  const rows = await getStorage().getMessagesSince(userId, cutoff);
  return rows.map(rowToStored);
}

/**
 * Render messages as a markdown transcript suitable for archiving to GitHub.
 * Pure function — no DB access.
 */
export function formatTranscript(messages: StoredMessage[]): string {
  return messages
    .map((msg) => {
      const role = msg.isFromUser ? "**User**" : "**Coach**";
      const ts = new Date(msg.timestamp).toISOString();
      return `### ${ts} — ${role}\n\n${msg.text}`;
    })
    .join("\n\n");
}

/**
 * Clear all stored messages for a user. Called after a successful compaction
 * so each day starts fresh.
 */
export async function clearMessages(userId: string): Promise<void> {
  await getStorage().clearMessages(userId);
}

export type { StoredMessage };
