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

import type { PoolClient } from "pg";
import { getPool } from "../db/client.js";
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
import { runAgentTurn as defaultRunAgentTurn } from "./agent-turn.js";
import type { TelegramBot } from "../bot/telegram.js";

// ── Dependency injection for tests ────────────────────────────────────────────
// Tests can swap the agent turn handler so they don't hit the real LLM. In
// production this is the actual `runAgentTurn` from ./agent-turn.js.
export interface RunAgentTurnFn {
  (input: { user: User; update: TelegramUpdate; bot: TelegramBot }): Promise<void>;
}

let injectedRunAgentTurn: RunAgentTurnFn | null = null;
let injectedCreateBot: ((chatId: string) => TelegramBot) | null = null;

/** Test-only: inject a mock agent-turn handler. Pass null to reset. */
export function __setRunAgentTurn(fn: RunAgentTurnFn | null): void {
  injectedRunAgentTurn = fn;
}

/** Test-only: inject a bot factory (so tests don't need real Telegram creds). */
export function __setCreateBotForChat(fn: ((chatId: string) => TelegramBot) | null): void {
  injectedCreateBot = fn;
}

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
  //
  // CRITICAL: `pg_advisory_lock` is session-scoped, so the try-lock, agent
  // run, and unlock must all happen on the SAME physical pg connection. We
  // pin a `PoolClient` checked out from the pool for the duration. Drizzle
  // queries inside `runTurn` continue to use the shared pool — that's fine,
  // because once we hold the advisory lock there's no ordering requirement
  // inside the agent turn itself.
  const pool = getPool();
  const client = await pool.connect();
  let lockAcquired = false;
  try {
    lockAcquired = await tryAdvisoryLock(client, user.id);
    if (!lockAcquired) {
      console.log(
        `[inbox-worker] user ${user.id} busy on another instance; deferring event ${event.id}`
      );
      await deferEvent(event.id, PEER_BUSY_DEFER_MS);
      return;
    }

    try {
      const botFactory = injectedCreateBot ?? createTelegramBotForChat;
      const runTurn = injectedRunAgentTurn ?? defaultRunAgentTurn;
      const bot = botFactory(String(chatId));
      await runTurn({ user, update, bot });
    } finally {
      await releaseAdvisoryLock(client, user.id);
    }
  } finally {
    client.release();
  }
}

async function tryAdvisoryLock(client: PoolClient, key: string): Promise<boolean> {
  const result = await client.query(
    `SELECT pg_try_advisory_lock(hashtext($1)::bigint) AS locked`,
    [key]
  );
  const row = (result.rows ?? [])[0] as { locked?: boolean } | undefined;
  return row?.locked === true;
}

async function releaseAdvisoryLock(client: PoolClient, key: string): Promise<void> {
  try {
    await client.query(`SELECT pg_advisory_unlock(hashtext($1)::bigint)`, [key]);
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
