/**
 * Telegram Webhook Handler
 *
 * Main entry point for all Telegram messages.
 */

import type { Request, Response } from "express";
import { createCoachAgentV2 } from "../coach-v2/index.js";
import {
  createTelegramBot,
  extractCaption,
  extractLargestPhoto,
  extractMessageText,
  extractVoiceMessage,
  isCommand,
  parseCommand,
  splitOnMessageBreaks,
  ThrottledMessageEditor,
} from "../bot/telegram.js";
import { executeCommand, commandExists } from "../bot/commands.js";
import { transcribeVoice, isVoiceTranscriptionAvailable } from "../bot/voice.js";
import { addMessage } from "../bot/message-history.js";
import type { ImageBlock } from "../coach-v2/llm-client.js";
import type { TelegramUpdate } from "../storage/types.js";

// Simple serial queue per chat — prevents concurrent writes to the same files
const messageQueues = new Map<number, Promise<void>>();

function enqueueMessage(chatId: number, fn: () => Promise<void>): void {
  const previous = messageQueues.get(chatId) || Promise.resolve();
  const current = previous.then(fn, fn).catch((err) => {
    console.error("[webhook] Message processing error:", err);
  });
  messageQueues.set(chatId, current);
  // Clean up resolved promises to prevent memory leak
  current.finally(() => {
    if (messageQueues.get(chatId) === current) {
      messageQueues.delete(chatId);
    }
  });
}

// Simple in-memory cache for deduplication
// Stores update_ids we've already processed
const processedUpdates = new Set<number>();
const MAX_CACHED_UPDATES = 1000;

function isDuplicateUpdate(updateId: number): boolean {
  if (processedUpdates.has(updateId)) {
    return true;
  }

  // Add to cache
  processedUpdates.add(updateId);

  // Prevent unbounded growth by clearing old entries
  if (processedUpdates.size > MAX_CACHED_UPDATES) {
    const toRemove = Array.from(processedUpdates).slice(0, 100);
    toRemove.forEach((id) => processedUpdates.delete(id));
  }

  return false;
}

