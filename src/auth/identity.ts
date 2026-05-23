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

  // Set trialEndsAt explicitly in JS in case the SQL default isn't evaluated
  // (e.g. some test harnesses, or Drizzle versions that strip column defaults
  // when the column is omitted from `values()`).
  const trialEndsAt = thirtyDaysFromNow();

  // Race-safe: two concurrent webhook deliveries for a brand-new chat_id on
  // two Fly instances must both end up with exactly one user + one binding.
  // We use `ON CONFLICT DO NOTHING RETURNING ...`; if the insert was raced
  // and returned zero rows, we re-SELECT the winning row.
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(users)
      .values({
        phoneE164: placeholderPhone,
        displayName: hint?.displayName,
        timezone: hint?.timezone ?? getTimezone(),
        trialEndsAt,
      })
      .onConflictDoNothing({ target: users.phoneE164 })
      .returning();

    let user: User;
    if (inserted[0]) {
      user = inserted[0];
    } else {
      const [existingUser] = await tx
        .select()
        .from(users)
        .where(eq(users.phoneE164, placeholderPhone))
        .limit(1);
      if (!existingUser) {
        throw new Error("findOrCreateUserByChannel: user row not found after conflict");
      }
      user = existingUser;
    }

    await tx
      .insert(channelIdentities)
      .values({
        userId: user.id,
        channel,
        externalId,
      })
      .onConflictDoNothing({
        target: [channelIdentities.channel, channelIdentities.externalId],
      });

    return user;
  });
}

function thirtyDaysFromNow(): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 30);
  return d;
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

  // Race-safe: two concurrent OTP completions for the same Supabase user (or
  // the same phone) on two Fly instances must both end up referencing exactly
  // one user row. We rely on the unique indexes on `supabase_user_id` and
  // `phone_e164` plus `ON CONFLICT DO NOTHING RETURNING`, falling back to a
  // re-SELECT when the insert was raced.
  return db.transaction(async (tx) => {
    const bySupabase = await tx
      .select()
      .from(users)
      .where(eq(users.supabaseUserId, supabaseUserId))
      .limit(1);
    if (bySupabase[0]) return bySupabase[0];

    const byPhone = await tx
      .select()
      .from(users)
      .where(eq(users.phoneE164, phoneE164))
      .limit(1);
    if (byPhone[0]) {
      if (!byPhone[0].supabaseUserId) {
        const [updated] = await tx
          .update(users)
          .set({ supabaseUserId, updatedAt: new Date() })
          .where(eq(users.id, byPhone[0].id))
          .returning();
        return updated;
      }
      return byPhone[0];
    }

    const inserted = await tx
      .insert(users)
      .values({
        phoneE164,
        supabaseUserId,
        displayName: hint?.displayName,
        timezone: hint?.timezone ?? getTimezone(),
        trialEndsAt: thirtyDaysFromNow(),
      })
      .onConflictDoNothing({ target: users.phoneE164 })
      .returning();
    if (inserted[0]) return inserted[0];

    // Raced — another instance inserted under the same phone (or the same
    // supabase_user_id, which would also surface here as a unique-index hit if
    // we conflicted on `supabaseUserId` first). Re-SELECT to find whichever
    // row won. We try by supabaseUserId first (in case our insert was racing
    // a concurrent insert that bound the same supabase id under a different
    // phone), then by phoneE164.
    const [bySupabaseAfter] = await tx
      .select()
      .from(users)
      .where(eq(users.supabaseUserId, supabaseUserId))
      .limit(1);
    if (bySupabaseAfter) return bySupabaseAfter;

    const [byPhoneAfter] = await tx
      .select()
      .from(users)
      .where(eq(users.phoneE164, phoneE164))
      .limit(1);
    if (byPhoneAfter) {
      if (!byPhoneAfter.supabaseUserId) {
        const [updated] = await tx
          .update(users)
          .set({ supabaseUserId, updatedAt: new Date() })
          .where(eq(users.id, byPhoneAfter.id))
          .returning();
        return updated;
      }
      return byPhoneAfter;
    }

    throw new Error("findOrCreateUserByPhone: user row not found after conflict");
  });
}
