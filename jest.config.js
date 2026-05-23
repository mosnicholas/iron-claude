/**
 * Jest config for unit + integration tests.
 *
 * `globalSetup` boots a real Postgres container (or reuses $E2E_PG_URL in
 * CI) once per jest invocation and stores the URL in process.env.DATABASE_URL.
 * Every test file's `tests/helpers/realpg.ts` then installs a Pool against
 * that URL via `createMemDb()`. Drizzle migrations run once after the
 * container is healthy.
 *
 * `maxWorkers=1` so the shared container isn't contended across workers.
 * Per-test isolation via TRUNCATE in `getMemDb().reset()`.
 *
 * The e2e suite has its own jest.e2e.config.js — it spins up the whole
 * server, fake Telegram, etc. — and skips this globalSetup.
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
  testMatch: ["**/*.test.ts", "**/*.test.js"],
  testPathIgnorePatterns: ["/node_modules/", "/dist/", "/tests/e2e/"],
  globalSetup: "<rootDir>/tests/helpers/jest-global-setup.ts",
  globalTeardown: "<rootDir>/tests/helpers/jest-global-teardown.ts",
  maxWorkers: 1,
  testTimeout: 30_000,
};
