/**
 * Inbox worker loop.
 *
 * Drives the `inbox_events` queue: claim → per-user advisory lock → run agent
 * turn → mark done/failed. Designed to be safe across multiple processes:
 *
 *   - `claimNextEvent` uses `FOR UPDATE SKIP LOCKED` so two workers never grab
 *     the same row.
 *   - `pg_try_advisory_lock(hashtext(user_id)::bigint)` serializes events
 *     belonging to the same user across instances. If a peer holds the lock,
 *     we defer the row back to 'pending' with a short delay (we don't want
 *     to burn a retry attempt on a cooperative wait).
 *   - Failures use exponential backoff via `markEventFailed`.
 *
 * `startWorker()` is wired up at server boot in `src/server.ts`.
 */

import { sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { getUserById, findOrCreateUserByChannel } from "../auth/identity.js";
import { createTelegramBotForChat } from "../bot/telegram.js";
import { captureError } from "../observability/sentry.js";
import type { TelegramUpdate } from "../storage/types.js";
import type { InboxEvent, User } from "../db/schema.js";
import {
  claimNextEvent,
  markEventDone,
  markEventFailed,
  deferEvent,
  setEventUserId,
  backoffDelayMs,
} from "./storage.js";
import { runAgentTurn } from "./agent-turn.js";

const DEFAULT_BUSY_INTERVAL_MS = 250;
const DEFAULT_IDLE_INTERVAL_MS = 2_000;
/** Short delay used when a peer holds the per-user advisory lock. */
const PEER_BUSY_DEFER_MS = 50;

export type ProcessResult = "processed" | "idle" | "error";

/**
 * Pop one event, run it, and update its status. Safe to call concurrently —
 * row-level + advisory locks coordinate across instances.
 */
export async function processOneEvent(): Promise<ProcessResult> {
  let event: InboxEvent | null = null;
  try {
    event = await claimNextEvent();
  } catch (err) {
    captureError(err, { handler: "inbox-worker", extra: { phase: "claim" } });
    return "error";
  }

  if (!event) return "idle";

  try {
    await dispatch(event);
    await markEventDone(event.id);
    return "processed";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const delayMs = backoffDelayMs(event.attempts);
    captureError(err, {
      handler: "inbox-worker",
      userId: event.userId ?? undefined,
      channel: event.channel,
      extra: { eventId: event.id, attempts: event.attempts },
    });
    try {
      await markEventFailed(event.id, message, delayMs);
    } catch (markErr) {
      captureError(markErr, {
        handler: "inbox-worker",
        extra: { phase: "markFailed", eventId: event.id },
      });
    }
    return "error";
  }
}

/**
 * Route an event to its channel handler. Add new channels here (whatsapp,
 * sms, web) as they come online.
 */
async function dispatch(event: InboxEvent): Promise<void> {
  switch (event.channel) {
    case "telegram":
      await handleTelegramEvent(event);
      return;
    default:
      throw new Error(`Unknown channel: ${event.channel}`);
  }
}

async function handleTelegramEvent(event: InboxEvent): Promise<void> {
  const update = event.payload as TelegramUpdate;
  const chatId = update.message?.chat?.id;
  if (!chatId) {
    // Update has no chat — nothing actionable. Treat as success so we don't
    // retry forever.
    console.log(`[inbox-worker] event ${event.id} has no chat_id; skipping`);
    return;
  }

  // Resolve user (re-using the webhook's lookup so cron/web-only users still
  // share an identity if they later message us).
  let user: User | null = null;
  if (event.userId) {
    user = await getUserById(event.userId);
  }
  if (!user) {
    user = await findOrCreateUserByChannel("telegram", String(chatId));
    if (!event.userId) {
      await setEventUserId(event.id, user.id);
    }
  }

  // Per-user advisory lock — serialize concurrent updates for the same user
  // across instances. Hash the UUID to a bigint slot.
  const acquired = await tryAdvisoryLock(user.id);
  if (!acquired) {
    console.log(
      `[inbox-worker] user ${user.id} busy on another instance; deferring event ${event.id}`
    );
    await deferEvent(event.id, PEER_BUSY_DEFER_MS);
    return;
  }

  try {
    const bot = createTelegramBotForChat(String(chatId));
    await runAgentTurn({ user, update, bot });
  } finally {
    await releaseAdvisoryLock(user.id);
  }
}

async function tryAdvisoryLock(key: string): Promise<boolean> {
  const db = getDb();
  const result = await db.execute(
    sql`SELECT pg_try_advisory_lock(hashtext(${key})::bigint) AS locked`
  );
  const row = (result.rows ?? [])[0] as { locked?: boolean } | undefined;
  return row?.locked === true;
}

async function releaseAdvisoryLock(key: string): Promise<void> {
  const db = getDb();
  try {
    await db.execute(sql`SELECT pg_advisory_unlock(hashtext(${key})::bigint)`);
  } catch (err) {
    // Releasing should never fail in practice; log and move on.
    captureError(err, {
      handler: "inbox-worker",
      extra: { phase: "unlock", key },
    });
  }
}

export interface StartWorkerOptions {
  /** Polling interval when an event was just processed. */
  busyIntervalMs?: number;
  /** Polling interval when the queue was empty (or on error). */
  idleIntervalMs?: number;
}

export interface WorkerHandle {
  stop(): Promise<void>;
}

/**
 * Start the worker loop. Returns a handle with a `stop()` for graceful
 * shutdown. Polls aggressively when there's work, slowly when idle.
 */
export function startWorker(opts: StartWorkerOptions = {}): WorkerHandle {
  const busyMs = opts.busyIntervalMs ?? DEFAULT_BUSY_INTERVAL_MS;
  const idleMs = opts.idleIntervalMs ?? DEFAULT_IDLE_INTERVAL_MS;

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    let nextDelay = idleMs;
    try {
      const result = await processOneEvent();
      nextDelay = result === "processed" ? busyMs : idleMs;
    } catch (err) {
      // processOneEvent already captures; this is belt-and-suspenders.
      captureError(err, { handler: "inbox-worker", extra: { phase: "tick" } });
      nextDelay = idleMs;
    }
    if (stopped) return;
    timer = setTimeout(() => {
      inFlight = tick();
    }, nextDelay);
  };

  inFlight = tick();

  return {
    async stop(): Promise<void> {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      if (inFlight) {
        try {
          await inFlight;
        } catch {
          // Already logged inside tick().
        }
      }
    },
  };
}
