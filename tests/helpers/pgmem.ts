/**
 * pg-mem helper: spins up an in-memory Postgres, applies Drizzle migrations,
 * and exposes a thin `Pool`-shaped adapter so the existing `src/db/client.ts`
 * machinery can be reused unchanged.
 *
 * pg-mem's stock pg adapter doesn't support drizzle's prepared-statement
 * shape (`types.getTypeParser`, `rowMode: "array"`, etc.). We bypass it and
 * drive `mem.public.query` directly — inlining `$N` params as SQL literals
 * and re-shaping rows as arrays when drizzle asks for array mode.
 */

import { EventEmitter } from "events";
import { readFileSync } from "fs";
import { join } from "path";
import { newDb, type IMemoryDb } from "pg-mem";
import { __setTestPool, getDb } from "../../src/db/client.js";
import { __resetStorageCache } from "../../src/storage/db.js";

const MIGRATION_PATH = join(
  process.cwd(),
  "drizzle",
  "0000_mature_sir_ram.sql"
);

// Locks are global to a pg-mem instance — they model `pg_advisory_lock` which
// in production is per-database. Held across queries on the same instance.
function createAdvisoryLocks() {
  const held = new Set<number>();
  return {
    tryLock(key: number): boolean {
      if (held.has(key)) return false;
      held.add(key);
      return true;
    },
    unlock(key: number): boolean {
      if (!held.has(key)) return false;
      held.delete(key);
      return true;
    },
    clear(): void {
      held.clear();
    },
  };
}

function toLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return String(v);
  if (typeof v === "bigint") return String(v);
  if (v instanceof Date) return `'${v.toISOString()}'::timestamptz`;
  if (Array.isArray(v)) return `ARRAY[${v.map(toLiteral).join(",")}]`;
  if (typeof v === "object") {
    return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  }
  return `'${String(v).replace(/'/g, "''")}'`;
}

function substParams(sqlText: string, params: readonly unknown[]): string {
  return sqlText.replace(/\$(\d+)/g, (_m, n) =>
    toLiteral(params[parseInt(n, 10) - 1])
  );
}

function runQuery(
  db: IMemoryDb,
  sqlText: string,
  params: readonly unknown[] = [],
  arrayMode = false
) {
  const text = params.length > 0 ? substParams(sqlText, params) : sqlText;
  const result = db.public.query(text);
  const fields = (result.fields ?? []).map((f) => ({ name: f.name }));
  const rows = arrayMode
    ? result.rows.map((row: Record<string, unknown>) =>
        fields.map((f) => row[f.name])
      )
    : result.rows;
  return {
    command: result.command,
    rowCount: result.rowCount,
    fields,
    rows,
  };
}

/**
 * Pool-shaped wrapper around an `IMemoryDb`. Implements the subset of `pg.Pool`
 * that Drizzle's node-postgres driver actually uses.
 */
class MemPool extends EventEmitter {
  totalCount = 1;
  idleCount = 1;
  waitingCount = 0;
  constructor(private mem: IMemoryDb) {
    super();
  }
  async query(config: unknown, paramsArg?: unknown[]) {
    if (typeof config === "string") {
      return runQuery(this.mem, config, paramsArg ?? [], false);
    }
    const c = config as {
      text: string;
      values?: unknown[];
      rowMode?: string;
    };
    return runQuery(
      this.mem,
      c.text,
      c.values ?? paramsArg ?? [],
      c.rowMode === "array"
    );
  }
  async connect() {
    const self = this;
    return {
      query: self.query.bind(self),
      release: () => {},
      on: () => {},
    };
  }
  async end(): Promise<void> {}
  on(): this {
    return this;
  }
}

export interface MemDbHandle {
  mem: IMemoryDb;
  pool: MemPool;
  /** Reset the database to its post-migration state (fast, no re-parse). */
  reset(): void;
  /** Tear down: clear the cached drizzle client & test pool. */
  close(): void;
  /** Clear all advisory locks (call between subtests if you held any). */
  clearLocks(): void;
}

let currentBackup: ReturnType<IMemoryDb["backup"]> | null = null;
let currentHandle: MemDbHandle | null = null;
let currentLocks: ReturnType<typeof createAdvisoryLocks> | null = null;

/**
 * Build a fresh in-memory database with the Drizzle migration applied. Installs
 * it as the global test pool so existing `getDb()` / `DbStorage` callers use
 * it without modification.
 */
export function createMemDb(): MemDbHandle {
  const mem = newDb({ autoCreateForeignKeyIndices: true });
  const locks = createAdvisoryLocks();
  currentLocks = locks;

  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: { kind: "named", name: "uuid" as never } as never,
    impure: true,
    implementation: () => crypto.randomUUID(),
  } as never);
  mem.public.registerFunction({
    name: "hashtext",
    args: ["text" as never],
    returns: { kind: "named", name: "integer" as never } as never,
    implementation: (s: string) => {
      let h = 0;
      for (let i = 0; i < s.length; i++) {
        h = (h * 31 + s.charCodeAt(i)) | 0;
      }
      return h;
    },
  } as never);
  mem.public.registerFunction({
    name: "pg_try_advisory_lock",
    args: ["bigint" as never],
    returns: { kind: "named", name: "boolean" as never } as never,
    impure: true,
    implementation: (key: unknown) => locks.tryLock(Number(key)),
  } as never);
  mem.public.registerFunction({
    name: "pg_advisory_unlock",
    args: ["bigint" as never],
    returns: { kind: "named", name: "boolean" as never } as never,
    impure: true,
    implementation: (key: unknown) => locks.unlock(Number(key)),
  } as never);

  const migrationSql = readFileSync(MIGRATION_PATH, "utf-8");
  for (const stmt of migrationSql.split("--> statement-breakpoint")) {
    const s = stmt.trim();
    if (!s) continue;
    mem.public.none(s);
  }

  const pool = new MemPool(mem);
  __setTestPool(pool as unknown as import("pg").Pool);
  __resetStorageCache();
  // Capture post-migration state for fast reset between tests.
  currentBackup = mem.backup();

  const handle: MemDbHandle = {
    mem,
    pool,
    reset(): void {
      currentBackup?.restore();
      locks.clear();
      __resetStorageCache();
    },
    close(): void {
      __setTestPool(null);
      __resetStorageCache();
      currentBackup = null;
      currentHandle = null;
      currentLocks = null;
    },
    clearLocks(): void {
      locks.clear();
    },
  };
  currentHandle = handle;
  return handle;
}

/** Get the active handle, throwing if none has been created. */
export function getMemDb(): MemDbHandle {
  if (!currentHandle) {
    throw new Error("createMemDb() must be called before getMemDb()");
  }
  return currentHandle;
}

/**
 * Seed a `users` row directly via Drizzle. Useful as a fixture in tests that
 * want to skip the channel-identity / OTP dance.
 */
export async function seedUser(
  overrides: { phoneE164?: string; displayName?: string; timezone?: string } = {}
): Promise<string> {
  const db = getDb();
  const { users } = await import("../../src/db/schema.js");
  const [u] = await db
    .insert(users)
    .values({
      phoneE164: overrides.phoneE164 ?? `+1555${randomDigits()}`,
      displayName: overrides.displayName,
      timezone: overrides.timezone ?? "America/New_York",
    })
    .returning();
  return u.id;
}

function randomDigits(): string {
  return String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
}
