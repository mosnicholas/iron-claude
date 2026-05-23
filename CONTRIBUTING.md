# Internal Dev Notes

This is a proprietary repo. PRs come from collaborators only; there is no
public contribution flow.

## Local setup

See `README.md`. tl;dr: `npm install`, `docker compose up -d postgres`,
copy `.env.example` to `.env` and fill it in, `npm run db:migrate`,
`npm run dev`.

## Workflow

- Branches: `feature/...`, `fix/...`, `chore/...` are fine; `claude/...`
  is reserved for Claude Code on the web sessions.
- Before every commit: `npm run lint:fix && npm test`.
- Schema changes: `npm run db:generate` produces an incremental
  migration. Commit it alongside the schema change — CI's
  `migration-check` job fails if you skip this.

## CI

`.github/workflows/ci.yml` runs on every PR:

- `lint` — ESLint + Prettier
- `typecheck` — `tsc --noEmit`
- `unit` — fast unit tests
- `db-tests` — Postgres-backed storage + integration tests via pg-mem
- `migration-check` — Drizzle migration-drift guard

`main-ci.yml` runs on push to `main` and includes the scenario tier
(real Haiku calls, gated by `ANTHROPIC_API_KEY` repo secret).

`deploy.yml` runs `flyctl deploy --remote-only` after main CI passes.

## Commit hygiene

- Present tense, imperative mood. ("Add tier middleware" not "Added".)
- First line ≤ 72 chars. Body explains *why*, not just *what*.
- Reference an issue when one exists.

## Periodic hygiene

- `npx knip` — find unused exports, dependencies, files. Worth running
  every couple of weeks.
- `npm audit` — security advisories. Dependabot catches most of these.

## Layout

```
src/
├── auth/            Supabase Auth, identity resolution, tier gating
├── bot/             Telegram bot client + message history
├── coach-v2/        AI coaching agent (Claude Agent SDK + tools)
├── cron/            Scheduled per-user fan-out jobs
├── db/              Drizzle schema + client
├── handlers/        HTTP request handlers (webhook, auth, stripe, ...)
├── inbox/           Multi-instance-safe event queue + worker
├── integrations/    Device integrations (Whoop, ...)
├── nutrition/       USDA FoodData Central client
├── storage/         Storage interface + Postgres impl + photos
├── crypto/          AES-GCM helpers for at-rest secrets
└── observability/   Sentry wrapper

drizzle/             Generated SQL migrations
prompts/             System prompts the coach loads
scripts/             Setup / import / admin scripts
tests/               Integration + scenario tests
.github/             CI/CD workflows, CODEOWNERS, dependabot
```
