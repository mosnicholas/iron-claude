/**
 * Admin tier grant — bypass Stripe to set a user's tier directly.
 *
 * Usage:
 *   npm run grant-tier -- --phone +15555550123 --tier athlete
 *   npm run grant-tier -- --user-id <uuid>     --tier comped
 *
 * Sets `users.tier_overridden_by_admin = true` so the Stripe webhook won't
 * later "correct" it. Comped accounts use this; so do self-hosters who don't
 * want to wire up Stripe at all.
 */

import { eq } from "drizzle-orm";
import { getDb } from "../src/db/client.js";
import { users } from "../src/db/schema.js";
import { isTier, type Tier } from "../src/auth/tiers.js";

interface Args {
  phone?: string;
  userId?: string;
  tier: Tier;
}

function parseArgs(argv: string[]): Args {
  let phone: string | undefined;
  let userId: string | undefined;
  let tier: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--phone") phone = argv[++i];
    else if (a === "--user-id") userId = argv[++i];
    else if (a === "--tier") tier = argv[++i];
    else if (a === "--help" || a === "-h") {
      printUsageAndExit(0);
    }
  }
  if (!phone && !userId) {
    console.error("error: one of --phone or --user-id is required");
    printUsageAndExit(2);
  }
  if (phone && userId) {
    console.error("error: --phone and --user-id are mutually exclusive");
    printUsageAndExit(2);
  }
  if (!tier) {
    console.error("error: --tier is required");
    printUsageAndExit(2);
  }
  if (!isTier(tier)) {
    console.error(
      `error: --tier must be one of trial|regular|athlete|comped|expired (got ${tier})`
    );
    printUsageAndExit(2);
  }
  return { phone, userId, tier };
}

function printUsageAndExit(code: number): never {
  console.error(
    "Usage: npm run grant-tier -- (--phone +1... | --user-id <uuid>) --tier <trial|regular|athlete|comped>"
  );
  process.exit(code);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = getDb();

  const found = args.userId
    ? await db.select().from(users).where(eq(users.id, args.userId)).limit(1)
    : await db.select().from(users).where(eq(users.phoneE164, args.phone!)).limit(1);

  if (found.length === 0) {
    console.error(
      `error: no user found for ${args.userId ? `id=${args.userId}` : `phone=${args.phone}`}`
    );
    process.exit(1);
  }

  const before = found[0];
  console.log("Before:");
  console.log(`  id:        ${before.id}`);
  console.log(`  phone:     ${before.phoneE164}`);
  console.log(`  tier:      ${before.tier}`);
  console.log(`  overridden:${before.tierOverriddenByAdmin}`);
  console.log(`  trial_end: ${before.trialEndsAt.toISOString()}`);

  const [updated] = await db
    .update(users)
    .set({
      tier: args.tier,
      tierOverriddenByAdmin: true,
      updatedAt: new Date(),
    })
    .where(eq(users.id, before.id))
    .returning();

  console.log("After:");
  console.log(`  id:        ${updated.id}`);
  console.log(`  phone:     ${updated.phoneE164}`);
  console.log(`  tier:      ${updated.tier}`);
  console.log(`  overridden:${updated.tierOverriddenByAdmin}`);
}

main().catch((err) => {
  console.error("grant-tier failed:", err);
  process.exit(1);
});
