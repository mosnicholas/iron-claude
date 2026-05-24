/**
 * E2E test harness — one-stop shop for spinning up the full IronClaude stack
 * against real Postgres + a fake Telegram + real Anthropic.
 *
 * Lifecycle:
 *
 *   const env = await E2EHarness.start();   // testcontainers PG, fake telegram,
 *                                            // server + workers, deterministic auth
 *   try {
 *     await env.beforeEach();               // truncate tables + reset recorders
 *     // ... test code ...
 *   } finally {
 *     await env.stop();
 *   }
 *
 * The harness intentionally does NOT mock the LLM. Tests that need
 * deterministic responses script the user's input carefully and assert on
 * structural facts (DB rows, recorded Telegram calls) rather than on the
 * model's exact wording.
 *
 * On any unhandled assertion failure inside a test, call `env.printTimeline()`
 * to dump the last N recorded events — the failure printer for the
 * agent feedback loop.
 */

import type { Express } from "express";
import type { Server } from "http";
import { AddressInfo } from "net";

import { createApp, startBackgroundWorkers, type BackgroundWorkers } from "../../../src/boot.js";
import { closeDb } from "../../../src/db/client.js";
import { startTestPostgres, type E2EPostgres } from "./postgres.js";
import { FakeTelegram } from "./fake-telegram.js";
import { Recorder } from "./recorder.js";
import {
  installFakeSupabase,
  uninstallFakeSupabase,
  mintTestJwt,
} from "./fake-supabase.js";
import { buildSignedStripeEvent, type StripeEventOpts } from "./fake-stripe.js";
import { buildSignedWhoopEvent, type WhoopEventOpts } from "./fake-whoop.js";

const STRIPE_TEST_SECRET = "whsec_e2e_test_secret";
const WHOOP_TEST_SECRET = "whoop_e2e_test_secret";

export class E2EHarness {
  private pg!: E2EPostgres;
  private fakeTelegram!: FakeTelegram;
  private app!: Express;
  private server!: Server;
  private serverUrl!: string;
  private workers!: BackgroundWorkers;
  recorder = new Recorder();

  static async start(): Promise<E2EHarness> {
    const h = new E2EHarness();
    await h.boot();
    return h;
  }

