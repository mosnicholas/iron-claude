/**
 * Channel → User resolution.
 *
 * When a Telegram message arrives, we look up `channel_identities` keyed by
 * (channel, external_id). If no row exists, we create a new user and bind
 * the chat_id. WhatsApp / SMS will follow the same pattern.
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { channelIdentities, users, type User } from "../db/schema.js";
import { getTimezone } from "../utils/date.js";

export type Channel = "telegram" | "whatsapp" | "sms" | "web";

export async function resolveUserByChannel(
  channel: Channel,
  externalId: string
): Promise<User | null> {
  const db = getDb();
  const rows = await db
    .select({ user: users })
    .from(channelIdentities)
    .innerJoin(users, eq(channelIdentities.userId, users.id))
    .where(and(eq(channelIdentities.channel, channel), eq(channelIdentities.externalId, externalId)))
    .limit(1);
  return rows[0]?.user ?? null;
}

export async function findOrCreateUserByChannel(
  channel: Channel,
  externalId: string,
  hint?: { displayName?: string; phoneE164?: string; timezone?: string }
): Promise<User> {
  const existing = await resolveUserByChannel(channel, externalId);
  if (existing) return existing;

  const db = getDb();
  // Synthesize a placeholder phone for Telegram-first signups (we can't see
  // their real phone). The placeholder is unique per channel id and gets
  // overwritten if/when they bind a real phone via OTP.
  const placeholderPhone =
    hint?.phoneE164 ?? `+pending:${channel}:${externalId}`;

  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        phoneE164: placeholderPhone,
        displayName: hint?.displayName,
        timezone: hint?.timezone ?? getTimezone(),
      })
      .returning();
    await tx.insert(channelIdentities).values({
      userId: user.id,
      channel,
      externalId,
    });
    return user;
  });
}

export async function bindChannelToUser(
  userId: string,
  channel: Channel,
  externalId: string
): Promise<void> {
  const db = getDb();
  await db
    .insert(channelIdentities)
    .values({ userId, channel, externalId })
    .onConflictDoNothing();
}

export async function getUserById(userId: string): Promise<User | null> {
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0] ?? null;
}

export async function listActiveUsers(): Promise<User[]> {
  const db = getDb();
  return db.select().from(users).where(eq(users.active, true));
}
