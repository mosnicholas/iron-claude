/**
 * Telegram Webhook Handler
 *
 * Main entry point for all Telegram messages.
 */

import { existsSync } from "fs";
import { join } from "path";
import type { Request, Response } from "express";
import { createCoachAgent } from "../coach/index.js";
import { PLAN_GENERATION_INSTRUCTIONS } from "../coach/prompts.js";
import { createCoachAgentV2, isV2Enabled } from "../coach-v2/index.js";
import {
  createTelegramBot,
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
import { REPO_DIR } from "../storage/repo-sync.js";
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

    // Initialize agent — v2 when COACH_HARNESS=v2, v1 otherwise.
    const useV2 = isV2Enabled();
    const agent = useV2 ? null : createCoachAgent();
    const agentV2 = useV2 ? createCoachAgentV2() : null;

    // Extract message content (text or voice)
    const voice = extractVoiceMessage(update);
    let messageText: string | null = null;

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
    } else {
      messageText = extractMessageText(update);
    }

    if (!messageText) {
      return;
    }

    // Record user message in history
    addMessage(messageText, true);

    // Handle commands. v1 commands keep working; v2 doesn't expose them yet
    // (it routes by message text), so commands continue to use the v1 agent.
    if (isCommand(messageText) && !messageText.trim().startsWith("/debug")) {
      const { command, args } = parseCommand(messageText);

      if (commandExists(command)) {
        // Commands always use v1 agent for now; the v2 router only handles
        // free-text + /debug.
        const v1Agent = agent ?? createCoachAgent();
        const response = await executeCommand(command, args, v1Agent, bot);
        // Only send if response is non-empty (status messages handle their own output)
        if (response) {
          await bot.sendMessageSafe(response);
          // Record bot response in history
          addMessage(response, false);
        }
        return;
      }
      // Unknown commands fall through to the agent as natural language
    }

    // Check for pending planning state — route with plan generation instructions
    const planningPending = existsSync(join(REPO_DIR, "state", "planning-pending.md"));

    // Handle natural language - send to coach agent with status updates
    const messageId = await bot.sendMessage("✨ _Thinking..._", "MarkdownV2");

    const callV1 = async (statusCb?: (s: string) => void) =>
      planningPending
        ? agent!.runTask(messageText, PLAN_GENERATION_INSTRUCTIONS)
        : agent!.chat(messageText, statusCb ? { onStatus: statusCb } : undefined);

    const callV2 = async (statusCb?: (s: string) => void) => agentV2!.chat(messageText, statusCb);

    if (messageId) {
      const editor = new ThrottledMessageEditor(bot, messageId);
      const onStatus = (status: string) => {
        console.log(`[webhook] Status update: ${status}`);
        editor.update(status);
      };
      const response = useV2 ? await callV2(onStatus) : await callV1(onStatus);

      // Split on --- markers for multi-message responses
      const chunks = splitOnMessageBreaks(response.message);
      await editor.finalize(chunks[0]);

      for (let i = 1; i < chunks.length; i++) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        await bot.sendMessageSafe(chunks[i]);
      }

      // Record bot response in history
      addMessage(response.message, false);
    } else {
      // Fallback if we couldn't get a message ID
      const response = useV2 ? await callV2() : await callV1();

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
