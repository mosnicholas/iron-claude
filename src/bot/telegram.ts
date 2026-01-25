/**
 * Telegram Bot Integration
 *
 * Handles communication with the Telegram Bot API.
 */

import type { TelegramUpdate, TelegramVoice } from "../storage/types.js";

const TELEGRAM_API_BASE = "https://api.telegram.org";

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  webhookSecret?: string;
}

export class TelegramBot {
  private config: TelegramConfig;

  constructor(config: TelegramConfig) {
    this.config = config;
  }

  /**
   * Verify that a request is from the authorized chat
   */
  isAuthorizedChat(chatId: number): boolean {
    return chatId.toString() === this.config.chatId;
  }

  /**
   * Verify webhook signature (if configured)
   */
  verifyWebhook(secretToken: string | null): boolean {
    if (!this.config.webhookSecret) {
      return true; // No verification configured
    }
    return secretToken === this.config.webhookSecret;
  }

  /**
   * Send a text message
   */
  async sendMessage(text: string, parseMode: "Markdown" | "HTML" = "Markdown"): Promise<void> {
    const url = `${TELEGRAM_API_BASE}/bot${this.config.botToken}/sendMessage`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: this.config.chatId,
        text: formatForTelegram(text),
        parse_mode: parseMode,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Telegram API error: ${error}`);
    }
  }

  /**
   * Send a message with retry (for long responses that may need splitting)
   */
  async sendMessageSafe(text: string): Promise<void> {
    const maxLength = 4000; // Telegram limit is 4096, leave some buffer

    if (text.length <= maxLength) {
      try {
        await this.sendMessage(text);
      } catch {
        // If markdown fails, try plain text
        await this.sendPlainMessage(text);
      }
      return;
    }

    // Split into chunks
    const chunks = splitMessage(text, maxLength);
    for (const chunk of chunks) {
      try {
        await this.sendMessage(chunk);
      } catch {
        await this.sendPlainMessage(chunk);
      }
      // Small delay between messages
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * Send a plain text message (no formatting)
   */
  async sendPlainMessage(text: string): Promise<void> {
    const url = `${TELEGRAM_API_BASE}/bot${this.config.botToken}/sendMessage`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: this.config.chatId,
        text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Telegram API error: ${error}`);
    }
  }

  /**
   * Send a typing indicator
   */
  async sendTypingAction(): Promise<void> {
    const url = `${TELEGRAM_API_BASE}/bot${this.config.botToken}/sendChatAction`;

    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: this.config.chatId,
        action: "typing",
      }),
    });
  }

  /**
   * Get a file from Telegram (for voice messages)
   */
  async getFile(fileId: string): Promise<{ filePath: string; fileUrl: string }> {
    const url = `${TELEGRAM_API_BASE}/bot${this.config.botToken}/getFile`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: fileId }),
    });

    if (!response.ok) {
      throw new Error("Failed to get file info");
    }

    const data = (await response.json()) as { result: { file_path: string } };
    const filePath = data.result.file_path;
    const fileUrl = `${TELEGRAM_API_BASE}/file/bot${this.config.botToken}/${filePath}`;

    return { filePath, fileUrl };
  }

  /**
   * Download a file
   */
  async downloadFile(fileUrl: string): Promise<ArrayBuffer> {
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error("Failed to download file");
    }
    return response.arrayBuffer();
  }

  /**
   * Set the webhook URL
   */
  async setWebhook(webhookUrl: string): Promise<void> {
    const url = `${TELEGRAM_API_BASE}/bot${this.config.botToken}/setWebhook`;

    const body: Record<string, unknown> = { url: webhookUrl };

    if (this.config.webhookSecret) {
      body.secret_token = this.config.webhookSecret;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to set webhook: ${error}`);
    }
  }

  /**
   * Delete the webhook
   */
  async deleteWebhook(): Promise<void> {
    const url = `${TELEGRAM_API_BASE}/bot${this.config.botToken}/deleteWebhook`;

    const response = await fetch(url, { method: "POST" });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to delete webhook: ${error}`);
    }
  }
}

/**
 * Format text for Telegram Markdown
 * - Escape special characters
 * - Convert markdown tables to lists (Telegram doesn't support tables)
 */
export function formatForTelegram(text: string): string {
  // Convert markdown tables to bullet lists
  let formatted = convertTablesToLists(text);

  // Telegram Markdown requires escaping these in certain contexts
  // But we want to keep basic formatting working
  // For now, just clean up any problematic patterns

  // Fix unmatched asterisks that aren't meant for formatting
  formatted = formatted.replace(/\*([^*\n]+)\n/g, "• $1\n");

  return formatted;
}

/**
 * Convert markdown tables to bullet lists for Telegram
 */
function convertTablesToLists(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let inTable = false;
  let headers: string[] = [];

  for (const line of lines) {
    const isTableRow = line.match(/^\|.*\|$/);

    if (!isTableRow) {
      if (inTable) {
        inTable = false;
        headers = [];
      }
      result.push(line);
      continue;
    }

    // Skip separator rows (|---|---|)
    if (line.match(/^\|[\s-:|]+\|$/)) {
      continue;
    }

    const cells = line
      .split("|")
      .filter((cell) => cell.trim())
      .map((cell) => cell.trim());

    // First table row becomes headers
    if (!inTable) {
      inTable = true;
      headers = cells;
      continue;
    }

    // Data rows become bullet points
    if (cells.length > 0) {
      const formattedCells = cells
        .map((cell, i) => (headers[i] ? `${headers[i]}: ${cell}` : cell))
        .filter((s) => s && !s.includes(": —"));

      if (formattedCells.length > 0) {
        result.push(`• ${formattedCells.join(" | ")}`);
      }
    }
  }

  return result.join("\n");
}

/**
 * Split a message into chunks while trying to preserve formatting
 */
function splitMessage(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split("\n\n");
  let currentChunk = "";

  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length + 2 <= maxLength) {
      currentChunk += (currentChunk ? "\n\n" : "") + paragraph;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk);
      }
      // If a single paragraph is too long, split it
      if (paragraph.length > maxLength) {
        const lines = paragraph.split("\n");
        currentChunk = "";
        for (const line of lines) {
          if (currentChunk.length + line.length + 1 <= maxLength) {
            currentChunk += (currentChunk ? "\n" : "") + line;
          } else {
            if (currentChunk) {
              chunks.push(currentChunk);
            }
            currentChunk = line.slice(0, maxLength);
          }
        }
      } else {
        currentChunk = paragraph;
      }
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * Extract text content from a Telegram update
 */
export function extractMessageText(update: TelegramUpdate): string | null {
  return update.message?.text || null;
}

/**
 * Extract voice message from a Telegram update
 */
export function extractVoiceMessage(update: TelegramUpdate): TelegramVoice | null {
  return update.message?.voice || null;
}

/**
 * Check if a message is a command
 */
export function isCommand(text: string): boolean {
  return text.startsWith("/");
}

/**
 * Parse a command and its arguments
 */
export function parseCommand(text: string): { command: string; args: string } {
  const match = text.match(/^\/(\w+)(?:\s+(.*))?$/);
  if (!match) {
    return { command: "", args: "" };
  }

  const [, commandPart, argsPart] = match;
  return {
    command: commandPart.toLowerCase(),
    args: argsPart?.trim() || "",
  };
}

/**
 * Create a TelegramBot instance from environment variables
 */
export function createTelegramBot(): TelegramBot {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!botToken || !chatId) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
  }

  return new TelegramBot({ botToken, chatId, webhookSecret });
}
