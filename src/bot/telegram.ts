/**
 * Telegram Bot Integration
 *
 * Handles communication with the Telegram Bot API.
 */

import type { TelegramUpdate, TelegramVoice } from "../storage/types.js";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const MAX_MESSAGE_LENGTH = 4000; // Telegram limit is 4096, leave some buffer

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
   * Get the bot token (for use by ThrottledMessageEditor)
   */
  getBotToken(): string {
    return this.config.botToken;
  }

  /**
   * Get the chat ID (for use by ThrottledMessageEditor)
   */
  getChatId(): string {
    return this.config.chatId;
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
   * Send a text message (formats text for MarkdownV2)
   * Returns the message ID if successful
   */
  async sendMessage(
    text: string,
    parseMode: "MarkdownV2" | "HTML" = "MarkdownV2"
  ): Promise<number | undefined> {
    const formatted = parseMode === "MarkdownV2" ? formatForTelegram(text) : text;
    return this.sendFormattedMessage(formatted, parseMode);
  }

  /**
   * Send a pre-formatted message (no additional formatting applied)
   * Returns the message ID if successful
   */
  async sendFormattedMessage(
    text: string,
    parseMode: "MarkdownV2" | "HTML" = "MarkdownV2"
  ): Promise<number | undefined> {
    const url = `${TELEGRAM_API_BASE}/bot${this.config.botToken}/sendMessage`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: this.config.chatId,
        text,
        parse_mode: parseMode,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Telegram API error: ${error}`);
    }

    const result = (await response.json()) as { result?: { message_id: number } };
    return result.result?.message_id;
  }

  /**
   * Send a message with retry (for long responses that may need splitting)
   * Formats first, then splits, to ensure length check is accurate
   */
  async sendMessageSafe(text: string): Promise<void> {
    // Format first, then check length
    const formatted = formatForTelegram(text);

    if (formatted.length <= MAX_MESSAGE_LENGTH) {
      try {
        await this.sendFormattedMessage(formatted);
      } catch {
        // If markdown fails, try plain text
        await this.sendPlainMessage(text);
      }
      return;
    }

    // Split the formatted text into chunks
    const chunks = splitMessage(formatted, MAX_MESSAGE_LENGTH);
    for (const chunk of chunks) {
      try {
        await this.sendFormattedMessage(chunk);
      } catch (error) {
        console.log(`[sendMessageSafe] MarkdownV2 failed, trying plain text:`, error);
        // For plain text fallback, we'd need the original unformatted chunk
        // but that's complex - just send the formatted chunk as plain text
        await this.sendPlainMessage(chunk);
      }
      // Small delay between messages
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * Send a plain text message (no formatting)
   * Returns the message ID if successful
   */
  async sendPlainMessage(text: string): Promise<number | undefined> {
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

    const result = (await response.json()) as { result?: { message_id: number } };
    return result.result?.message_id;
  }

  /**
   * Edit an existing message (formats text for MarkdownV2)
   */
  async editMessage(
    messageId: number,
    text: string,
    parseMode: "MarkdownV2" | "HTML" = "MarkdownV2"
  ): Promise<void> {
    const formatted = parseMode === "MarkdownV2" ? formatForTelegram(text) : text;
    return this.editFormattedMessage(messageId, formatted, parseMode);
  }

  /**
   * Edit an existing message with pre-formatted text (no additional formatting)
   */
  async editFormattedMessage(
    messageId: number,
    text: string,
    parseMode: "MarkdownV2" | "HTML" = "MarkdownV2"
  ): Promise<void> {
    const url = `${TELEGRAM_API_BASE}/bot${this.config.botToken}/editMessageText`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: this.config.chatId,
        message_id: messageId,
        text,
        parse_mode: parseMode,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Telegram edit failed: ${error}`);
    }
  }

  /**
   * Send a status message that will be updated when the operation completes
   * Returns functions to update or complete the message
   */
  async sendStatusMessage(initialText: string): Promise<{
    update: (text: string) => Promise<void>;
    complete: (text: string) => Promise<void>;
    fail: (text: string) => Promise<void>;
  }> {
    const messageId = await this.sendPlainMessage(initialText);

    return {
      update: async (text: string) => {
        if (messageId) await this.editMessage(messageId, text);
      },
      complete: async (text: string) => {
        if (messageId) await this.editMessage(messageId, text);
      },
      fail: async (text: string) => {
        if (messageId) await this.editMessage(messageId, `❌ ${text}`);
      },
    };
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
 * Format text for Telegram MarkdownV2
 * - Convert standard Markdown headings/bold/bullets to Telegram format
 * - Escape special characters that aren't part of formatting
 * - Convert markdown tables to lists (Telegram doesn't support tables)
 */
export function formatForTelegram(text: string): string {
  let formatted = text;

  // Convert headings to bold with visual indicators
  // Process in order: h3 first, then h2, then h1 (avoid double-matching)
  formatted = formatted
    .replace(/^### (.+)$/gm, "_$1_") // h3 → italic
    .replace(/^## (.+)$/gm, "*$1*") // h2 → bold
    .replace(/^# (.+)$/gm, "📌 *$1*"); // h1 → emoji + bold

  // Convert **bold** to *bold* (Telegram style)
  formatted = formatted.replace(/\*\*(.+?)\*\*/g, "*$1*");

  // Convert markdown bullets to Unicode bullets
  // Process nested bullets FIRST (they have leading spaces), then top-level
  formatted = formatted
    .replace(/^ {4}- /gm, "    ▪ ") // 4 spaces + hyphen → small square
    .replace(/^ {2}- /gm, "  ◦ ") // 2 spaces + hyphen → hollow circle
    .replace(/^- /gm, "• ") // top-level hyphen bullet
    .replace(/^ {4}\* /gm, "    ▪ ") // 4 spaces + asterisk
    .replace(/^ {2}\* /gm, "  ◦ ") // 2 spaces + asterisk
    .replace(/^\* (?!\*)/gm, "• "); // top-level asterisk bullet

  // Convert markdown tables to bullet lists
  formatted = convertTablesToLists(formatted);

  // MarkdownV2 requires escaping: _ * [ ] ( ) ~ ` > # + - = | { } . !
  // We want to preserve intentional formatting, so we escape characters
  // that commonly appear in text but aren't formatting

  // Escape special characters that are typically not formatting
  // Order matters - escape backslashes first
  formatted = formatted
    .replace(/\\/g, "\\\\")
    .replace(/\./g, "\\.")
    .replace(/!/g, "\\!")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\+/g, "\\+")
    .replace(/=/g, "\\=")
    .replace(/>/g, "\\>")
    .replace(/#/g, "\\#")
    .replace(/\|/g, "\\|");

  // Escape all hyphens (bullet markers are already converted to Unicode)
  formatted = formatted.replace(/-/g, "\\-");

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

/**
 * Throttled message editor for streaming status updates
 *
 * Handles rate limiting by queuing updates and only sending the latest
 * state when the throttle window expires. Telegram allows ~30 edits/min.
 */
export class ThrottledMessageEditor {
  private bot: TelegramBot;
  private messageId: number;
  private throttleMs: number;
  private lastEditTime = 0;
  private pendingText: string | null = null;
  private pendingTimeout: ReturnType<typeof setTimeout> | null = null;
  private dotCount = 1;

  constructor(bot: TelegramBot, messageId: number, throttleMs = 2000) {
    this.bot = bot;
    this.messageId = messageId;
    this.throttleMs = throttleMs;
  }

  /**
   * Queue a status update. Respects rate limits.
   * Status messages are formatted with sparkle emoji and italics.
   */
  update(text: string): void {
    // Add animated dots
    const dots = ".".repeat(this.dotCount);
    this.dotCount = (this.dotCount % 3) + 1;
    const baseText = text.replace(/\.{3}$/, dots);

    // Escape special chars for MarkdownV2
    const escaped = formatForTelegram(baseText);

    // Format as: ✨ _status message_
    const formattedText = `✨ _${escaped}_`;

    const now = Date.now();
    const timeSinceLastEdit = now - this.lastEditTime;

    if (timeSinceLastEdit >= this.throttleMs) {
      // Can edit immediately
      this.lastEditTime = now;
      this.editMarkdown(formattedText);
    } else {
      // Queue for later
      this.pendingText = formattedText;

      if (!this.pendingTimeout) {
        const waitTime = this.throttleMs - timeSinceLastEdit;
        this.pendingTimeout = setTimeout(() => {
          this.pendingTimeout = null;
          if (this.pendingText) {
            this.lastEditTime = Date.now();
            this.editMarkdown(this.pendingText);
            this.pendingText = null;
          }
        }, waitTime);
      }
    }
  }

  /**
   * Final edit with no throttling. Clears any pending updates.
   * Falls back to plain text if markdown formatting fails.
   * If message is too long, sends as new message instead of edit.
   */
  async finalize(text: string): Promise<void> {
    // Clear any pending updates
    if (this.pendingTimeout) {
      clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }
    this.pendingText = null;

    // If message is too long for edit, send as new message
    if (text.length > 4000) {
      console.log(`[ThrottledEditor] Message too long (${text.length}), sending as new message`);
      await this.bot.sendMessageSafe(text);
      return;
    }

    // Try MarkdownV2 first, fall back to plain text
    try {
      await this.bot.editMessage(this.messageId, text);
    } catch (error) {
      console.log(`[ThrottledEditor] MarkdownV2 failed, trying plain text:`, error);
      await this.editPlain(text);
    }
  }

  /**
   * Edit message as plain text (no formatting)
   */
  private async editPlain(text: string): Promise<void> {
    const url = `https://api.telegram.org/bot${this.bot.getBotToken()}/editMessageText`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: this.bot.getChatId(),
        message_id: this.messageId,
        text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[ThrottledEditor] Plain text edit failed:`, error);
    }
  }

  /**
   * Edit message with Markdown formatting (for status updates)
   */
  private async editMarkdown(text: string): Promise<void> {
    const url = `https://api.telegram.org/bot${this.bot.getBotToken()}/editMessageText`;

    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: this.bot.getChatId(),
        message_id: this.messageId,
        text,
        parse_mode: "MarkdownV2",
      }),
    }).catch(() => {
      // Silently fail - original message still shows
    });
  }
}
