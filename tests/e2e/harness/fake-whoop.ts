/**
 * Whoop webhook signing helper. Same shape as fake-stripe.ts but using
 * Whoop's signature scheme: HMAC-SHA256 over `<timestamp><raw_body>` (no
 * separator), header is `X-WHOOP-Signature` + `X-WHOOP-Signature-Timestamp`.
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
    .update(timestamp + body.toString("utf8"))
    .digest("base64");
  return { body, signature: sig, timestamp };
}
