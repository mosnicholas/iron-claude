/**
 * Telegram Webhook Handler
 *
 * Main entry point for all Telegram messages.
 */

import type { Request, Response } from "express";
import { createCoachAgent } from "../coach/index.js";
import {
  createTelegramBot,
  extractMessageText,
  extractVoiceMessage,
  isCommand,
  parseCommand,
  ThrottledMessageEditor,
} from "../bot/telegram.js";
import { executeCommand, commandExists } from "../bot/commands.js";
import { transcribeVoice, isVoiceTranscriptionAvailable } from "../bot/voice.js";
import { createGitHubStorage } from "../storage/github.js";
import { generatePlanWithContext } from "../cron/weekly-plan.js";
import { addMessage } from "../bot/message-history.js";
import type { TelegramUpdate } from "../storage/types.js";

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
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    console.log("[webhook] Secret check:", {
      hasSecretHeader: !!secretToken,
      hasExpectedSecret: !!expectedSecret,
      secretHeaderLength: secretToken?.length,
      expectedSecretLength: expectedSecret?.length,
    });

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

    // Process message asynchronously
    processMessage(update, bot).catch((error) => {
      console.error("[webhook] Background processing error:", error);
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
async function processMessage(update: TelegramUpdate, bot: ReturnType<typeof createTelegramBot>): Promise<void> {
  try {
    // Send typing indicator
    await bot.sendTypingAction();

    // Initialize agent
    const agent = createCoachAgent();

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

    // Handle commands
    if (isCommand(messageText)) {
      const { command, args } = parseCommand(messageText);

      if (commandExists(command)) {
        const response = await executeCommand(command, args, agent, bot);
        // Only send if response is non-empty (status messages handle their own output)
        if (response) {
          await bot.sendMessageSafe(response);
          // Record bot response in history
          addMessage(response, false);
        }
      } else {
        const unknownCmdResponse = `Unknown command /${command}. Try /help to see available commands.`;
        await bot.sendMessage(unknownCmdResponse);
        addMessage(unknownCmdResponse, false);
      }
      return;
    }

    // Check for pending planning state - if waiting for input, generate the plan
    const storage = createGitHubStorage();
    const planningState = await storage.getPlanningState();

    if (planningState) {
      console.log(`[webhook] Pending planning for ${planningState.week}, generating plan`);
      // Don't await - let it run in background so we can respond quickly
      generatePlanWithContext(planningState.week, messageText).catch((err) => {
        console.error("[webhook] Plan generation failed:", err);
      });
      return;
    }

    // Handle natural language - send to coach agent with status updates
    const messageId = await bot.sendMessage("✨ _Thinking..._", "MarkdownV2");

    if (messageId) {
      const editor = new ThrottledMessageEditor(bot, messageId);

      const response = await agent.chat(messageText, {
        onStatus: (status) => {
          console.log(`[webhook] Status update: ${status}`);
          editor.update(status);
        },
      });

      await editor.finalize(response.message);
      // Record bot response in history
      addMessage(response.message, false);
    } else {
      // Fallback if we couldn't get a message ID
      const response = await agent.chat(messageText);
      await bot.sendMessageSafe(response.message);
      // Record bot response in history
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
