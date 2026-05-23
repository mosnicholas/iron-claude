/**
 * Test-only helper: invoke a per-user cron processor for every active user.
 *
 * The production code runs these processors via pg-boss (`src/jobs/`); tests
 * bypass that machinery and drive the processors directly. Mirrors the
 * runner.ts pattern from before the pg-boss migration so existing tests
 * don't need a rewrite.
 */

import { listActiveUsers } from "../../src/auth/identity.js";
import { getStorage } from "../../src/storage/db.js";
import { sendBotMessageForUser } from "../../src/bot/telegram-for-user.js";
import type { JobCtx } from "../../src/jobs/handlers.js";

export interface ManualCronResult {
  success: boolean;
  message?: string;
  error?: string;
}

export async function runForEachUser(
  fn: (ctx: JobCtx) => Promise<ManualCronResult>,
  options: { requireProfile?: boolean } = {}
): Promise<ManualCronResult> {
  const { requireProfile = true } = options;
  const storage = getStorage();
  const users = await listActiveUsers();
  if (users.length === 0) return { success: true, message: "no users" };

  let ok = 0;
  let skip = 0;
  let fail = 0;
  const perUserMessages: string[] = [];
  const failures: string[] = [];

  for (const user of users) {
    try {
      if (requireProfile) {
        const profile = await storage.readProfile(user.id);
        if (!profile) {
          skip += 1;
          continue;
        }
      }
      const result = await fn({
        user,
        storage,
        sendMessage: (text) => sendBotMessageForUser(user, text),
      });
      if (result.success) {
        ok += 1;
        if (result.message) perUserMessages.push(result.message);
      } else {
        fail += 1;
        failures.push(`${user.id}: ${result.error ?? "unknown"}`);
      }
    } catch (err) {
      fail += 1;
      failures.push(`${user.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const summary = `users=${users.length} ok=${ok} skip=${skip} fail=${fail}`;
  const message =
    perUserMessages.length === 1
      ? perUserMessages[0]
      : perUserMessages.length > 1
        ? `${summary}\n${perUserMessages.join("\n")}`
        : summary;
  return {
    success: fail === 0,
    message,
    error: failures.length ? failures.join("; ") : undefined,
  };
}
