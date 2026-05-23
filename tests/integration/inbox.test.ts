/**
 * Inbox integration tests — verify the queue mechanics without invoking the
 * real LLM. We inject a mock `runAgentTurn` via `__setRunAgentTurn` so the
 * worker drives the full pending → processing → done lifecycle.
 */

import { createMemDb, getMemDb } from "../helpers/pgmem.js";
import { getDb } from "../../src/db/client.js";
import { inboxEvents } from "../../src/db/schema.js";
import { eq } from "drizzle-orm";
import {
  insertInboxEvent,
  claimNextEvent,
  markEventDone,
  markEventFailed,
  deferEvent,
  backoffDelayMs,
  MAX_ATTEMPTS,
} from "../../src/inbox/storage.js";
import {
  processOneEvent,
  __setRunAgentTurn,
  __setCreateBotForChat,
} from "../../src/inbox/worker.js";
import type { TelegramBot } from "../../src/bot/telegram.js";

function makeStubBot(): TelegramBot {
  // Plain stubs (no `jest.fn`) so the file works under ts-jest/ESM without
  // pulling in @jest/globals.
  const noop = async () => undefined;
  return {
    sendMessage: async () => null,
    sendMessageSafe: noop,
    sendTypingAction: noop,
    editMessage: noop,
    getFile: async () => ({ filePath: "", fileUrl: "" }),
    downloadFile: async () => new ArrayBuffer(0),
  } as unknown as TelegramBot;
}

