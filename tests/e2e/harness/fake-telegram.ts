/**
 * Fake Telegram Bot API.
 *
 * Spins up an HTTP server on a random localhost port that mimics the
 * Telegram Bot API endpoints our code calls. Production points at
 * `https://api.telegram.org`; tests set `TELEGRAM_API_BASE_URL=http://127.0.0.1:<port>`
 * via the harness before the bot module's `telegramApiBase()` reads it.
 *
 * Records every outbound call so tests can assert on what the bot tried
 * to send.
 */

import http from "http";
import { AddressInfo } from "net";

export interface RecordedCall {
  method: string;
  body: Record<string, unknown>;
  /** Telegram's mock-assigned message_id; useful for editMessage flows. */
  messageId?: number;
}

export class FakeTelegram {
  private server: http.Server | null = null;
  /** Every outbound call from src/bot/telegram.ts is recorded here. */
  public readonly calls: RecordedCall[] = [];
  private nextMessageId = 1000;

  async start(): Promise<{ url: string }> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handle(req, res));
      this.server.on("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        const { port } = this.server!.address() as AddressInfo;
        resolve({ url: `http://127.0.0.1:${port}` });
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) => {
      this.server!.close((err) => (err ? reject(err) : resolve()));
    });
    this.server = null;
  }

  /** Clear recorded calls between tests without restarting the server. */
  reset(): void {
    this.calls.length = 0;
  }

  /** Convenience: the most recent recorded call, throws if none. */
  last(): RecordedCall {
    if (this.calls.length === 0) throw new Error("FakeTelegram: no calls recorded");
    return this.calls[this.calls.length - 1];
  }

  /** All calls to a given Bot API method (e.g. "sendMessage"). */
  callsTo(method: string): RecordedCall[] {
    return this.calls.filter((c) => c.method === method);
  }

  /** Concatenated text of every outbound `sendMessage` / `sendFormattedMessage`. */
  sentText(): string {
    return this.callsTo("sendMessage")
      .map((c) => (c.body.text as string) ?? "")
      .join("\n");
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    // URL shape: /bot<TOKEN>/<method>  (or with optional :test suffix on token)
    const match = /^\/bot[^/]+\/(.+?)\/?$/.exec(req.url ?? "");
    if (!match) {
      res.statusCode = 404;
      res.end("not a Telegram-style URL");
      return;
    }
    const method = match[1];

    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      let body: Record<string, unknown> = {};
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (raw) body = JSON.parse(raw);
      } catch {
        // Some Telegram methods use form-encoded; for our flows it's always JSON.
      }

      const recorded: RecordedCall = { method, body };

      // Synthesize a Telegram-shaped response. message_id increments per
      // sendMessage / editMessageText so editor flows can find their target.
      let resultPayload: Record<string, unknown> = { ok: true };
      if (method === "sendMessage" || method === "sendFormattedMessage") {
        const messageId = this.nextMessageId++;
        recorded.messageId = messageId;
        resultPayload = { ok: true, result: { message_id: messageId } };
      } else if (method === "editMessageText") {
        resultPayload = { ok: true, result: { message_id: body.message_id } };
      } else if (method === "sendChatAction") {
        resultPayload = { ok: true, result: true };
      } else if (method === "getFile") {
        // Tests that exercise the photo path will override this via a custom
        // handler; default returns a dummy file_path.
        resultPayload = {
          ok: true,
          result: {
            file_id: body.file_id,
            file_unique_id: "u_fake",
            file_size: 100,
            file_path: "photos/file_fake.jpg",
          },
        };
      } else if (method === "setWebhook" || method === "deleteWebhook") {
        resultPayload = { ok: true, result: true };
      }

      this.calls.push(recorded);
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(resultPayload));
    });
  }
}
