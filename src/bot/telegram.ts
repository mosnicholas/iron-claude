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
   * Splits on --- message break markers first, then formats and length-splits each chunk.
   */
  async sendMessageSafe(text: string): Promise<void> {
    // Split on --- markers BEFORE formatting (formatting escapes the dashes)
    const messageChunks = splitOnMessageBreaks(text);

    for (let i = 0; i < messageChunks.length; i++) {
      await this.sendSingleChunkSafe(messageChunks[i]);

      // Small delay between message-break chunks
      if (i < messageChunks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  }

  /**
   * Send a single chunk (no --- markers) with formatting and length splitting.
   */
  private async sendSingleChunkSafe(text: string): Promise<void> {
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

    // Split the formatted text into length-based chunks
    const chunks = splitMessage(formatted, MAX_MESSAGE_LENGTH);
    for (const chunk of chunks) {
      try {
        await this.sendFormattedMessage(chunk);
      } catch (error) {
        console.log(`[sendMessageSafe] MarkdownV2 failed, trying plain text:`, error);
        await this.sendPlainMessage(chunk);
      }
      // Small delay between length-split chunks
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

  // Handle tildes: preserve valid strikethrough (~text~), escape lone tildes
  // Use placeholder to protect valid pairs, then escape remaining, then restore
  const STRIKE_PLACEHOLDER = "\x00STRIKE\x00";
  formatted = formatted.replace(/~([^~\n]+)~/g, `${STRIKE_PLACEHOLDER}$1${STRIKE_PLACEHOLDER}`);
  formatted = formatted.replace(/~/g, "\\~");
  formatted = formatted.replace(new RegExp(STRIKE_PLACEHOLDER, "g"), "~");

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
 * Split message on --- markers for multi-message responses.
 * Trims whitespace and filters empty chunks.
 */
export function splitOnMessageBreaks(text: string): string[] {
  return text
    .split(/\n---\n/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);
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
/**
 * Telegram's hard cap is 4096 characters per message. We start looking for a
 * clean break point in the streamed text once we exceed SOFT_STREAM_CAP, and
 * force a split (at the latest whitespace we can find) once we exceed
 * HARD_STREAM_CAP. The 200-char gap below 4096 leaves headroom for
 * platform-side counting differences.
 */
const SOFT_STREAM_CAP = 3000;
const HARD_STREAM_CAP = 3900;
const MESSAGE_BREAK = "\n---\n";

/**
 * Find the latest "clean" break point in `text` for splitting a streamed
 * message into multiple Telegram messages. Returns the index where the next
 * segment begins, or -1 if no acceptable break exists.
 *
 * Preference order: paragraph (\n\n) > sentence end > line break > word.
 * We only consider breaks within the last `lookbackChars` of the text so we
 * split as late as possible (and don't carry a tiny leftover into the next
 * message).
 */
function findCleanBreakIndex(text: string, lookbackChars = 1500): number {
  const minIdx = Math.max(0, text.length - lookbackChars);

  const paragraph = text.lastIndexOf("\n\n");
  if (paragraph >= minIdx) return paragraph + 2;

  // Sentence end followed by space (rough heuristic).
  for (const sep of [". ", "? ", "! "]) {
    const idx = text.lastIndexOf(sep);
    if (idx >= minIdx) return idx + sep.length;
  }

  const newline = text.lastIndexOf("\n");
  if (newline >= minIdx) return newline + 1;

  return -1;
}

export class ThrottledMessageEditor {
  private bot: TelegramBot;
  private messageId: number;
  private throttleMs: number;
  private lastEditTime = 0;
  private pendingText: string | null = null;
  private pendingTimeout: ReturnType<typeof setTimeout> | null = null;
  private dotCount = 1;
  /** Accumulates streamed assistant text for the *current* segment only. */
  private streamBuffer = "";
  private streamPending = false;
  private streamTimeout: ReturnType<typeof setTimeout> | null = null;
  /** True while a rotation (finalize current + send new placeholder) is in flight. */
  private rotating = false;
  /** Set if we couldn't get a new placeholder; suppresses further streaming edits. */
  private streamSuppressed = false;
  /** Number of fully-finalized message segments (incremented on each rotation). */
  private completedSegments = 0;
  /**
   * What the current placeholder is showing. Used to decide whether to rotate
   * (lock in the placeholder as a permanent message) when transitioning between
   * status updates ("🧠 _Using readFile..._") and streamed assistant text.
   */
  private placeholderMode: "status" | "stream" = "status";
  /** Latest formatted status text shown in the placeholder (markdown). */
  private currentStatusFormatted: string | null = "🧠 _Thinking..._";
  /**
   * Accumulated reasoning/thinking text from the model's extended-thinking
   * stream. Re-rendered into the placeholder as deltas arrive, then locked in
   * (alongside the brain emoji + italics) when we transition to reply text.
   */
  private thinkingBuffer = "";

  constructor(bot: TelegramBot, messageId: number, throttleMs = 2000) {
    this.bot = bot;
    this.messageId = messageId;
    this.throttleMs = throttleMs;
  }

  /**
   * Queue a status update. Respects rate limits.
   * Status messages are formatted with a brain emoji and italics so they're
   * visually distinct from the assistant's reply text.
   *
   * If streamed assistant text is currently in the placeholder, locks that
   * stream in as its own message before showing the new status — so the user
   * keeps seeing each completed reply chunk after streaming finishes.
   */
  update(text: string): void {
    // Add animated dots
    const dots = ".".repeat(this.dotCount);
    this.dotCount = (this.dotCount % 3) + 1;
    const baseText = text.replace(/\.{3}$/, dots);

    // Escape special chars for MarkdownV2
    const escaped = formatForTelegram(baseText);

    // Format as: 🧠 _status message_
    const formattedText = `🧠 _${escaped}_`;

    const hadThinking = this.thinkingBuffer.trim().length > 0;
    const hadStream = this.placeholderMode === "stream" && this.streamBuffer.trim().length > 0;

    // The new status replaces any in-flight thinking — but we still want to
    // lock in the thinking content (below) before clearing the buffer.
    if (hadStream) {
      this.thinkingBuffer = "";
      void this.rotateStreamForStatus(formattedText);
      return;
    }
    if (hadThinking) {
      void this.rotateThinkingForStatus(formattedText);
      return;
    }

    this.currentStatusFormatted = formattedText;
    this.placeholderMode = "status";
    this.scheduleStatusEdit(formattedText);
  }

  private scheduleStatusEdit(formattedText: string): void {
    const now = Date.now();
    const timeSinceLastEdit = now - this.lastEditTime;

    if (timeSinceLastEdit >= this.throttleMs) {
      this.lastEditTime = now;
      this.editMarkdown(formattedText);
    } else {
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
   * Append a streamed assistant text delta. Detects message-break markers
   * (`\n---\n`) and size thresholds; rotates to a new Telegram message at
   * those boundaries so we never overflow the per-message limit.
   */
  appendStreamDelta(delta: string): void {
    if (!delta || this.streamSuppressed) return;
    this.streamBuffer += delta;

    // First delta after a status update — keep the brain-prefixed status
    // visible by locking it in and creating a fresh placeholder for the reply.
    if (this.placeholderMode === "status") {
      this.thinkingBuffer = "";
      void this.rotateStatusForStream();
      return;
    }

    this.maybeRotateOrEdit();
  }

  /**
   * Append a streamed thinking/reasoning delta. Renders the accumulated
   * thinking buffer with the same brain-emoji italic treatment as a status
   * update, so the model's reasoning shows up as its own visually distinct
   * block and survives in chat after the reply finishes streaming.
   */
  appendThinkingDelta(delta: string): void {
    if (!delta) return;

    const isFirstDelta = this.thinkingBuffer.length === 0;
    this.thinkingBuffer += delta;

    const escaped = formatForTelegram(this.thinkingBuffer);
    const formattedText = `🧠 _${escaped}_`;
    this.currentStatusFormatted = formattedText;

    if (isFirstDelta) {
      // First delta of a new thinking session — preserve whatever the
      // placeholder currently shows (a partial reply or a tool-use status)
      // instead of overwriting it with the reasoning text.
      if (this.placeholderMode === "stream" && this.streamBuffer.trim().length > 0) {
        void this.rotateStreamForStatus(formattedText);
        return;
      }
      if (this.placeholderMode === "status" && this.completedSegments > 0) {
        void this.rotateStatusForThinking(formattedText);
        return;
      }
    }

    this.placeholderMode = "status";
    this.scheduleStatusEdit(formattedText);
  }

  private maybeRotateOrEdit(): void {
    if (this.rotating || this.streamSuppressed) return;

    // 1. Explicit message break (matches splitOnMessageBreaks).
    const breakIdx = this.streamBuffer.indexOf(MESSAGE_BREAK);
    if (breakIdx !== -1) {
      const before = this.streamBuffer.slice(0, breakIdx);
      const after = this.streamBuffer.slice(breakIdx + MESSAGE_BREAK.length);
      this.streamBuffer = after;
      void this.rotate(before);
      return;
    }

    // 2. Size-based split: find a clean break once we cross the soft cap.
    if (this.streamBuffer.length >= SOFT_STREAM_CAP) {
      const splitIdx = findCleanBreakIndex(this.streamBuffer);
      if (splitIdx !== -1) {
        const before = this.streamBuffer.slice(0, splitIdx);
        const after = this.streamBuffer.slice(splitIdx);
        this.streamBuffer = after;
        void this.rotate(before);
        return;
      }
      // 3. No clean break and we're past the hard cap — split at last space.
      if (this.streamBuffer.length >= HARD_STREAM_CAP) {
        const lastSpace = this.streamBuffer.lastIndexOf(" ");
        const splitAt = lastSpace > 0 ? lastSpace : HARD_STREAM_CAP;
        const before = this.streamBuffer.slice(0, splitAt);
        const after = this.streamBuffer.slice(splitAt + (lastSpace > 0 ? 1 : 0));
        this.streamBuffer = after;
        void this.rotate(before);
        return;
      }
    }

    // No rotation needed — schedule a debounced edit of the current message.
    this.scheduleStreamEdit();
  }

  private scheduleStreamEdit(): void {
    // Streamed text takes priority over any pending status edit.
    this.pendingText = null;
    if (this.pendingTimeout) {
      clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }

    const now = Date.now();
    const timeSinceLastEdit = now - this.lastEditTime;

    if (timeSinceLastEdit >= this.throttleMs) {
      this.lastEditTime = now;
      void this.editPlainSafe(this.streamBuffer);
    } else if (!this.streamTimeout) {
      const waitTime = this.throttleMs - timeSinceLastEdit;
      this.streamTimeout = setTimeout(() => {
        this.streamTimeout = null;
        this.lastEditTime = Date.now();
        void this.editPlainSafe(this.streamBuffer);
      }, waitTime);
    }
  }

  /**
   * Finalize the current message (with markdown) and start a fresh placeholder
   * for the next segment. Caller is responsible for setting `streamBuffer` to
   * the post-break content *before* invoking this.
   */
  private async rotate(beforeText: string): Promise<void> {
    this.rotating = true;
    if (this.streamTimeout) {
      clearTimeout(this.streamTimeout);
      this.streamTimeout = null;
    }
    try {
      await this.writeFinalToCurrent(beforeText.trim());
      const newId = await this.bot.sendMessage("🧠 _Continuing..._", "MarkdownV2");
      if (newId) {
        this.messageId = newId;
        this.lastEditTime = 0;
        this.completedSegments += 1;
      } else {
        // Couldn't open a new placeholder — give up on streaming the rest.
        // finalize() will send the remainder as a new message.
        this.streamSuppressed = true;
      }
    } finally {
      this.rotating = false;
    }
    if (!this.streamSuppressed && this.streamBuffer.length > 0) {
      // More content already arrived (or another break is buffered) — re-check.
      this.maybeRotateOrEdit();
    }
  }

  /**
   * Lock in the current status placeholder (already shows "🧠 _status_") and
   * open a fresh placeholder for the streamed reply. Called on the first delta
   * after a status update, so the brain-prefixed status survives in chat.
   */
  private async rotateStatusForStream(): Promise<void> {
    await this.rotateAfterStatus({
      newPlaceholder: "🧠 _Continuing..._",
      newMode: "stream",
    });
    if (!this.streamSuppressed && this.streamBuffer.length > 0) {
      this.maybeRotateOrEdit();
    }
  }

  /**
   * Lock in the current status placeholder and open a fresh placeholder
   * showing the new (streaming) thinking block. Called on the first thinking
   * delta after a status update — preserves the prior status (e.g. "Using
   * readFile…") instead of overwriting it with the model's reasoning.
   */
  private async rotateStatusForThinking(formattedThinking: string): Promise<void> {
    await this.rotateAfterStatus({
      newPlaceholder: formattedThinking,
      newMode: "status",
    });
  }

  private async rotateAfterStatus(opts: {
    newPlaceholder: string;
    newMode: "stream" | "status";
  }): Promise<void> {
    if (this.rotating || this.streamSuppressed) return;
    this.rotating = true;
    try {
      // Cancel any debounced status edit and apply it synchronously so the
      // locked-in message reflects the latest status text, not a stale one.
      if (this.pendingTimeout) {
        clearTimeout(this.pendingTimeout);
        this.pendingTimeout = null;
      }
      const finalStatus = this.pendingText ?? this.currentStatusFormatted;
      this.pendingText = null;
      if (finalStatus) {
        try {
          await this.bot.editMessage(this.messageId, finalStatus);
        } catch {
          // The placeholder already shows a recent version of the status; an
          // edit failure here just means we keep what's already there.
        }
      }
      this.completedSegments += 1;

      const newId = await this.bot.sendMessage(opts.newPlaceholder, "MarkdownV2");
      if (newId) {
        this.messageId = newId;
        this.lastEditTime = opts.newMode === "stream" ? 0 : Date.now();
        this.placeholderMode = opts.newMode;
        if (opts.newMode === "status") {
          this.currentStatusFormatted = opts.newPlaceholder;
        }
      } else if (opts.newMode === "stream") {
        this.streamSuppressed = true;
      } else {
        // Couldn't open a new placeholder — fall back to in-place edits.
        this.placeholderMode = "status";
        this.currentStatusFormatted = opts.newPlaceholder;
        this.scheduleStatusEdit(opts.newPlaceholder);
      }
    } finally {
      this.rotating = false;
    }
  }

  /**
   * Lock in the brain-prefixed reasoning block currently shown in the
   * placeholder and open a fresh placeholder for the incoming status update.
   * Called when a tool-use status fires after extended-thinking deltas — so
   * the reasoning survives in chat instead of being overwritten by the
   * shorter status line.
   */
  private async rotateThinkingForStatus(formattedStatus: string): Promise<void> {
    if (this.rotating || this.streamSuppressed) return;
    this.rotating = true;
    try {
      // Force the latest thinking render into the placeholder synchronously
      // so the locked-in message reflects everything we received.
      if (this.pendingTimeout) {
        clearTimeout(this.pendingTimeout);
        this.pendingTimeout = null;
      }
      const finalThinking = this.pendingText ?? this.currentStatusFormatted;
      this.pendingText = null;
      if (finalThinking) {
        try {
          await this.bot.editMessage(this.messageId, finalThinking);
        } catch {
          // Best-effort — placeholder already shows a recent thinking render.
        }
      }
      this.thinkingBuffer = "";
      this.completedSegments += 1;

      const newId = await this.bot.sendMessage(formattedStatus, "MarkdownV2");
      if (newId) {
        this.messageId = newId;
        this.lastEditTime = Date.now();
        this.placeholderMode = "status";
        this.currentStatusFormatted = formattedStatus;
      } else {
        // No new placeholder — fall back to in-place edits on the old one.
        this.placeholderMode = "status";
        this.currentStatusFormatted = formattedStatus;
        this.scheduleStatusEdit(formattedStatus);
      }
    } finally {
      this.rotating = false;
    }
  }

  /**
   * Lock in the current streamed reply as its own message and open a fresh
   * placeholder showing the new status. Called when a status update fires
   * after the model streamed text — keeps the streamed reply visible.
   */
  private async rotateStreamForStatus(formattedStatus: string): Promise<void> {
    if (this.rotating || this.streamSuppressed) return;
    this.rotating = true;
    if (this.streamTimeout) {
      clearTimeout(this.streamTimeout);
      this.streamTimeout = null;
    }
    try {
      const streamed = this.streamBuffer.trim();
      this.streamBuffer = "";
      await this.writeFinalToCurrent(streamed);
      this.completedSegments += 1;

      const newId = await this.bot.sendMessage(formattedStatus, "MarkdownV2");
      if (newId) {
        this.messageId = newId;
        this.lastEditTime = Date.now();
        this.placeholderMode = "status";
      } else {
        // No new placeholder — fall back to in-place edits on the old one.
        this.placeholderMode = "status";
        this.scheduleStatusEdit(formattedStatus);
      }
    } finally {
      this.rotating = false;
    }
  }

  private resetStream(): void {
    this.streamBuffer = "";
    this.streamSuppressed = false;
    if (this.streamTimeout) {
      clearTimeout(this.streamTimeout);
      this.streamTimeout = null;
    }
    this.streamPending = false;
  }

  private async editPlainSafe(text: string): Promise<void> {
    if (this.streamPending || this.streamSuppressed) return;
    if (!text || !text.trim()) return;
    this.streamPending = true;
    try {
      await this.editPlain(text);
    } finally {
      this.streamPending = false;
    }
  }

  /**
   * Final edit (with markdown) of the current placeholder message.
   * Falls back to plain text if markdown parsing fails.
   * Sends as a new message if `text` exceeds Telegram's per-message limit.
   */
  private async writeFinalToCurrent(text: string): Promise<void> {
    if (!text || !text.trim()) {
      // Empty segment is awkward but Telegram rejects empty edits — replace
      // with a hairline so the message isn't stuck on "🧠 ...".
      text = "—";
    }
    if (text.length > 4000) {
      console.log(`[ThrottledEditor] Segment too long (${text.length}), sending as new message`);
      await this.bot.sendMessageSafe(text);
      return;
    }
    try {
      await this.bot.editMessage(this.messageId, text);
    } catch (error) {
      console.log(`[ThrottledEditor] MarkdownV2 failed, trying plain text:`, error);
      await this.editPlain(text);
    }
  }

  /**
   * Finalize the response. Trusts the streamed buffer when streaming happened;
   * otherwise falls back to splitting `fullText` on `---` markers.
   *
   * After eager rotation during streaming, the current placeholder corresponds
   * to the last segment — `streamBuffer` already holds its content.
   */
  async finalize(fullText: string): Promise<void> {
    if (this.pendingTimeout) {
      clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }
    this.pendingText = null;
    if (this.streamTimeout) {
      clearTimeout(this.streamTimeout);
      this.streamTimeout = null;
    }

    const streamed = this.streamBuffer.trim();
    const rotatedDuringStream = this.completedSegments > 0;

    if (this.streamSuppressed) {
      // Streaming gave up partway. Send the remaining buffer as a new message.
      if (streamed) {
        await this.bot.sendMessageSafe(streamed);
      }
      this.resetStream();
      return;
    }

    if (rotatedDuringStream || streamed) {
      if (this.placeholderMode === "status" && !streamed) {
        // Last activity was a status update with no streamed text after it.
        // Leave the brain-prefixed status alone — overwriting it with "—"
        // would erase the thinking trail the user wants to keep.
        this.resetStream();
        return;
      }
      // Streaming path: trust the stream. Edit the current (last) placeholder.
      await this.writeFinalToCurrent(streamed);
      this.resetStream();
      return;
    }

    // No streaming happened — fall back to the existing split behavior.
    this.resetStream();
    const chunks = splitOnMessageBreaks(fullText);
    if (this.placeholderMode === "status") {
      // Preserve the brain-prefixed status by sending the reply as new messages.
      const segments = chunks.length > 0 ? chunks : [fullText];
      for (const segment of segments) {
        if (segment.trim()) {
          await this.bot.sendMessageSafe(segment);
        }
      }
      return;
    }
    if (chunks.length === 0) {
      await this.writeFinalToCurrent(fullText);
      return;
    }
    await this.writeFinalToCurrent(chunks[0]);
    for (let i = 1; i < chunks.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      await this.bot.sendMessageSafe(chunks[i]);
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
