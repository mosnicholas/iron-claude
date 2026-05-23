/**
 * Inbox storage helpers.
 *
 * Backs the multi-instance-safe webhook queue. The DB schema is in
 * `src/db/schema.ts` (`inbox_events`) — unique on (channel,
 * external_update_id) for idempotency, with status/attempts/next_attempt_at
 * driving the worker loop.
 *
 * All raw SQL goes through Drizzle's `sql` template tag so it shares the
 * existing pg pool.
 */

import { and, eq, lte, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { inboxEvents, type InboxEvent } from "../db/schema.js";

export const MAX_ATTEMPTS = 5;

export interface InsertInboxEventInput {
  channel: string;
  externalUpdateId: string;
  userId: string | null;
  payload: unknown;
}

export interface InsertInboxEventResult {
  inserted: boolean;
  eventId: string | null;
}

/**
 * Idempotent insert. If (channel, external_update_id) already exists we
 * return `{inserted: false, eventId: null}` so the webhook can fast-200 the
 * retry without doing extra work.
 */
export async function insertInboxEvent(
  input: InsertInboxEventInput
): Promise<InsertInboxEventResult> {
  const db = getDb();
  const rows = await db
    .insert(inboxEvents)
    .values({
      channel: input.channel,
      externalUpdateId: input.externalUpdateId,
      userId: input.userId,
      payload: input.payload as object,
    })
    .onConflictDoNothing({
      target: [inboxEvents.channel, inboxEvents.externalUpdateId],
    })
    .returning({ id: inboxEvents.id });

  if (rows.length === 0) {
    return { inserted: false, eventId: null };
  }
  return { inserted: true, eventId: rows[0].id };
}

/**
 * Claim the next pending event under a row-level lock so multiple worker
 * processes never grab the same row. The transaction commits the
 * `status='processing'` update before we return, so a crash mid-agent leaves
 * the row stuck for the reaper to recover.
 */
export async function claimNextEvent(): Promise<InboxEvent | null> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const selected = await tx.execute(
      sql`SELECT * FROM inbox_events
          WHERE status = 'pending' AND next_attempt_at <= now()
          ORDER BY created_at
          LIMIT 1
          FOR UPDATE SKIP LOCKED`
    );
    const row = (selected.rows ?? [])[0] as InboxEvent | undefined;
    if (!row) return null;

    const updated = await tx
      .update(inboxEvents)
      .set({
        status: "processing",
        attempts: row.attempts + 1,
        updatedAt: new Date(),
      })
      .where(eq(inboxEvents.id, row.id))
      .returning();

    return updated[0] ?? null;
  });
}

export async function markEventDone(id: string): Promise<void> {
  const db = getDb();
  await db
    .update(inboxEvents)
    .set({ status: "done", updatedAt: new Date(), lastError: null })
    .where(eq(inboxEvents.id, id));
}

/**
 * Schedule a retry with backoff, or move the event to a terminal 'failed'
 * status once we've burned `MAX_ATTEMPTS`. We trust the `attempts` count
 * already bumped by `claimNextEvent`, so reasons:
 *   - attempts >= MAX_ATTEMPTS → status='failed' (no further retries)
 *   - else → status='pending', next_attempt_at = now() + delay
 */
export async function markEventFailed(
  id: string,
  error: string,
  nextDelayMs: number
): Promise<void> {
  const db = getDb();
  // Pull current attempt count so we can decide retry vs terminal failure.
  const rows = await db
    .select({ attempts: inboxEvents.attempts })
    .from(inboxEvents)
    .where(eq(inboxEvents.id, id))
    .limit(1);
  const attempts = rows[0]?.attempts ?? MAX_ATTEMPTS;

  if (attempts >= MAX_ATTEMPTS) {
    await db
      .update(inboxEvents)
      .set({ status: "failed", lastError: error, updatedAt: new Date() })
      .where(eq(inboxEvents.id, id));
    return;
  }

  await db
    .update(inboxEvents)
    .set({
      status: "pending",
      lastError: error,
      nextAttemptAt: sql`now() + (${nextDelayMs}::int || ' milliseconds')::interval`,
      updatedAt: new Date(),
    })
    .where(eq(inboxEvents.id, id));
}

/**
 * Release a claimed row back to 'pending' without bumping retry count.
 * Used when another instance holds the per-user advisory lock — we want to
 * try again shortly, not blame the row.
 */
export async function deferEvent(id: string, delayMs: number): Promise<void> {
  const db = getDb();
  await db
    .update(inboxEvents)
    .set({
      status: "pending",
      // Don't count this as a real attempt — undo the increment from claim.
      attempts: sql`GREATEST(${inboxEvents.attempts} - 1, 0)`,
      nextAttemptAt: sql`now() + (${delayMs}::int || ' milliseconds')::interval`,
      updatedAt: new Date(),
    })
    .where(eq(inboxEvents.id, id));
}

export async function getBacklogCount(): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ count: sql<string>`count(*)` })
    .from(inboxEvents)
    .where(eq(inboxEvents.status, "pending"));
  return Number(rows[0]?.count ?? 0);
}

/**
 * Reset rows that have been stuck in 'processing' for more than 5 minutes.
 * Called by a periodic reaper (separate cron) — covers the case where a
 * worker process dies mid-agent.
 */
export async function reapStuckEvents(maxAgeMinutes = 5): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60_000);
  const result = await db
    .update(inboxEvents)
    .set({
      status: "pending",
      lastError: "reaped stuck processing",
      updatedAt: new Date(),
    })
    .where(and(eq(inboxEvents.status, "processing"), lte(inboxEvents.updatedAt, cutoff)))
    .returning({ id: inboxEvents.id });
  return result.length;
}

export async function setEventUserId(id: string, userId: string): Promise<void> {
  const db = getDb();
  await db.update(inboxEvents).set({ userId, updatedAt: new Date() }).where(eq(inboxEvents.id, id));
}

/**
 * Exponential backoff schedule, indexed by attempts-so-far.
 * 1s, 5s, 30s, 2m, 10m — past MAX_ATTEMPTS we move to terminal 'failed'.
 */
export function backoffDelayMs(attempts: number): number {
  const schedule = [1_000, 5_000, 30_000, 120_000, 600_000];
  const idx = Math.min(Math.max(attempts - 1, 0), schedule.length - 1);
  return schedule[idx];
}
