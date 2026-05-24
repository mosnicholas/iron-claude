/**
 * Test Postgres lifecycle.
 *
 * In CI: respects $E2E_PG_URL (a postgres service container provisioned
 * by the workflow). Local: boots a `postgres:18-alpine` testcontainer.
 *
 * After boot we run drizzle migrations against the same DB. Tests then
 * get a fresh schema per-FILE (not per-test) — fast enough at <100ms and
 * deterministic between tests.
 */

import { GenericContainer, StartedTestContainer } from "testcontainers";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

export interface E2EPostgres {
  url: string;
  /** Truncate every app table (preserves schema). Called between tests. */
  reset: () => Promise<void>;
  stop: () => Promise<void>;
}

const APP_TABLES = [
  // Order matters when not using TRUNCATE CASCADE; we use CASCADE so it's fine.
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

export async function startTestPostgres(): Promise<E2EPostgres> {
  const externalUrl = process.env.E2E_PG_URL;
  let container: StartedTestContainer | null = null;
  let url: string;

  if (externalUrl) {
    url = externalUrl;
  } else {
    container = await new GenericContainer("postgres:18-alpine")
      .withEnvironment({
        POSTGRES_USER: "ic_e2e",
        POSTGRES_PASSWORD: "ic_e2e",
        POSTGRES_DB: "ic_e2e",
      })
      .withExposedPorts(5432)
      .withTmpFs({ "/var/lib/postgresql/data": "rw" })
      .withHealthCheck({
        test: ["CMD-SHELL", "pg_isready -U ic_e2e"],
        interval: 1000,
        timeout: 1000,
        retries: 30,
        startPeriod: 500,
      })
      .withWaitStrategy({
        check: async () => {
          // Wait for healthcheck to pass — testcontainers exposes this via
          // the inspect output but its higher-level helpers are buggy across
          // OS targets. Cheapest reliable thing: short delay + connect probe.
        },
      } as never)
      .withStartupTimeout(60_000)
      .start();
    const host = container.getHost();
    const port = container.getMappedPort(5432);
    url = `postgres://ic_e2e:ic_e2e@${host}:${port}/ic_e2e`;
  }

  // Wait for the DB to actually accept connections (pg_isready can pass
  // before the listener is ready).
  await connectWithRetry(url);

  // Run migrations once at boot.
  const pool = new Pool({ connectionString: url, max: 2 });
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: "./drizzle" });
  } finally {
    await pool.end();
  }

  return {
    url,
    reset: () => truncateAppTables(url),
    stop: async () => {
      if (container) await container.stop({ remove: true, removeVolumes: true });
    },
  };
}

async function connectWithRetry(url: string, attempts = 30): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 1000 });
    try {
      await pool.query("SELECT 1");
      await pool.end();
      return;
    } catch {
      await pool.end().catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`Postgres at ${url} did not accept connections after ${attempts} attempts`);
}

async function truncateAppTables(url: string): Promise<void> {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    // Single statement, RESTART IDENTITY so any serial columns reset, CASCADE
    // to bypass FK ordering concerns.
    const tableList = APP_TABLES.map((t) => `"${t}"`).join(", ");
    await pool.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
    // pg-boss has its own schema; nuke it too so scheduled jobs from a
    // prior test don't leak forward.
    // pg-boss v12 keeps everything in pgboss.job (no separate archive).
    await pool.query(`TRUNCATE TABLE pgboss.job, pgboss.schedule RESTART IDENTITY CASCADE`).catch(() => {
      // pgboss schema may not exist on first run; ignore.
    });
  } finally {
    await pool.end();
  }
}
