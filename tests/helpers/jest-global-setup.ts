/**
 * Jest globalSetup — boots a real Postgres container once per jest run and
 * stores its URL in `process.env.DATABASE_URL` so every test's
 * `tests/helpers/realpg.ts` can connect to it.
 *
 * Honors `E2E_PG_URL` (set by CI's postgres service container) to skip the
 * testcontainers boot. Locally, testcontainers spawns `postgres:18-alpine`
 * with a 30s startup budget.
 *
 * Runs migrations once after the container is up so the same schema is
 * shared across every test file in the run.
 */

import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __TESTCONTAINER_PG__: StartedTestContainer | undefined;
}

export default async function globalSetup(): Promise<void> {
  // CI provides Postgres as a service container and injects the URL via
  // `E2E_PG_URL` or `DATABASE_URL`. Use it directly instead of nesting
  // testcontainers (which needs Docker-in-Docker and is slower).
  const externalUrl = process.env.E2E_PG_URL ?? process.env.DATABASE_URL;
  if (externalUrl) {
    process.env.DATABASE_URL = externalUrl;
    await waitForPg(externalUrl);
    await runMigrations(externalUrl);
    return;
  }

  const container = await new GenericContainer("postgres:18-alpine")
    .withEnvironment({
      POSTGRES_USER: "ic_test",
      POSTGRES_PASSWORD: "ic_test",
      POSTGRES_DB: "ic_test",
    })
    .withExposedPorts(5432)
    .withTmpFs({ "/var/lib/postgresql/data": "rw" })
    .withStartupTimeout(60_000)
    .start();

  globalThis.__TESTCONTAINER_PG__ = container;
  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const url = `postgres://ic_test:ic_test@${host}:${port}/ic_test`;
  process.env.DATABASE_URL = url;
  await waitForPg(url);
  await runMigrations(url);
}

async function waitForPg(url: string, attempts = 30): Promise<void> {
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

async function runMigrations(url: string): Promise<void> {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: "./drizzle" });
  } finally {
    await pool.end();
  }
}
