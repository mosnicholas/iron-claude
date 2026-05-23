/**
 * Stripe webhook signing helper.
 *
 * Stripe webhooks use HMAC-SHA256 over `<timestamp>.<raw_body>` keyed by the
 * webhook secret. To exercise the real signature-verification path in our
 * handler (and the idempotency / reorder paths), we sign payloads with the
 * test webhook secret and POST them at our own server.
 *
 * We do NOT mock the Stripe SDK — `__setStripeForTests` in src/handlers/stripe.ts
 * already does that. This helper is just for constructing valid signed bodies
 * that pass `constructEvent()`.
 */

import { createHmac } from "crypto";

export interface StripeEventOpts {
  /** e.g. "customer.subscription.created" */
  type: string;
  /** event.id — pass the same id twice to test replay-attack handling. */
  id?: string;
  /** event.created (unix seconds). Out-of-order tests vary this. */
  created?: number;
  /** event.data.object payload. */
  data: Record<string, unknown>;
}

export interface SignedStripeEvent {
  /** Raw bytes posted as the request body. */
  body: Buffer;
  /** Stripe signature header value. */
  signature: string;
  /** The constructed event for assertions. */
  event: Record<string, unknown>;
}

let evtCounter = 0;

/**
 * Build a Stripe-signed webhook payload + signature header. The harness's
 * `postStripeWebhook` helper takes both and sends them at /api/stripe/webhook.
 */
export function buildSignedStripeEvent(
  webhookSecret: string,
  opts: StripeEventOpts
): SignedStripeEvent {
  const id = opts.id ?? `evt_test_${Date.now()}_${++evtCounter}`;
  const created = opts.created ?? Math.floor(Date.now() / 1000);

  const event = {
    id,
    object: "event",
    api_version: "2024-11-20.acacia",
    created,
    type: opts.type,
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: { object: opts.data },
  };

  const body = Buffer.from(JSON.stringify(event), "utf8");
  const timestamp = created;
  const signedPayload = `${timestamp}.${body.toString("utf8")}`;
  const sig = createHmac("sha256", webhookSecret).update(signedPayload).digest("hex");
  // Stripe header format: `t=<ts>,v1=<sig>`.
  const signature = `t=${timestamp},v1=${sig}`;

  return { body, signature, event };
}
