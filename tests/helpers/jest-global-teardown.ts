/**
 * Jest globalTeardown — stops the testcontainers Postgres booted by
 * globalSetup. No-op when running against an externally-managed PG
 * (E2E_PG_URL set by CI).
 */

import type { StartedTestContainer } from "testcontainers";

declare global {
  // eslint-disable-next-line no-var
  var __TESTCONTAINER_PG__: StartedTestContainer | undefined;
}

export default async function globalTeardown(): Promise<void> {
  const container = globalThis.__TESTCONTAINER_PG__;
  if (container) {
    await container.stop({ remove: true, removeVolumes: true });
    globalThis.__TESTCONTAINER_PG__ = undefined;
  }
}
