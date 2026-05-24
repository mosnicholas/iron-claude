/**
 * Jest config for the e2e suite. Differs from the default config in three ways:
 *
 *   1. testMatch only catches tests/e2e/**.test.ts
 *   2. Long timeout (60s) — testcontainers Postgres boot + real Anthropic
 *      round-trips don't fit in the default 5s.
 *   3. maxWorkers=1 — each test file owns a testcontainers PG. Running them
 *      serially is simpler than coordinating per-worker container assignment.
 *      For the smoke tier this is fine; if the full tier grows beyond ~5min
 *      total we'll revisit per-worker containers.
 */
/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { useESM: true }],
  },
  testMatch: ["**/tests/e2e/**/*.test.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
  testTimeout: 60_000,
  maxWorkers: 1,
  // E2E paths (whoop-webhook's fire-and-forget processWebhookAsync, pg-boss
  // workers, the inbox poll loop) often leave handles open past the last
  // assertion. Without forceExit jest hangs for ~10s and then prints a
  // warning that GitHub Actions reports as a non-zero exit on some runners.
  forceExit: true,
};
