/**
 * Backfill `integration_tokens.external_user_id` for existing Whoop rows.
 *
 * Context: before the OAuth callback was fixed to capture the Whoop `user_id`,
 * we persisted tokens with `external_user_id = NULL`. Inbound Whoop webhooks
 * identify the user only by that id, so without it the handler drops every
 * event as "no linked user". Any operator who OAuthed before the fix needs
 * their existing row updated in place — we can do that by decrypting their
 * access token, calling Whoop's profile endpoint, and writing the result back.
 *
 * Usage:
 *   npm run backfill:whoop-ids
 *   npm run backfill:whoop-ids -- --dry-run
 *
 * The script is idempotent: rows that already have `external_user_id` set are
 * skipped, so re-running is safe.
 */

import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../src/db/client.js";
import { integrationTokens } from "../src/db/schema.js";
import { decryptSecret } from "../src/crypto/secrets.js";
import { WhoopClient } from "../src/integrations/whoop/client.js";
import {
  refreshAccessToken,
  isTokenExpired,
  persistTokens,
} from "../src/integrations/whoop/oauth.js";

interface Args {
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  return { dryRun: argv.includes("--dry-run") };
}

async function main(): Promise<void> {
  const { dryRun } = parseArgs(process.argv.slice(2));
  const db = getDb();

  const rows = await db
    .select()
    .from(integrationTokens)
    .where(and(eq(integrationTokens.provider, "whoop"), isNull(integrationTokens.externalUserId)));

  console.log(
    `[backfill] Found ${rows.length} Whoop row(s) without external_user_id${
      dryRun ? " (dry run)" : ""
    }`
  );

  let updated = 0;
  let failed = 0;

  for (const row of rows) {
    if (!row.accessTokenEnc || !row.refreshTokenEnc) {
      console.warn(`[backfill] Skipping user=${row.userId}: missing encrypted tokens`);
      failed++;
      continue;
    }

    try {
      let accessToken = decryptSecret(row.accessTokenEnc);
      const refreshToken = decryptSecret(row.refreshTokenEnc);
      const expiresAt = row.expiresAt ? row.expiresAt.getTime() : 0;
      let tokens = { accessToken, refreshToken, expiresAt };

      // Refresh first if the stored access token is already expired, otherwise
      // the profile call will 401. We use the same refresh helper the runtime
      // does, so the refresh-token-rotation dedupe still applies.
      if (isTokenExpired(tokens)) {
        console.log(`[backfill] user=${row.userId}: access token expired, refreshing...`);
        tokens = await refreshAccessToken(row.userId, tokens.refreshToken);
        if (!dryRun) {
          // Persist the rotated tokens — preserve null external_user_id for
          // now; we'll write it on the next upsert below.
          await persistTokens(row.userId, tokens, null);
        }
        accessToken = tokens.accessToken;
      }

      const client = new WhoopClient(row.userId, tokens);
      const profile = await client.getUser();
      const externalUserId = String(profile.user_id);

      console.log(
        `[backfill] user=${row.userId} → whoop user_id=${externalUserId} (${profile.email})`
      );

      if (!dryRun) {
        await db
          .update(integrationTokens)
          .set({ externalUserId, updatedAt: new Date() })
          .where(eq(integrationTokens.id, row.id));
      }
      updated++;
    } catch (err) {
      console.error(`[backfill] user=${row.userId} FAILED:`, err);
      failed++;
    }
  }

  console.log(
    `[backfill] Done. updated=${updated} failed=${failed} total=${rows.length}${
      dryRun ? " (dry run — no writes)" : ""
    }`
  );

  // Exit explicitly so any pending DB pool sockets don't hold the process open.
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[backfill] fatal:", err);
  process.exit(1);
});
