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
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { newDb, type IMemoryDb } from "pg-mem";
import { __setTestPool, getDb } from "../../src/db/client.js";
import { __resetStorageCache } from "../../src/storage/db.js";

const MIGRATIONS_DIR = join(process.cwd(), "drizzle");

function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()
    .map((f) => join(MIGRATIONS_DIR, f));
}

// Locks are global to a pg-mem instance — they model `pg_advisory_lock` which
// in production is per-database. Held across queries on the same instance.
function createAdvisoryLocks() {
  const held = new Set<number>();
  return {
    tryLock(key: number): boolean {
      console.error("[locks.tryLock]", key, "held:", [...held]);
      if (held.has(key)) return false;
      held.add(key);
      return true;
    },
    unlock(key: number): boolean {
      console.error("[locks.unlock]", key);
      if (!held.has(key)) return false;
      held.delete(key);
      return true;
    },
    clear(): void {
      console.error("[locks.clear]");
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

/**
 * Drizzle inlines JS arrays as a row tuple like `ANY(($1, $2))` — which is
 * valid in production Postgres but fails in pg-mem because:
 *   (a) the row constructor isn't an array expression in its parser, and
 *   (b) array literals like `ARRAY['uuid']` don't auto-cast to `uuid[]`.
 *
 * Rewriting to `IN ($1, $2)` is functionally equivalent for our use cases and
 * avoids both pitfalls.
 */
function rewriteArrayAny(sqlText: string): string {
  return sqlText.replace(
    /=\s*ANY\(\((\$\d+(?:\s*,\s*\$\d+)*)\)\)/gi,
    "IN ($1)"
  );
}

function substParams(sqlText: string, params: readonly unknown[]): string {
  return rewriteArrayAny(sqlText).replace(/\$(\d+)/g, (_m, n) =>
    toLiteral(params[parseInt(n, 10) - 1])
  );
}

/**
 * pg-mem has a known quirk with correlated subqueries in the SELECT list: when
 * the outer table has zero rows, it still returns one row whose outer columns
 * are all null. Detect and drop such phantom rows so storage methods behave
 * the same as on real Postgres.
 */
function dropPhantomCorrelatedRows(
  rows: Record<string, unknown>[],
  fields: { name: string }[]
): Record<string, unknown>[] {
  if (rows.length !== 1) return rows;
  const row = rows[0];
  // Heuristic: if every scalar (non-array, non-object) field is null/"null",
  // this is a phantom row from a correlated subquery against an empty outer.
  // Array/object fields (subquery COUNT results, jsonb) are skipped from the
  // check because they're computed even when the outer row doesn't exist.
  // We iterate over the row's own keys to be robust to fields metadata being
  // empty (pg-mem doesn't always populate it).
  const keys = fields.length > 0 ? fields.map((f) => f.name) : Object.keys(row);
  const scalarFieldsAllNull = keys.every((k) => {
    const v = row[k];
    if (Array.isArray(v) || (v && typeof v === "object" && !(v instanceof Date)))
      return true;
    return v === null || v === undefined || v === "null";
  });
  return scalarFieldsAllNull ? [] : rows;
}

/**
 * pg-mem doesn't understand `FOR UPDATE SKIP LOCKED`. We strip it; the
 * single-threaded JS test runner doesn't actually need row-level locks to
 * avoid concurrent claims.
 */
function stripSkipLocked(sqlText: string): string {
  return sqlText.replace(/\bFOR\s+UPDATE\s+SKIP\s+LOCKED\b/gi, "");
}

/**
 * pg-mem's `ON CONFLICT (...) DO NOTHING RETURNING ...` returns the existing
 * row, whereas real Postgres returns zero rows when a conflict is hit. We
 * detect this shape and pre-check the conflict — if it would fire, we return
 * an empty result without running the insert.
 *
 * Returns { intercepted: true } and a synthesized empty result when we want
 * to bypass the insert, otherwise { intercepted: false }.
 */
function maybeShortCircuitDoNothing(
  db: IMemoryDb,
  text: string
): { intercepted: true; result: { command: string; rowCount: number; fields: { name: string }[]; rows: never[] } } | { intercepted: false } {
  const insertMatch = text.match(
    /^\s*insert\s+into\s+"?(\w+)"?[\s\S]+?on\s+conflict\s*\(([^)]+)\)\s*do\s+nothing/i
  );
  if (!insertMatch) return { intercepted: false };
  const table = insertMatch[1];
  const conflictCols = insertMatch[2]
    .split(",")
    .map((s) => s.trim().replace(/"/g, ""));

  // Extract values list for the columns from the INSERT body. We only need to
  // check whether (conflictCols) already exists.
  const colListMatch = text.match(/insert\s+into\s+"?\w+"?\s*\(([^)]+)\)/i);
  const valsMatch = text.match(/values\s*\(([^)]+)\)/i);
  if (!colListMatch || !valsMatch) return { intercepted: false };
  const colNames = colListMatch[1]
    .split(",")
    .map((s) => s.trim().replace(/"/g, ""));
  const valStrs = valsMatch[1].split(",").map((s) => s.trim());
  const where = conflictCols
    .map((cc) => {
      const idx = colNames.indexOf(cc);
      if (idx < 0) return null;
      const v = valStrs[idx];
      // Skip when value is "default" — caller can't be conflicting on a default
      if (v.toLowerCase() === "default") return null;
      return `"${cc}" = ${v}`;
    })
    .filter(Boolean) as string[];
  if (where.length !== conflictCols.length) return { intercepted: false };
  try {
    const probe = db.public.query(`SELECT 1 FROM "${table}" WHERE ${where.join(" AND ")} LIMIT 1`);
    if (probe.rows.length > 0) {
      // Conflict would fire → no row returned.
      return {
        intercepted: true,
        result: { command: "INSERT", rowCount: 0, fields: [], rows: [] },
      };
    }
  } catch {
    return { intercepted: false };
  }
  return { intercepted: false };
}

function runQuery(
  db: IMemoryDb,
  sqlText: string,
  params: readonly unknown[] = [],
  arrayMode = false
) {
  const subbed = params.length > 0 ? substParams(sqlText, params) : sqlText;
  const text = stripSkipLocked(subbed);
  if (process.env.DEBUG_PGMEM) {
    console.error("[pgmem]", text);
  }
  const shortCircuit = maybeShortCircuitDoNothing(db, text);
  if (shortCircuit.intercepted) {
    return shortCircuit.result;
  }
  const result = db.public.query(text);
  const fields = (result.fields ?? []).map((f) => ({ name: f.name }));
  // Only run the phantom-row cleanup on SELECTs with subqueries — INSERT/UPDATE
  // RETURNING and other paths must not be touched. Runs whether the caller
  // wanted array mode or not; we re-arrayify after cleanup if needed.
  const looksLikeCorrelatedSelect =
    /^\s*select/i.test(text) && /\(\s*select/i.test(text);
  const cleaned = looksLikeCorrelatedSelect
    ? dropPhantomCorrelatedRows(
        result.rows as Record<string, unknown>[],
        fields
      )
    : (result.rows as Record<string, unknown>[]);
  const rows = arrayMode
    ? cleaned.map((row) => fields.map((f) => row[f.name]))
    : cleaned;
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

/**
 * Build a fresh in-memory database with the Drizzle migration applied. Installs
 * it as the global test pool so existing `getDb()` / `DbStorage` callers use
 * it without modification.
 */
export function createMemDb(): MemDbHandle {
  const mem = newDb({ autoCreateForeignKeyIndices: true });
  const locks = createAdvisoryLocks();

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

  for (const file of listMigrationFiles()) {
    const migrationSql = readFileSync(file, "utf-8");
    for (const stmt of migrationSql.split("--> statement-breakpoint")) {
      const s = stmt.trim();
      if (!s) continue;
      mem.public.none(s);
    }
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
