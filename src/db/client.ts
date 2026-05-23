/**
 * Postgres connection pool + Drizzle client.
 *
 * Used by the Storage layer (src/storage/db.ts), the inbox worker, cron jobs,
 * and the importer. All callers share one pool per process.
 */

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

// Tests inject a Pool pointed at the testcontainers Postgres via
// `__setTestPool()`. When set, both `getPool()` and `getDb()` use it.
let testPool: Pool | null = null;
let pool: Pool | null = null;
let cachedDb: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getPool(): Pool {
  if (testPool) return testPool;
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  pool = new Pool({ connectionString, max: 10 });
  return pool;
}

export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (cachedDb) return cachedDb;
  cachedDb = drizzle(getPool(), { schema });
  return cachedDb;
}

export type Db = ReturnType<typeof getDb>;

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    cachedDb = null;
  }
}

/**
 * Test-only: install a Pool (typically the testcontainers PG from
 * `tests/helpers/realpg.ts`) and reset the cached Drizzle client so subsequent
 * `getDb()` calls return a client bound to it. Pass `null` to clear.
 */
export function __setTestPool(testPoolArg: Pool | null): void {
  testPool = testPoolArg;
  cachedDb = null;
}
