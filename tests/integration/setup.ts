/**
 * Shared setup for tool integration tests. Each test file boots a fresh
 * in-memory Postgres via `createMemDb()`, seeds one or more users, and uses
 * `createTestContext()` to build a `ToolContext` pointing at the real
 * `DbStorage` (which now sees the in-memory pool).
 */

import { randomUUID } from "crypto";
import { getStorage } from "../../src/storage/db.js";
import type { ToolContext } from "../../src/coach-v2/tool.js";

export interface TestContext extends ToolContext {
  /** Convenience: same `Storage` instance returned by `ctx.storage`. */
  storage: ToolContext["storage"];
}

export function createTestContext(
  userId: string,
  overrides: Partial<ToolContext> = {}
): TestContext {
  return {
    userId,
    storage: getStorage(),
    timezone: overrides.timezone ?? "America/New_York",
    turnId: overrides.turnId ?? randomUUID(),
    handler: overrides.handler ?? "coach",
    ...overrides,
  } as TestContext;
}
