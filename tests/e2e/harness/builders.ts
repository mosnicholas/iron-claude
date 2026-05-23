/**
 * Test data builders. Insert rows via the Storage interface so tests don't
 * depend on Drizzle internals.
 *
 * Each builder returns the resulting row(s) so tests can assert on the ids.
 */

import { eq } from "drizzle-orm";
import { getDb } from "../../../src/db/client.js";
import { users, channelIdentities, type User } from "../../../src/db/schema.js";
import { getStorage } from "../../../src/storage/db.js";

export interface SeedUserOpts {
  phoneE164?: string;
  displayName?: string;
  timezone?: string;
  tier?: "trial" | "regular" | "athlete" | "comped" | "expired";
  trialEndsAt?: Date;
  supabaseUserId?: string;
  /** Bind a Telegram chat_id to this user. */
  telegramChatId?: string;
  /** Optional profile body — without this, requireProfile cron jobs skip the user. */
  profileBody?: string;
}

let phoneCounter = 0;

/**
 * Create a fully-formed user with optional channel binding + profile.
 * Idempotent on phone via the unique index.
 */
export async function seedUser(opts: SeedUserOpts = {}): Promise<User> {
  const phone = opts.phoneE164 ?? `+155500${(10000 + phoneCounter++).toString()}`;
  const db = getDb();

  const [user] = await db
    .insert(users)
    .values({
      phoneE164: phone,
      displayName: opts.displayName ?? "Test User",
      timezone: opts.timezone ?? "America/New_York",
      tier: opts.tier ?? "trial",
      trialEndsAt: opts.trialEndsAt ?? new Date(Date.now() + 30 * 24 * 3600 * 1000),
      supabaseUserId: opts.supabaseUserId ?? null,
    })
    .returning();

  if (opts.telegramChatId) {
    await db
      .insert(channelIdentities)
      .values({ userId: user.id, channel: "telegram", externalId: opts.telegramChatId });
  }

  if (opts.profileBody) {
    await getStorage().writeProfile(user.id, opts.profileBody);
  }

  return user;
}

/**
 * Quick "make me an expired-trial user" helper, used by tier-gate tests.
 */
export async function seedExpiredTrial(opts: Omit<SeedUserOpts, "tier" | "trialEndsAt"> = {}): Promise<User> {
  return seedUser({
    ...opts,
    tier: "trial",
    trialEndsAt: new Date(Date.now() - 24 * 3600 * 1000),
  });
}

/**
 * Look up a user's fresh row from the DB (after the harness or the agent
 * may have mutated tier / supabase_user_id / etc.).
 */
export async function reloadUser(userId: string): Promise<User> {
  const db = getDb();
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw new Error(`user ${userId} not found`);
  return row;
}
