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
import { createTelegramBot } from "../bot/telegram.js";
import { findOrCreateUserByChannel } from "../auth/identity.js";
import { insertInboxEvent } from "../inbox/storage.js";
import { captureError } from "../observability/sentry.js";
import type { TelegramUpdate } from "../storage/types.js";

export async function webhookHandler(req: Request, res: Response): Promise<void> {
  console.log("[webhook] Received request:", req.method);

  try {
    // Use the env-pinned bot only for secret verification — chat targeting now
    // comes from the inbox worker via createTelegramBotForChat.
    const bot = createTelegramBot();

    const secretToken = req.headers["x-telegram-bot-api-secret-token"] as string | null;
    if (!bot.verifyWebhook(secretToken)) {
      console.log("[webhook] Rejected: webhook secret mismatch");
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
      console.log(`[webhook] Duplicate update_id ${update.update_id}, already queued`);
    } else {
      console.log(`[webhook] Queued event ${result.eventId} for user ${user.id}`);
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    captureError(error, { handler: "webhook", channel: "telegram" });
    // Still return 200 to prevent Telegram retries on transient errors —
    // we'd rather lose the message than get stuck in a retry storm.
    res.status(200).json({ ok: true, error: "Internal error" });
  }
}
