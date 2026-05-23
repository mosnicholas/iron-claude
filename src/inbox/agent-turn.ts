/**
 * Agent turn execution — the per-message work that used to live inline in
 * `src/handlers/webhook.ts::processMessage`.
 *
 * Extracted out of the webhook so the inbox worker can drive it from any
 * instance: the webhook now only inserts into `inbox_events`, and the worker
 * loop dequeues those events and calls `runAgentTurn`.
 *
 * Inputs:
 *   - `user`: the resolved `users` row (already created by the webhook via
 *     `findOrCreateUserByChannel`)
 *   - `update`: the raw Telegram update payload
 *   - `bot`: a per-chat `TelegramBot` constructed via `createTelegramBotForChat`
 *
 * Side effects: edits/sends Telegram messages, appends to `messages` table.
 */

import { createCoachAgentV2 } from "../coach-v2/index.js";
import {
  type TelegramBot,
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
import { uploadPhoto } from "../storage/photos.js";
import { isSupabaseConfigured } from "../auth/supabase.js";
import type { ImageBlock } from "../coach-v2/llm-client.js";
import type { TelegramUpdate } from "../storage/types.js";
import type { User } from "../db/schema.js";
import { gateInboxTurn } from "./tier-gate.js";

export interface RunAgentTurnInput {
  user: User;
  update: TelegramUpdate;
  bot: TelegramBot;
}

/**
 * Run the coach for a single Telegram update.
 *
 * Mirrors the legacy webhook `processMessage` flow but is scoped to a specific
 * user (the inbox worker resolves the user before dispatching). Errors are
 * caught and surfaced back to the chat; the caller (worker) is also notified
 * via re-throw so it can mark the inbox row failed and apply backoff.
 */
export async function runAgentTurn({ user, update, bot }: RunAgentTurnInput): Promise<void> {
  // Tier gate — expired users get a block message instead of an agent run.
  // Trial / regular / athlete / comped fall through to the normal flow.
  const gate = gateInboxTurn(user);
  if (gate !== "allow") {
    await bot.sendMessageSafe(gate.block);
    await addMessage(user.id, "assistant", gate.block);
    return;
  }

  // Send typing indicator
  await bot.sendTypingAction();

  const agent = createCoachAgentV2({ userId: user.id, timezone: user.timezone });

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
      const { buffer, mediaType } = await downloadPhotoBytes(photo.file_id, bot);
      images = [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: mediaType,
            data: buffer.toString("base64"),
          },
        },
      ];

      // Captions on photos arrive as `caption`, not `text`. If neither is
      // present, give the model a reasonable default prompt.
      const caption = extractCaption(update);
      messageText =
        caption || extractMessageText(update) || "[athlete shared a photo with no caption]";

      // Persist to Supabase Storage so the agent can compare against past
      // photos later. Best-effort: if Storage is misconfigured or upload
      // fails, log + continue so the conversation isn't broken.
      if (isSupabaseConfigured()) {
        try {
          const sourceMessageId = update.message?.message_id?.toString() ?? null;
          await uploadPhoto(user.id, buffer, mediaType, {
            caption: caption || null,
            sizeBytes: buffer.byteLength,
            width: photo.width ?? null,
            height: photo.height ?? null,
            sourceChannel: "telegram",
            sourceMessageId,
          });
        } catch (uploadErr) {
          console.error("[agent-turn] Failed to persist photo to storage:", uploadErr);
        }
      }
    } catch (err) {
      console.error("[agent-turn] Failed to download photo:", err);
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
  await addMessage(user.id, "user", messageText);

  // Handle infrastructure commands (help / restart / reauth). /debug is a
  // command but we let it fall through to the v2 router which has its own
  // handler for it.
  if (isCommand(messageText) && !messageText.trim().startsWith("/debug")) {
    const { command, args } = parseCommand(messageText);

    if (commandExists(command)) {
      const response = await executeCommand(command, args, { userId: user.id, agent, bot });
      if (response) {
        await bot.sendMessageSafe(response);
        await addMessage(user.id, "assistant", response);
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
        console.log(`[agent-turn] Status update: ${status}`);
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

    await addMessage(user.id, "assistant", response.message);
  } else {
    // Fallback if we couldn't get a message ID
    const response = await agent.chat(messageText, undefined, undefined, undefined, images);
    const chunks = splitOnMessageBreaks(response.message);
    for (const chunk of chunks) {
      await bot.sendMessageSafe(chunk);
    }
    await addMessage(user.id, "assistant", response.message);
  }
}

/**
 * Fetch a Telegram photo's raw bytes by file_id, plus a sniffed media type.
 * Returning the buffer (not a pre-built ImageBlock) lets the caller both
 * (a) base64-encode it for the LLM and (b) push the same bytes into Supabase
 * Storage without paying for a second download.
 *
 * Telegram serves photos as JPEG; we sniff the URL extension and fall back to
 * jpeg if unsure. The Anthropic SDK accepts the `image` block uniformly
 * across jpeg/png/gif/webp.
 */
async function downloadPhotoBytes(
  fileId: string,
  bot: TelegramBot
): Promise<{ buffer: Buffer; mediaType: ReturnType<typeof inferImageMediaType> }> {
  const { filePath, fileUrl } = await bot.getFile(fileId);
  const ab = await bot.downloadFile(fileUrl);
  return {
    buffer: Buffer.from(ab),
    mediaType: inferImageMediaType(filePath),
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