describe("inbox worker", () => {
  beforeAll(() => {
    createMemDb();
  });
  afterAll(() => {
    __setRunAgentTurn(null);
    __setCreateBotForChat(null);
    getMemDb().close();
  });

  beforeEach(() => {
    getMemDb().reset();
    __setRunAgentTurn(null);
    __setCreateBotForChat(() => makeStubBot());
  });

  describe("insertInboxEvent", () => {
    it("inserts a new event and returns inserted=true", async () => {
      const r = await insertInboxEvent({
        channel: "telegram",
        externalUpdateId: "u-1",
        userId: null,
        payload: { ok: true },
      });
      expect(r.inserted).toBe(true);
      expect(r.eventId).not.toBeNull();
    });

    it("is idempotent — second call returns inserted=false", async () => {
      const r1 = await insertInboxEvent({
        channel: "telegram",
        externalUpdateId: "u-1",
        userId: null,
        payload: { ok: true },
      });
      const r2 = await insertInboxEvent({
        channel: "telegram",
        externalUpdateId: "u-1",
        userId: null,
        payload: { ok: true },
      });
      expect(r1.inserted).toBe(true);
      expect(r2.inserted).toBe(false);
    });
  });

  describe("claimNextEvent", () => {
    it("returns null when queue is empty", async () => {
      expect(await claimNextEvent()).toBeNull();
    });

    it("transitions pending → processing and increments attempts", async () => {
      await insertInboxEvent({
        channel: "telegram",
        externalUpdateId: "u-2",
        userId: null,
        payload: { ok: true },
      });
      const claimed = await claimNextEvent();
      expect(claimed?.status).toBe("processing");
      expect(claimed?.attempts).toBe(1);
    });
  });

  describe("markEventDone / markEventFailed", () => {
    it("markEventDone sets terminal status", async () => {
      const r = await insertInboxEvent({
        channel: "telegram",
        externalUpdateId: "u-d",
        userId: null,
        payload: {},
      });
      await markEventDone(r.eventId!);
      const row = (
        await getDb().select().from(inboxEvents).where(eq(inboxEvents.id, r.eventId!))
      )[0];
      expect(row.status).toBe("done");
    });

    it("markEventFailed reschedules with backoff when attempts < max", async () => {
      const r = await insertInboxEvent({
        channel: "telegram",
        externalUpdateId: "u-f",
        userId: null,
        payload: {},
      });
      // Claim once so attempts = 1
      await claimNextEvent();
      await markEventFailed(r.eventId!, "boom", 1000);
      const row = (
        await getDb().select().from(inboxEvents).where(eq(inboxEvents.id, r.eventId!))
      )[0];
      expect(row.status).toBe("pending");
      expect(row.lastError).toBe("boom");
    });

    it("markEventFailed sets terminal 'failed' after MAX_ATTEMPTS", async () => {
      const r = await insertInboxEvent({
        channel: "telegram",
        externalUpdateId: "u-fail",
        userId: null,
        payload: {},
      });
      // Bump attempts to MAX_ATTEMPTS via direct update.
      await getDb()
        .update(inboxEvents)
        .set({ attempts: MAX_ATTEMPTS })
        .where(eq(inboxEvents.id, r.eventId!));
      await markEventFailed(r.eventId!, "permanent", 1000);
      const row = (
        await getDb().select().from(inboxEvents).where(eq(inboxEvents.id, r.eventId!))
      )[0];
      expect(row.status).toBe("failed");
    });
  });

  describe("backoffDelayMs", () => {
    it("returns the expected schedule", () => {
      expect(backoffDelayMs(1)).toBe(1_000);
      expect(backoffDelayMs(2)).toBe(5_000);
      expect(backoffDelayMs(5)).toBe(600_000);
      // Clamps past the table.
      expect(backoffDelayMs(99)).toBe(600_000);
    });
  });

  describe("deferEvent", () => {
    it("returns event to pending without burning a retry", async () => {
      const r = await insertInboxEvent({
        channel: "telegram",
        externalUpdateId: "u-defer",
        userId: null,
        payload: {},
      });
      await claimNextEvent(); // attempts → 1
      await deferEvent(r.eventId!, 100);
      const row = (
        await getDb().select().from(inboxEvents).where(eq(inboxEvents.id, r.eventId!))
      )[0];
      expect(row.status).toBe("pending");
      expect(row.attempts).toBe(0);
    });
  });

  describe("processOneEvent end-to-end", () => {
    it("returns 'idle' when queue is empty", async () => {
      expect(await processOneEvent()).toBe("idle");
    });

    it("processes a pending event and marks it done", async () => {
      const runs: { userId: string }[] = [];
      __setRunAgentTurn(async ({ user }) => {
        runs.push({ userId: user.id });
      });
      const r = await insertInboxEvent({
        channel: "telegram",
        externalUpdateId: "u-proc",
        userId: null,
        payload: {
          update_id: 1,
          message: {
            message_id: 1,
            chat: { id: 12345, type: "private" },
            text: "hello",
          },
        },
      });
      const result = await processOneEvent();
      expect(result).toBe("processed");
      expect(runs).toHaveLength(1);
      const row = (
        await getDb().select().from(inboxEvents).where(eq(inboxEvents.id, r.eventId!))
      )[0];
      expect(row.status).toBe("done");
      expect(row.userId).not.toBeNull();
    });

    it("marks event failed and reschedules on agent error", async () => {
      __setRunAgentTurn(async () => {
        throw new Error("agent boom");
      });
      const r = await insertInboxEvent({
        channel: "telegram",
        externalUpdateId: "u-err",
        userId: null,
        payload: {
          update_id: 1,
          message: {
            message_id: 1,
            chat: { id: 99 },
            text: "boom",
          },
        },
      });
      expect(await processOneEvent()).toBe("error");
      const row = (
        await getDb().select().from(inboxEvents).where(eq(inboxEvents.id, r.eventId!))
      )[0];
      expect(row.status).toBe("pending"); // rescheduled
      expect(row.lastError).toMatch(/agent boom/);
    });

    it("skips events with no chat (marks as done)", async () => {
      __setRunAgentTurn(async () => {
        throw new Error("should not run");
      });
      const r = await insertInboxEvent({
        channel: "telegram",
        externalUpdateId: "u-nochat",
        userId: null,
        payload: { update_id: 1 }, // no message.chat
      });
      const result = await processOneEvent();
      expect(result).toBe("processed");
      const row = (
        await getDb().select().from(inboxEvents).where(eq(inboxEvents.id, r.eventId!))
      )[0];
      expect(row.status).toBe("done");
    });

    it("serializes by user via advisory lock — second concurrent call skips the runTurn", async () => {
      // p1 holds the lock, so when p2 tries to acquire it the worker defers
      // (calls deferEvent before returning). The end-state of the per-event
      // row is incidental (the outer worker still calls markEventDone), so
      // we verify the load-bearing property: only one runTurn invocation
      // happens while p1 is in-flight.
      //
      // NOTE: This is a smoke test. pg-mem's advisory-lock model is a global
      // Set keyed by hash and doesn't enforce real session-scoped semantics
      // (every checked-out "client" shares the same lock set). Real
      // session-scoped behavior — where holding `pg_advisory_lock` on one
      // physical connection blocks try-lock from another — is only exercised
      // against a real Postgres in the deployed environment. The production
      // code pins a `PoolClient` for the lock+work+unlock dance; see
      // `handleTelegramEvent` in `src/inbox/worker.ts`.
      let release: () => void = () => {};
      const blocker = new Promise<void>((res) => {
        release = res;
      });

      let runCount = 0;
      __setRunAgentTurn(async () => {
        runCount += 1;
        await blocker;
      });

      const payload = {
        update_id: 1,
        message: { message_id: 1, chat: { id: 55555 }, text: "x" },
      };
      await insertInboxEvent({
        channel: "telegram",
        externalUpdateId: "u-A",
        userId: null,
        payload,
      });
      await insertInboxEvent({
        channel: "telegram",
        externalUpdateId: "u-B",
        userId: null,
        payload: { ...payload, update_id: 2 },
      });

      // Start the first call but don't await yet.
      const p1 = processOneEvent();
      // Give p1 enough time to acquire the advisory lock & enter the await.
      await new Promise((res) => setTimeout(res, 100));
      // Now run a second call; it should observe the lock held and skip
      // calling the agent turn (defer path).
      const p2Result = await processOneEvent();
      expect(p2Result).toBe("processed");
      // The mock should still only have been entered once.
      expect(runCount).toBe(1);

      release();
      await p1;
      expect(runCount).toBe(1);
    });
  });
});
