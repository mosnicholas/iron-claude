/**
 * Shared real-Postgres test helper.
 *
 * Replaces tests/helpers/pgmem.ts. One Postgres container per `jest`
 * invocation (booted via jest.config.js's `globalSetup`); each test file
 * uses `createMemDb()` to install the cached pool into the app's
 * `getPool()` factory, and `getMemDb().reset()` to truncate between
 * tests.
 *
 * The `MemDb` name is a misnomer post-migration but preserved so the
 * ~12 existing test files don't need rewrites. Same surface, different
 * substrate: real Postgres semantics for SKIP LOCKED, partial unique
 * indexes, session-scoped advisory locks, ON CONFLICT, etc.
 *
 * Env vars (set by jest-global-setup.ts):
 *   - DATABASE_URL: the testcontainers-provisioned or CI-service-container PG.
 *   - E2E_PG_URL: in CI, points at the workflow's `postgres:18-alpine`
 *     service container instead of nesting Docker via testcontainers.
 */

import { Pool, type PoolClient } from "pg";
import { __setTestPool } from "../../src/db/client.js";
import { __resetStorageCache } from "../../src/storage/db.js";
import { users } from "../../src/db/schema.js";
import { getDb } from "../../src/db/client.js";

const APP_TABLES = [
  "users",
  "channel_identities",
  "profiles",
  "learnings",
  "prs",
  "workouts",
  "workout_exercises",
  "workout_sets",
  "weekly_plans",
  "weekly_retros",
  "messages",
  "conversation_summaries",
  "reminders",
  "integration_tokens",
  "integration_metrics",
  "inbox_events",
  "tool_call_log",
  "photos",
  "meals",
  "meal_items",
  "stripe_events",
];

export interface MemDbHandle {
  pool: Pool;
  /** Truncate every app table. Returns a Promise so jest awaits it. */
  reset(): Promise<void>;
  close(): Promise<void>;
  /** Legacy no-op — real PG uses session-scoped advisory locks. */
  clearLocks(): void;
}

let currentHandle: MemDbHandle | null = null;
let cachedPool: Pool | null = null;

function getOrCreatePool(): Pool {
  if (cachedPool) return cachedPool;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. tests/helpers/jest-global-setup.ts should have configured it before any test imports."
    );
  }
  cachedPool = new Pool({ connectionString: url, max: 5 });
  return cachedPool;
}

/**
 * Install the real-PG pool into the app's `getPool()` factory. Drop-in
 * replacement for the pg-mem version — same signature so existing tests
 * keep compiling.
 */
export function createMemDb(): MemDbHandle {
  const pool = getOrCreatePool();
  __setTestPool(pool);
  __resetStorageCache();

  const handle: MemDbHandle = {
    pool,
    async reset(): Promise<void> {
      await truncateAll(pool);
      __resetStorageCache();
    },
    async close(): Promise<void> {
      __setTestPool(null);
      __resetStorageCache();
      currentHandle = null;
      // Don't end the pool — globalTeardown owns its lifecycle.
    },
    clearLocks(): void {
      // No-op: real PG advisory locks are session-scoped; reset truncates
      // the row state, and any held lock on the same connection is released
      // when the pool client returns. Kept for API compat with the pg-mem
      // version.
    },
  };
  currentHandle = handle;
  return handle;
}

export function getMemDb(): MemDbHandle {
  if (!currentHandle) {
    throw new Error("createMemDb() must be called before getMemDb()");
  }
  return currentHandle;
}

async function truncateAll(pool: Pool): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    const tableList = APP_TABLES.map((t) => `"${t}"`).join(", ");
    await client.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
    // pg-boss schema may or may not exist depending on whether the test
    // file booted the queue. Best-effort wipe.
    await client
      .query(
        `TRUNCATE TABLE pgboss.job, pgboss.schedule RESTART IDENTITY CASCADE`
      )
      .catch(() => {
        /* pgboss schema not yet created in this run — fine */
      });
  } finally {
    client.release();
  }
}

/**
 * Seed a `users` row directly via Drizzle. Same signature as the pg-mem
 * version so existing tests keep working without changes.
 */
export async function seedUser(
  overrides: { phoneE164?: string; displayName?: string; timezone?: string } = {}
): Promise<string> {
  const db = getDb();
  const [u] = await db
    .insert(users)
    .values({
      phoneE164: overrides.phoneE164 ?? `+1555${randomDigits()}`,
      displayName: overrides.displayName,
      timezone: overrides.timezone ?? "America/New_York",
    })
    .returning({ id: users.id });
  return u.id;
}

let digitCounter = 0;
function randomDigits(): string {
  const n = (Date.now() + ++digitCounter) % 10_000_000;
  return n.toString().padStart(7, "0");
}
