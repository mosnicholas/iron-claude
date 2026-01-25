/**
 * Telegram Webhook Handler
 *
 * Main entry point for all Telegram messages.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createCoachAgent } from '../src/coach/index.js';
import {
  createTelegramBot,
  extractMessageText,
  extractVoiceMessage,
  isCommand,
  parseCommand,
} from '../src/bot/telegram.js';
import { executeCommand, commandExists } from '../src/bot/commands.js';
import { transcribeVoice, isVoiceTranscriptionAvailable } from '../src/bot/voice.js';
import type { TelegramUpdate } from '../src/storage/types.js';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Only accept POST requests
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const bot = createTelegramBot();

    // Verify webhook secret if configured
    const secretToken = req.headers['x-telegram-bot-api-secret-token'] as string | null;
    if (!bot.verifyWebhook(secretToken)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const update: TelegramUpdate = req.body;

    // Verify this is from the authorized chat
    const chatId = update.message?.chat.id;
    if (!chatId || !bot.isAuthorizedChat(chatId)) {
      // Silently ignore unauthorized messages
      res.status(200).json({ ok: true });
      return;
    }

    // Send typing indicator
    await bot.sendTypingAction();

    // Initialize agent
    const agent = createCoachAgent();

    let messageText: string | null = null;

    // Handle voice messages
    const voice = extractVoiceMessage(update);
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
        // Confirm the transcription
        await bot.sendMessage(`🎤 Heard: "${messageText}"`);
      } catch (error) {
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
      // No text content, ignore
      res.status(200).json({ ok: true });
      return;
    }

    // Handle commands
    if (isCommand(messageText)) {
      const { command, args } = parseCommand(messageText);

      if (commandExists(command)) {
        const response = await executeCommand(command, args, agent, bot);
        await bot.sendMessageSafe(response);
      } else {
        await bot.sendMessage(
          `Unknown command /${command}. Try /help to see available commands.`
        );
      }

      res.status(200).json({ ok: true });
      return;
    }

    // Handle natural language - send to coach agent
    const response = await agent.chat(messageText);
    await bot.sendMessageSafe(response.message);

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);

    // Try to notify user of error
    try {
      const bot = createTelegramBot();
      await bot.sendMessage(
        "Something went wrong processing your message. Please try again."
      );
    } catch {
      // Ignore notification failure
    }

    // Still return 200 to prevent Telegram retries
    res.status(200).json({ ok: true, error: 'Internal error' });
  }
}
