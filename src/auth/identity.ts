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
    .where(
      and(eq(channelIdentities.channel, channel), eq(channelIdentities.externalId, externalId))
    )
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
  const placeholderPhone = hint?.phoneE164 ?? `+pending:${channel}:${externalId}`;

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
  await db.insert(channelIdentities).values({ userId, channel, externalId }).onConflictDoNothing();
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

/**
 * Resolve an IronClaude user from a Supabase auth session.
 *
 * Lookup order:
 *   1. `users.supabase_user_id` — already bound to this Supabase identity.
 *   2. `users.phone_e164` — the phone matches an existing row (e.g. a
 *      Telegram-first user who is now binding a real phone). We adopt the
 *      Supabase user id by writing it back.
 *   3. No match → create a new row with both phone and supabase_user_id set.
 */
export async function findOrCreateUserByPhone(
  phoneE164: string,
  supabaseUserId: string,
  hint?: { displayName?: string; timezone?: string }
): Promise<User> {
  const db = getDb();

  const bySupabase = await db
    .select()
    .from(users)
    .where(eq(users.supabaseUserId, supabaseUserId))
    .limit(1);
  if (bySupabase[0]) return bySupabase[0];

  const byPhone = await db.select().from(users).where(eq(users.phoneE164, phoneE164)).limit(1);
  if (byPhone[0]) {
    if (!byPhone[0].supabaseUserId) {
      const [updated] = await db
        .update(users)
        .set({ supabaseUserId, updatedAt: new Date() })
        .where(eq(users.id, byPhone[0].id))
        .returning();
      return updated;
    }
    return byPhone[0];
  }

  const [created] = await db
    .insert(users)
    .values({
      phoneE164,
      supabaseUserId,
      displayName: hint?.displayName,
      timezone: hint?.timezone ?? getTimezone(),
    })
    .returning();
  return created;
}
