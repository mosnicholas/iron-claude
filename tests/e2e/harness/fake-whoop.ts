/**
 * Whoop webhook signing helper. Matches what `verifyWhoopWebhook` checks in
 * src/integrations/whoop/webhooks.ts — HMAC-SHA256 of the raw body alone,
 * hex digest, sent in the `x-whoop-signature` header. (Whoop also sends a
 * timestamp header but we don't currently verify it, so we omit it from the
 * fixture.)
 */

import { createHmac } from "crypto";

export interface WhoopEventOpts {
  /** "workout.updated" | "recovery.updated" | "sleep.updated" | "user.profile.updated" */
  type: string;
  /** Whoop user id from the OAuth flow — must match integration_tokens.external_user_id. */
  whoopUserId: number;
  /** Domain id (workout id, sleep id, etc.). */
  resourceId: string;
}

export interface SignedWhoopEvent {
  body: Buffer;
  signature: string;
  timestamp: string;
}

export function buildSignedWhoopEvent(
  webhookSecret: string,
  opts: WhoopEventOpts
): SignedWhoopEvent {
  const payload = {
    user_id: opts.whoopUserId,
    id: opts.resourceId,
    type: opts.type,
    trace_id: `trace_${Date.now()}`,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const timestamp = Date.now().toString();
  const sig = createHmac("sha256", webhookSecret)
    .update(body)
    .digest("hex");
  return { body, signature: sig, timestamp };
}
