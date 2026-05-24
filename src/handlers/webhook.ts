/**
 * Telegram Webhook Handler
 *
 * Entry point for all Telegram updates. Now multi-instance-safe:
 *   1. Verify the Telegram secret token (HTTP-level auth for the endpoint).
 *   2. Resolve / auto-create the user from `(channel, chat_id)`.
 *   3. Insert the update into `inbox_events` (idempotent on `(channel,
 *      external_update_id)` — Telegram retries fast-path to a 200 here).
 *   4. Return 200 immediately. The actual agent run happens in the inbox
 *      worker loop (`src/inbox/worker.ts`), which any process can drive.
 *
 * No in-memory dedupe / queues / processing — all coordination is in
 * Postgres. See `src/inbox/storage.ts` and `src/inbox/worker.ts`.
 */

import type { Request, Response } from "express";
import { verifyTelegramSecret } from "../bot/telegram.js";
import { findOrCreateUserByChannel } from "../auth/identity.js";
import { insertInboxEvent } from "../inbox/storage.js";
import { captureError } from "../observability/sentry.js";
import type { TelegramUpdate } from "../storage/types.js";

export async function webhookHandler(req: Request, res: Response): Promise<void> {
  console.log("[webhook] Received request:", req.method);

  try {
    // Fail closed: every inbound webhook must present a matching secret.
    // `verifyTelegramSecret` requires TELEGRAM_WEBHOOK_SECRET to be set; if it
    // isn't, the endpoint refuses all traffic rather than trusting the body.
    const secretHeader =
      (req.headers["x-telegram-bot-api-secret-token"] as string | undefined) ?? null;
    if (!verifyTelegramSecret(secretHeader)) {
      console.log("[webhook] Rejected: webhook secret mismatch or unconfigured");
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const update: TelegramUpdate = req.body;
    console.log("[webhook] Update received:", {
      updateId: update.update_id,
      hasMessage: !!update.message,
      chatId: update.message?.chat?.id,
      text: update.message?.text?.slice(0, 50),
    });

    const chatId = update.message?.chat?.id;
    if (!chatId) {
      // No actionable message — ack so Telegram stops retrying.
      res.status(200).json({ ok: true });
      return;
    }

    // Auto-create the user on first contact. Any chat_id is welcome for v1;
    // we'll layer auth checks back in via a channel allowlist later.
    const user = await findOrCreateUserByChannel("telegram", String(chatId));

    // Idempotent insert into the inbox queue. If Telegram retries (or two
    // ingress instances race), the unique index drops the dupe and we still
    // respond 200.
    const result = await insertInboxEvent({
      channel: "telegram",
      externalUpdateId: String(update.update_id),
      userId: user.id,
      payload: update,
    });

    if (!result.inserted) {
      // JSON.stringify on the user-controlled value is CodeQL-recognized
      // log-injection sanitization (escapes newlines, quotes the string).
      console.log(
        `[webhook] Duplicate update_id ${JSON.stringify(update.update_id)}, already queued`
      );
    } else {
      console.log(`[webhook] Queued event ${result.eventId} for user ${user.id}`);
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    captureError(error, { handler: "webhook", channel: "telegram" });
    // Transient DB errors (pool exhausted, connection terminated) get a 500
    // so Telegram retries the delivery — we lost no state because the
    // inbox_events row wasn't committed. Permanent errors (bad payload
    // shape, etc.) ack 200 so we don't loop Telegram on a bug we can't fix
    // at the source.
    if (errorIsDbTransient(error)) {
      res.status(500).json({ ok: false, error: "Transient error; retry" });
      return;
    }
    res.status(200).json({ ok: true, error: "Internal error" });
  }
}

/**
 * True when the error looks like a transient DB issue worth retrying via
 * Telegram's at-least-once delivery. Conservative: when in doubt, return
 * false (200-ack) to avoid retry storms on permanent bugs.
 */
export function errorIsDbTransient(err: unknown): boolean {
  if (!err) return false;
  const code = (err as { code?: string }).code;
  const msg = err instanceof Error ? err.message : String(err);
  // Postgres class 08 (connection exception) + 57P (operator intervention)
  // are the canonical "DB is fine but our connection isn't" signals.
  if (code && /^(08|57P)/.test(code)) return true;
  if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "ETIMEDOUT") return true;
  return /connection terminated|connection refused|pool|timed? ?out|server closed the connection/i.test(
    msg
  );
}
