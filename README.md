# IronClaude (Pro)

Internal monorepo for the multi-tenant IronClaude product: AI workout +
nutrition coach over Telegram (and soon web), backed by Postgres + Supabase
Auth, billed via Stripe.

This repo is the commercial product. The original single-user GitHub-backed
version lives in [`iron-claude-git-backing`](https://github.com/mosnicholas/iron-claude-git-backing)
as a public reference implementation.

---

## Architecture

```
                    +-------------------+
   Telegram  ---->  |   /api/webhook    |
   (web soon)       +---------+---------+
                              |
                              v
                  +-----------------------+
                  |   inbox (Postgres)    |  durable queue, per-user
                  +-----------+-----------+
                              |
                              v   advisory lock per user_id
                  +-----------------------+
                  |   inbox worker        |  serializes turns,
                  |   (CoachAgent)        |  runs the Claude Agent SDK
                  +-----------+-----------+
                              |
              +---------------+---------------+
              v               v               v
        +-----------+   +-----------+   +-------------+
        | Postgres  |   | Anthropic |   | Integrations|
        | (storage) |   | (Claude)  |   | (Whoop, ...)|
        +-----------+   +-----------+   +-------------+
```

The inbox decouples channel ingestion from agent execution. Multiple Fly
instances pull from the same inbox safely — an advisory lock keyed on
`user_id` guarantees turn-by-turn ordering per user.

---

## Local development

```bash
# 1. Install
npm install

# 2. Spin up local Postgres
docker compose up -d postgres

# 3. Copy .env.example to .env and fill in:
#    - DATABASE_URL=postgres://ironclaude:ironclaude@localhost:5432/ironclaude
#    - ANTHROPIC_API_KEY
#    - TELEGRAM_BOT_TOKEN + TELEGRAM_WEBHOOK_SECRET
#    - SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
#    - INTEGRATION_TOKEN_KEY (openssl rand -base64 32)
#    - SESSION_SECRET (openssl rand -base64 32)
#    - STRIPE_* (optional — disables billing if unset)

# 4. Migrate + run
npm run db:migrate
npm run dev
```

---

## Tiers

| Tier     | What's in                                                                  |
|----------|----------------------------------------------------------------------------|
| `trial`  | Full coaching for 30 days from signup. Auto-flips to `expired`.            |
| `regular`| Unlimited turns, all integrations, Sonnet-class model. No photos.          |
| `athlete`| Everything in regular + photos + Opus-class model + higher rate ceiling.   |
| `comped` | Same as athlete; never downgraded by the Stripe webhook.                   |
| `expired`| Read-only; coach turns return "subscribe to continue".                     |

### Comp an account

```bash
npm run grant-tier -- --phone +15551234567 --tier athlete
```

Sets `tier_overridden_by_admin = true`. Stripe webhook downgrade events are
ignored for comped accounts.

---

## Testing

```bash
npm test                                          # Unit + integration tier (~10s, no API key)
npm run test:db                                   # Storage tier only
ANTHROPIC_API_KEY=sk-... npm run test:scenarios   # Real-model scenario tier (~2 min)
```

Integration tests use `pg-mem` (no Docker required). Scenario tests run
against the same DB substrate plus real Haiku.

---

## Migrating data in

To import existing fitness-data repo content for an athlete:

```bash
npm run import -- \
  --phone +15551234567 \
  --repo someuser/fitness-data \
  --github-token ghp_...
```

Use `--dry-run` to validate first.

---

## Telegram commands

| Command     | Description                              |
|-------------|------------------------------------------|
| `/today`    | Show today's workout                     |
| `/plan`     | Show this week's plan                    |
| `/done`     | Complete current workout                 |
| `/prs`      | Show personal records                    |
| `/help`     | List all commands                        |
| `/debug …`  | Read-only diagnostic mode                |

Athletes can also just chat — the agent handles the rest.

---

## Deploying

See [DEPLOY.md](./DEPLOY.md). Push to `main` → Actions runs CI → on green,
Fly deploys → `start.sh` runs `npm run db:migrate` before serving.

---

## License

Proprietary. See `LICENSE`.
