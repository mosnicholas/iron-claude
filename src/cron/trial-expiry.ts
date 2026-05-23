/**
 * Trial expiry cron — runs daily.
 *
 * For each active user whose tier is still "trial" but whose `trial_ends_at`
 * is in the past, flip their tier to "expired" and notify them via Telegram.
 *
 * The runtime gate in `effectiveTier()` already treats expired trials as
 * "expired", so this cron is really about (a) persisting the state so SQL
 * queries see it, and (b) sending the one-time notification.
 */

import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { users } from "../db/schema.js";
import { runCronForEachUser, type CronResult } from "./runner.js";

const TRIAL_ENDED_MESSAGE_BASE =
  "Your IronClaude trial just ended. Subscribe to keep your training going";

function checkoutLink(): string {
  return process.env.CHECKOUT_URL ?? "https://ironclaude.app/billing";
}

export async function runTrialExpiry(): Promise<CronResult> {
  return runCronForEachUser(
    "trial-expiry",
    async ({ user, sendMessage }) => {
      if (user.tier !== "trial") {
        return { success: true, message: `user=${user.id} tier=${user.tier} skip` };
      }
      const endsAt = user.trialEndsAt instanceof Date ? user.trialEndsAt : new Date(user.trialEndsAt);
      if (!Number.isFinite(endsAt.getTime()) || endsAt.getTime() >= Date.now()) {
        return { success: true, message: `user=${user.id} trial still active` };
      }

      const db = getDb();
      await db
        .update(users)
        .set({ tier: "expired", updatedAt: new Date() })
        .where(eq(users.id, user.id));

      const msg = `${TRIAL_ENDED_MESSAGE_BASE}: ${checkoutLink()}`;
      try {
        await sendMessage(msg);
      } catch (err) {
        // Don't fail the whole user run if the notification fails — the tier
        // is already updated.
        console.error(`[trial-expiry] failed to notify user=${user.id}:`, err);
      }
      return { success: true, message: `user=${user.id} expired` };
    },
    { requireProfile: false }
  );
}