export async function webhookHandler(req: Request, res: Response): Promise<void> {
  console.log("[webhook] Received request:", req.method);

  try {
    const bot = createTelegramBot();

    // Verify webhook secret if configured
    const secretToken = req.headers["x-telegram-bot-api-secret-token"] as string | null;

    if (!bot.verifyWebhook(secretToken)) {
      console.log("[webhook] Rejected: webhook secret mismatch");
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const update: TelegramUpdate = req.body;
    console.log("[webhook] Update received:", {
      updateId: update.update_id,
      hasMessage: !!update.message,
      chatId: update.message?.chat?.id,
      text: update.message?.text?.slice(0, 50),
    });

    // Check for duplicate updates (Telegram retries on slow responses)
    if (isDuplicateUpdate(update.update_id)) {
      console.log(`[webhook] Duplicate update_id ${update.update_id}, skipping`);
      res.status(200).json({ ok: true });
      return;
    }

    // Verify this is from the authorized chat
    const chatId = update.message?.chat.id;
    const authorizedChatId = process.env.TELEGRAM_CHAT_ID;
    console.log("[webhook] Chat auth:", {
      chatId,
      authorizedChatId,
      match: String(chatId) === authorizedChatId,
    });

    if (!chatId || !bot.isAuthorizedChat(chatId)) {
      // Silently ignore unauthorized messages
      console.log("[webhook] Rejected: unauthorized chat");
      res.status(200).json({ ok: true });
      return;
    }

    // Return 200 immediately to prevent Telegram retries
    // Process the message in the background
    res.status(200).json({ ok: true });

    // Process message asynchronously via per-chat serial queue
    enqueueMessage(chatId, async () => {
      await processMessage(update, bot);
    });
  } catch (error) {
    console.error("Webhook error:", error);
    // Still return 200 to prevent Telegram retries
    res.status(200).json({ ok: true, error: "Internal error" });
  }
}

/**
 * Process a Telegram message in the background
 * Called after we've already returned 200 to Telegram
 */
async function processMessage(
  update: TelegramUpdate,
  bot: ReturnType<typeof createTelegramBot>
): Promise<void> {
  try {
    // Send typing indicator
    await bot.sendTypingAction();

    const agent = createCoachAgentV2();

    // Extract message content (text, voice, or photo)
    const voice = extractVoiceMessage(update);
    const photo = extractLargestPhoto(update);
    let messageText: string | null = null;
    let images: ImageBlock[] | undefined;

    if (voice) {
      if (!isVoiceTranscriptionAvailable()) {
        await bot.sendMessage(
          "Voice messages aren't configured yet. Please type your message instead."
        );
        return;
      }

      try {
        messageText = await transcribeVoice(voice, bot);
        await bot.sendMessage(`Heard: "${messageText}"`);
      } catch {
        await bot.sendMessage(
          "Couldn't transcribe that voice message. Please try again or type it out."
        );
        return;
      }
    } else if (photo) {
      try {
        const image = await downloadPhotoAsImageBlock(photo.file_id, bot);
        images = [image];
        // Captions on photos arrive as `caption`, not `text`. If neither is
        // present, give the model a reasonable default prompt.
        messageText =
          extractCaption(update) ||
          extractMessageText(update) ||
          "[athlete shared a photo with no caption]";
      } catch (err) {
        console.error("[webhook] Failed to download photo:", err);
        await bot.sendMessage("Couldn't download that image. Try sending it again?");
        return;
      }
    } else {
      messageText = extractMessageText(update);
    }

    if (!messageText) {
      return;
    }

    // Record user message in history (note: image bytes aren't logged)
    addMessage(messageText, true);

    // Handle infrastructure commands (help / restart / reauth). /debug is a
    // command but we let it fall through to the v2 router which has its own
    // handler for it.
    if (isCommand(messageText) && !messageText.trim().startsWith("/debug")) {
      const { command, args } = parseCommand(messageText);

      if (commandExists(command)) {
        const response = await executeCommand(command, args, agent, bot);
        if (response) {
          await bot.sendMessageSafe(response);
          addMessage(response, false);
        }
        return;
      }
      // Unknown commands fall through to the agent as natural language
    }

    // Handle natural language — send to the coach with status updates
    const messageId = await bot.sendMessage("🧠 _Thinking..._", "MarkdownV2");

    if (messageId) {
      const editor = new ThrottledMessageEditor(bot, messageId);
      const response = await agent.chat(
        messageText,
        (status) => {
          console.log(`[webhook] Status update: ${status}`);
          editor.update(status);
        },
        (delta) => {
          editor.appendStreamDelta(delta);
        },
        (delta) => {
          editor.appendThinkingDelta(delta);
        },
        images
      );

      // Editor handles message-break splits and size-based rotation internally;
      // we just hand it the full response and it edits the current placeholder
      // (or sends additional messages if no streaming happened).
      await editor.finalize(response.message);

      addMessage(response.message, false);
    } else {
      // Fallback if we couldn't get a message ID
      const response = await agent.chat(messageText, undefined, undefined, undefined, images);
      const chunks = splitOnMessageBreaks(response.message);
      for (const chunk of chunks) {
        await bot.sendMessageSafe(chunk);
      }
      addMessage(response.message, false);
    }
  } catch (error) {
    console.error("[webhook] Processing error:", error);

    // Try to notify user of error
    try {
      await bot.sendMessage("Something went wrong processing your message. Please try again.");
    } catch {
      // Ignore notification failure
    }
  }
}

/**
 * Fetch a Telegram photo by file_id and return it as an Anthropic ImageBlock.
 * Telegram serves photos as JPEG; we sniff the URL extension and fall back to
 * jpeg if unsure. The Anthropic SDK accepts the `image` block uniformly across
 * jpeg/png/gif/webp.
 */
async function downloadPhotoAsImageBlock(
  fileId: string,
  bot: ReturnType<typeof createTelegramBot>
): Promise<ImageBlock> {
  const { filePath, fileUrl } = await bot.getFile(fileId);
  const buffer = await bot.downloadFile(fileUrl);
  const data = Buffer.from(buffer).toString("base64");
  const mediaType = inferImageMediaType(filePath);
  return {
    type: "image",
    source: { type: "base64", media_type: mediaType, data },
  };
}

function inferImageMediaType(
  filePath: string
): "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
  const ext = filePath.toLowerCase().split(".").pop();
  switch (ext) {
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    default:
      return "image/jpeg";
  }
}
