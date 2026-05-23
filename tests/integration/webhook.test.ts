/**
 * Telegram webhook integration tests.
 *
 * Covers the reliability fix for Bug 5 — the handler must return:
 *   - 500 when the inbox-row insert throws a transient DB error (Telegram
 *     retries; we don't want to lose the message).
 *   - 200 when the failure is pre-insert (no chat_id, secret mismatch).
 *   - 200 when the failure is permanent / unknown (avoids Telegram retry
 *     storms on programmer bugs).
 *
 * `insertInboxEvent` is mocked via `jest.unstable_mockModule` so we can
 * throw arbitrary errors from it without touching the real DB.
 */

import { jest } from "@jest/globals";

const insertInboxEventMock = jest.fn<
  (input: unknown) => Promise<{ inserted: boolean; eventId: string | null }>
>();

jest.unstable_mockModule("../../src/inbox/storage.js", () => ({
  insertInboxEvent: insertInboxEventMock,
  // Re-export the rest as no-ops so any indirect imports don't crash.
  MAX_ATTEMPTS: 5,
  claimNextEvent: async () => null,
  markEventDone: async () => undefined,
  markEventFailed: async () => undefined,
  deferEvent: async () => undefined,
  backoffDelayMs: () => 1000,
  getBacklogCount: async () => 0,
  reapStuckEvents: async () => 0,
  setEventUserId: async () => undefined,
}));

const { createMemDb, getMemDb } = await import("../helpers/pgmem.js");
const { webhookHandler, errorIsDbTransient } = await import("../../src/handlers/webhook.js");

interface FakeRes {
  statusCode: number;
  jsonBody: unknown;
  status(code: number): FakeRes;
  json(body: unknown): FakeRes;
}

function mkRes(): FakeRes {
  const r: FakeRes = {
    statusCode: 0,
    jsonBody: undefined,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.jsonBody = b;
      return this;
    },
  };
  return r;
}

function mkReq(
  body: unknown,
  headers: Record<string, string> = {}
): Parameters<typeof webhookHandler>[0] {
  return {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": "test-secret", ...headers },
    body,
  } as unknown as Parameters<typeof webhookHandler>[0];
}

describe("POST /webhook", () => {
  const ORIG_ENV = { ...process.env };

  beforeAll(() => {
    createMemDb();
  });
  afterAll(() => {
    process.env = ORIG_ENV;
    getMemDb().close();
  });

  beforeEach(() => {
    getMemDb().reset();
    insertInboxEventMock.mockReset();
    process.env = { ...ORIG_ENV };
    // Webhook secret must be set so verifyTelegramSecret accepts the test header.
    process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
  });

  it("returns 200 on a happy-path insert", async () => {
    insertInboxEventMock.mockResolvedValueOnce({ inserted: true, eventId: "evt-1" });
    const res = mkRes();
    await webhookHandler(
      mkReq({
        update_id: 1,
        message: { message_id: 1, chat: { id: 1001 }, text: "hi" },
      }),
      res as never
    );
    expect(res.statusCode).toBe(200);
    expect(insertInboxEventMock).toHaveBeenCalledTimes(1);
  });

  it("returns 200 with no retries on a pre-insert error (no chat_id)", async () => {
    const res = mkRes();
    await webhookHandler(
      mkReq({ update_id: 2 /* no message */ }),
      res as never
    );
    expect(res.statusCode).toBe(200);
    expect(insertInboxEventMock).not.toHaveBeenCalled();
  });

  it("returns 401 on missing/wrong secret (no retry needed)", async () => {
    const res = mkRes();
    await webhookHandler(
      mkReq(
        { update_id: 3, message: { message_id: 1, chat: { id: 999 }, text: "x" } },
        { "x-telegram-bot-api-secret-token": "WRONG" }
      ),
      res as never
    );
    expect(res.statusCode).toBe(401);
    expect(insertInboxEventMock).not.toHaveBeenCalled();
  });

  it("returns 500 when insertInboxEvent throws a connection error (Telegram retries)", async () => {
    const connErr = Object.assign(new Error("Connection terminated unexpectedly"), {
      code: "ECONNREFUSED",
    });
    insertInboxEventMock.mockRejectedValueOnce(connErr);

    const res = mkRes();
    await webhookHandler(
      mkReq({
        update_id: 4,
        message: { message_id: 1, chat: { id: 7777 }, text: "blip" },
      }),
      res as never
    );
    expect(res.statusCode).toBe(500);
  });

  it("returns 500 when the error is a generic 'Connection terminated' message", async () => {
    insertInboxEventMock.mockRejectedValueOnce(new Error("Connection terminated"));
    const res = mkRes();
    await webhookHandler(
      mkReq({
        update_id: 5,
        message: { message_id: 1, chat: { id: 7778 }, text: "blip" },
      }),
      res as never
    );
    expect(res.statusCode).toBe(500);
  });

  it("returns 200 when the error is permanent / unrecognized (no retry storm)", async () => {
    insertInboxEventMock.mockRejectedValueOnce(new Error("TypeError: foo is undefined"));
    const res = mkRes();
    await webhookHandler(
      mkReq({
        update_id: 6,
        message: { message_id: 1, chat: { id: 7779 }, text: "blip" },
      }),
      res as never
    );
    expect(res.statusCode).toBe(200);
  });

  it("errorIsDbTransient classifies known shapes", () => {
    expect(errorIsDbTransient(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).toBe(true);
    expect(errorIsDbTransient(Object.assign(new Error("x"), { code: "57P01" }))).toBe(true);
    expect(errorIsDbTransient(new Error("Connection terminated unexpectedly"))).toBe(true);
    expect(errorIsDbTransient(new Error("server closed the connection"))).toBe(true);
    expect(errorIsDbTransient(new Error("TypeError: foo is undefined"))).toBe(false);
    expect(errorIsDbTransient(null)).toBe(false);
    expect(errorIsDbTransient(undefined)).toBe(false);
    expect(errorIsDbTransient("string error")).toBe(false);
  });
});
