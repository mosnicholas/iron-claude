/**
 * Per-user Telegram bot dispatch.
 *
 * Resolves a user's Telegram chat_id from `channel_identities` and sends a
 * message to it via the shared bot token. Returns silently if the user has
 * no Telegram channel bound (e.g. web-only signup).
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { channelIdentities, type User } from "../db/schema.js";
import { createTelegramBotForChat } from "./telegram.js";

export async function getTelegramChatId(userId: string): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select({ externalId: channelIdentities.externalId })
    .from(channelIdentities)
    .where(and(eq(channelIdentities.userId, userId), eq(channelIdentities.channel, "telegram")))
    .limit(1);
  return rows[0]?.externalId ?? null;
}

export async function sendBotMessageForUser(user: User, text: string): Promise<void> {
  const chatId = await getTelegramChatId(user.id);
  if (!chatId) {
    console.log(`[telegram-for-user] user=${user.id} has no telegram binding; skipping`);
    return;
  }
  const bot = createTelegramBotForChat(chatId);
  await bot.sendMessageSafe(text);
}