  private async boot(): Promise<void> {
    // 1. Postgres.
    this.pg = await startTestPostgres();
    process.env.DATABASE_URL = this.pg.url;

    // 2. Fake Telegram first so we know the URL before any code touches the
    //    bot module.
    this.fakeTelegram = new FakeTelegram();
    const { url: tgUrl } = await this.fakeTelegram.start();
    process.env.TELEGRAM_API_BASE_URL = tgUrl;

    // 3. Mandatory env for the bot/inbox to start cleanly. Real values for
    //    these come from the test runner env (.env.test, CI secrets) or
    //    sensible defaults below.
    process.env.TELEGRAM_BOT_TOKEN ??= "e2e:test-token";
    process.env.TELEGRAM_WEBHOOK_SECRET ??= "e2e-test-secret";
    process.env.INTEGRATION_TOKEN_KEY ??= Buffer.alloc(32, 1).toString("base64");
    process.env.SESSION_SECRET ??= "e2e-session-secret-must-be-32-chars-long-aaaaaaaaaaa";
    process.env.STRIPE_WEBHOOK_SECRET = STRIPE_TEST_SECRET;
    process.env.WHOOP_WEBHOOK_SECRET = WHOOP_TEST_SECRET;
    // CHECKOUT_URL — the tier-gate uses it; harmless default is fine.
    process.env.CHECKOUT_URL ??= "https://example.com/billing";

    // 4. Fake Supabase auth — installs jwt verifier override.
    installFakeSupabase();

    // 5. App + background workers (inbox worker; pg-boss with NO schedules
    //    so cron firings don't pollute tests).
    this.app = createApp();
    this.server = this.app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => this.server.once("listening", () => r()));
    const { port } = this.server.address() as AddressInfo;
    this.serverUrl = `http://127.0.0.1:${port}`;
    this.workers = await startBackgroundWorkers({ skipSchedules: true });
  }

  async stop(): Promise<void> {
    // The Whoop webhook handler kicks off `processWebhookAsync` fire-and-forget
    // after sending its 200. If we tear down the app while that's still
    // running, the resulting console.* call lands after jest considers the
    // test finished and triggers "Cannot log after tests are done" warnings
    // (and on some CI runners a non-zero exit). Give in-flight async work a
    // tick to settle before we yank the DB / supabase shim out from under it.
    await new Promise<void>((r) => setTimeout(r, 500));

    try {
      await this.workers.stop();
    } catch (err) {
      console.error("[harness] worker shutdown failed:", err);
    }
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    await this.fakeTelegram.stop();
    await closeDb();
    await this.pg.stop();
    uninstallFakeSupabase();
  }

  /** Truncate app + pgboss tables and reset in-memory recorders. */
  async beforeEach(): Promise<void> {
    await this.pg.reset();
    this.fakeTelegram.reset();
    this.recorder.reset();
  }

  // ── Public surface for tests ────────────────────────────────────────────

  /** URL of the running server (e.g. http://127.0.0.1:54321). */
  get url(): string {
    return this.serverUrl;
  }

  /** Recorded Telegram outbound calls + helpers. */
  get telegram(): FakeTelegram {
    return this.fakeTelegram;
  }

  /** Mint a Supabase-equivalent JWT for use in Authorization headers. */
  authToken(opts: { supabaseUserId: string; phone?: string }): string {
    return mintTestJwt(opts);
  }

  // ── Telegram helpers ────────────────────────────────────────────────────

  /**
   * Send a Telegram webhook update to /api/webhook. Mirrors what real
   * Telegram would POST when a user types a message.
   */
  async sendTelegramUpdate(opts: {
    updateId?: number;
    chatId: number | string;
    text?: string;
    caption?: string;
    photoFileId?: string;
  }): Promise<{ status: number; body: unknown }> {
    const updateId = opts.updateId ?? Math.floor(Date.now() % 1_000_000_000);
    const message: Record<string, unknown> = {
      message_id: updateId,
      chat: { id: Number(opts.chatId) },
    };
    if (opts.text) message.text = opts.text;
    if (opts.caption) message.caption = opts.caption;
    if (opts.photoFileId) {
      message.photo = [
        { file_id: opts.photoFileId, file_unique_id: "u1", width: 100, height: 100 },
      ];
    }
    const body = { update_id: updateId, message };
    this.recorder.push("telegram.in", { chatId: opts.chatId, text: opts.text ?? "" });
    return this.post("/api/webhook", body, {
      "x-telegram-bot-api-secret-token": process.env.TELEGRAM_WEBHOOK_SECRET!,
    });
  }

  // ── Stripe / Whoop webhook senders ──────────────────────────────────────

  async sendStripeWebhook(opts: StripeEventOpts): Promise<{ status: number; body: unknown }> {
    const signed = buildSignedStripeEvent(STRIPE_TEST_SECRET, opts);
    this.recorder.push("stripe.in", { type: opts.type, id: signed.event.id });
    const res = await fetch(`${this.serverUrl}/api/stripe/webhook`, {
      method: "POST",
      headers: {
        "stripe-signature": signed.signature,
        "content-type": "application/json",
      },
      body: signed.body,
    });
    const body = await safeJson(res);
    return { status: res.status, body };
  }

  async sendWhoopWebhook(
    device: "whoop",
    opts: WhoopEventOpts
  ): Promise<{ status: number; body: unknown }> {
    const signed = buildSignedWhoopEvent(WHOOP_TEST_SECRET, opts);
    this.recorder.push("whoop.in", { type: opts.type, resourceId: opts.resourceId });
    const res = await fetch(`${this.serverUrl}/api/integrations/${device}/webhook`, {
      method: "POST",
      headers: {
        "x-whoop-signature": signed.signature,
        "x-whoop-signature-timestamp": signed.timestamp,
        "content-type": "application/json",
      },
      body: signed.body,
    });
    const body = await safeJson(res);
    return { status: res.status, body };
  }

  // ── Generic HTTP helpers ────────────────────────────────────────────────

  async get(
    path: string,
    headers: Record<string, string> = {}
  ): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`${this.serverUrl}${path}`, { headers });
    return { status: res.status, body: await safeJson(res) };
  }

  async post(
    path: string,
    body: unknown,
    headers: Record<string, string> = {}
  ): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`${this.serverUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await safeJson(res) };
  }

  /** Dump the recent timeline to stderr — call from afterEach on failure. */
  printTimeline(label = ""): void {
    const prefix = label ? `[E2E TIMELINE — ${label}]` : "[E2E TIMELINE — last events]";
    process.stderr.write(`\n${prefix}\n${this.recorder.format(15)}\n\n`);
  }
}

async function safeJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export { mintTestJwt };
