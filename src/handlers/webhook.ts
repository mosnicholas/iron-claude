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
} from "../bot/telegram.js";
import { executeCommand, commandExists } from "../bot/commands.js";
import { transcribeVoice, isVoiceTranscriptionAvailable } from "../bot/voice.js";
import type { TelegramUpdate } from "../storage/types.js";

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
      hasMessage: !!update.message,
      chatId: update.message?.chat?.id,
      text: update.message?.text?.slice(0, 50),
    });

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
        res.status(200).json({ ok: true });
        return;
      }

      try {
        messageText = await transcribeVoice(voice, bot);
        await bot.sendMessage(`Heard: "${messageText}"`);
      } catch {
        await bot.sendMessage(
          "Couldn't transcribe that voice message. Please try again or type it out."
        );
        res.status(200).json({ ok: true });
        return;
      }
    } else {
      messageText = extractMessageText(update);
    }

    if (!messageText) {
      res.status(200).json({ ok: true });
      return;
    }

    // Handle commands
    if (isCommand(messageText)) {
      const { command, args } = parseCommand(messageText);

      if (commandExists(command)) {
        const response = await executeCommand(command, args, agent, bot);
        // Only send if response is non-empty (status messages handle their own output)
        if (response) {
          await bot.sendMessageSafe(response);
        }
      } else {
        await bot.sendMessage(`Unknown command /${command}. Try /help to see available commands.`);
      }

      res.status(200).json({ ok: true });
      return;
    }

    // Handle natural language - send to coach agent
    const response = await agent.chat(messageText);
    await bot.sendMessageSafe(response.message);

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Webhook error:", error);

    // Try to notify user of error
    try {
      const bot = createTelegramBot();
      await bot.sendMessage("Something went wrong processing your message. Please try again.");
    } catch {
      // Ignore notification failure
    }

    // Still return 200 to prevent Telegram retries
    res.status(200).json({ ok: true, error: "Internal error" });
  }
}
