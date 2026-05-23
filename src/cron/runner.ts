/**
 * Cron Task Runner
 *
 * Shared boilerplate for all per-user cron jobs: iterates active users, runs
 * the handler against each, captures errors per-user so one bad user doesn't
 * stop the rest.
 */

import { getStorage } from "../storage/db.js";
import type { Storage } from "../storage/storage.js";
import type { User } from "../db/schema.js";
import { listActiveUsers } from "../auth/identity.js";
import { sendBotMessageForUser } from "../bot/telegram-for-user.js";
import { captureError } from "../observability/sentry.js";

export interface CronResult {
  success: boolean;
  message?: string;
  error?: string;
}

export interface PerUserCronContext {
  user: User;
  storage: Storage;
  sendMessage: (text: string) => Promise<void>;
}

/**
 * Run a cron task for every active user in the DB. Each user's handler runs
 * in isolation — a failure on one user is captured to Sentry and the loop
 * continues.
 */
export async function runCronForEachUser(
  name: string,
  handler: (ctx: PerUserCronContext) => Promise<CronResult>,
  options?: { requireProfile?: boolean; errorMessage?: string }
): Promise<CronResult> {
  const { requireProfile = true, errorMessage } = options ?? {};
  console.log(`[${name}] Starting per-user cron`);

  const storage = getStorage();
  const users = await listActiveUsers();
  if (users.length === 0) {
    console.log(`[${name}] No active users; nothing to do`);
    return { success: true, message: "No active users" };
  }

  let okCount = 0;
  let skipCount = 0;
  let failCount = 0;
  const failures: string[] = [];
  const perUserMessages: string[] = [];

  for (const user of users) {
    try {
      if (requireProfile) {
        const profile = await storage.readProfile(user.id);
        if (!profile) {
          console.log(`[${name}] user=${user.id} no profile, skipping`);
          skipCount += 1;
          continue;
        }
      }

      const result = await handler({
        user,
        storage,
        sendMessage: (text) => sendBotMessageForUser(user, text),
      });
      if (result.success) {
        okCount += 1;
        if (result.message) perUserMessages.push(result.message);
      } else {
        failCount += 1;
        failures.push(`${user.id}: ${result.error ?? "unknown"}`);
      }
    } catch (err) {
      failCount += 1;
      failures.push(`${user.id}: ${err instanceof Error ? err.message : String(err)}`);
      captureError(err, { userId: user.id, handler: name });
      if (errorMessage) {
        try {
          await sendBotMessageForUser(user, `⚠️ ${errorMessage}`);
        } catch {
          /* swallow */
        }
      }
    }
  }

  const summary = `users=${users.length} ok=${okCount} skip=${skipCount} fail=${failCount}`;
  console.log(`[${name}] ${summary}`);
  // Surface per-user messages so callers / tests can see what actually
  // happened (e.g. "Sent 1/1 reminder" for check-reminders). When there's
  // exactly one successful user, bubble their message verbatim; otherwise
  // include both the aggregate summary and the per-user lines.
  const message =
    perUserMessages.length === 1
      ? perUserMessages[0]
      : perUserMessages.length > 1
        ? `${summary}\n${perUserMessages.join("\n")}`
        : summary;
  return {
    success: failCount === 0,
    message,
    error: failures.length ? failures.join("; ") : undefined,
  };
}
