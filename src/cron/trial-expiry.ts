/**
 * Trial expiry — per-user logic. Dispatched from pg-boss daily via
 * `trial-expiry.tick` → `trial-expiry.user`.
 */

import { and, eq, lt } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { users } from "../db/schema.js";
import type { JobCtx } from "../jobs/handlers.js";

const TRIAL_ENDED_MESSAGE_BASE =
  "Your IronClaude trial just ended. Subscribe to keep your training going";

function checkoutLink(): string {
  return process.env.CHECKOUT_URL ?? "https://ironclaude.app/billing";
}

export async function processTrialExpiryForUser({
  user,
  sendMessage,
}: JobCtx): Promise<{ success: boolean; message?: string; error?: string }> {
  if (user.tier !== "trial") {
    return { success: true, message: `tier=${user.tier} skip` };
  }
  const endsAt =
    user.trialEndsAt instanceof Date ? user.trialEndsAt : new Date(user.trialEndsAt);
  if (!Number.isFinite(endsAt.getTime()) || endsAt.getTime() >= Date.now()) {
    return { success: true, message: "trial still active" };
  }

  // Atomic compare-and-set: only flip if the row is still trial + still past
  // its end. A concurrent Stripe upgrade between the read and write would
  // have set tier='regular', and this WHERE clause won't match.
  const updated = await getDb()
    .update(users)
    .set({ tier: "expired", updatedAt: new Date() })
    .where(
      and(
        eq(users.id, user.id),
        eq(users.tier, "trial"),
        lt(users.trialEndsAt, new Date())
      )
    )
    .returning({ id: users.id });

  if (updated.length === 0) {
    return { success: true, message: "already advanced past trial concurrently" };
  }

  const msg = `${TRIAL_ENDED_MESSAGE_BASE}: ${checkoutLink()}`;
  try {
    await sendMessage(msg);
  } catch (err) {
    // Don't fail the job; the tier is already updated. Bot delivery failure
    // is logged via captureError in the runner.
    console.error(`[trial-expiry] failed to notify user=${user.id}:`, err);
  }
  return { success: true, message: "expired" };
}
