# Deploying IronClaude

This guide deploys IronClaude to Fly.io with a Supabase-hosted Postgres database. The same steps work for Fly.io Postgres if you'd rather self-host the DB.

## Prerequisites

- [Fly.io account](https://fly.io) and [`fly` CLI](https://fly.io/docs/flyctl/install/) installed
- [Supabase project](https://supabase.com) with Phone Auth enabled and a Twilio account connected (Authentication > Providers > Phone)
- [Telegram bot token](https://t.me/botfather)
- [Anthropic API key](https://console.anthropic.com)
- (Optional) [Gemini API key](https://aistudio.google.com) for voice transcription
- (Optional) Whoop developer credentials for the integration

## Architecture (production)

```
   Telegram --> /api/webhook --> Postgres inbox
                                       |
                                       v
                        +--------------+--------------+
                        |   Fly machines (1..N)      |
                        |   Express + inbox worker   |
                        +--------------+--------------+
                                       |
                +----------------------+--------+
                v                      v        v
         Postgres (Supabase)    Anthropic   Integrations
```

Cron is **in-process via pg-boss** — a durable Postgres-backed job queue that boots with the server. No external scheduler required; pg-boss handles scheduling, retries, and multi-instance dispatch off the same Supabase Postgres.

---

## Step 1: Provision Postgres

### Default: Supabase Postgres

Supabase is the data plane for IronClaude — Postgres, Auth (phone OTP), and Storage (progress photos) all in one project.

1. Open your Supabase project dashboard
2. Go to **Project Settings > Database > Connection String**
3. Copy the **pooler URL** (Transaction or Session pooler — IronClaude works with either). This becomes your `DATABASE_URL`.

The pooler URL works better than the direct connection for serverless-style scale-to-zero. If you keep at least one Fly machine warm, the direct URL is fine too.

### Alternative: Fly.io Postgres

Use this only if you're avoiding Supabase. You'll still need Supabase Auth unless you replace the phone-OTP flow.

```bash
fly postgres create --name iron-claude-db
fly postgres attach iron-claude-db --app iron-claude
```

`attach` writes `DATABASE_URL` into your app secrets automatically.

---

## Step 2: Configure Fly secrets

```bash
fly secrets set \
  DATABASE_URL='postgres://...' \
  ANTHROPIC_API_KEY='sk-ant-...' \
  TELEGRAM_BOT_TOKEN='123456:ABC...' \
  TELEGRAM_WEBHOOK_SECRET="$(openssl rand -hex 16)" \
  SUPABASE_URL='https://xxxx.supabase.co' \
  SUPABASE_ANON_KEY='eyJ...' \
  SUPABASE_SERVICE_ROLE_KEY='eyJ...' \
  INTEGRATION_TOKEN_KEY="$(openssl rand -base64 32)" \
  SESSION_SECRET="$(openssl rand -base64 32)" \
  TIMEZONE='America/New_York'
```

Optional secrets:

```bash
fly secrets set \
  SENTRY_DSN='https://...' \
  GEMINI_API_KEY='AIza...' \
  WHOOP_CLIENT_ID='...' \
  WHOOP_CLIENT_SECRET='...' \
  STRIPE_SECRET_KEY='sk_live_...' \
  STRIPE_WEBHOOK_SECRET='whsec_...' \
  STRIPE_PRICE_REGULAR='price_...' \
  STRIPE_PRICE_ATHLETE='price_...'
```

The `STRIPE_*` block is optional — self-hosters who don't want billing can skip it. The app keeps every user on the trial-and-then-expired path without Stripe configured.

### Required secrets

| Secret                       | Purpose                                                 |
|------------------------------|---------------------------------------------------------|
| `DATABASE_URL`               | Postgres connection string (Supabase pooler or Fly PG)  |
| `ANTHROPIC_API_KEY`          | Claude Agent SDK                                        |
| `TELEGRAM_BOT_TOKEN`         | Bot token from @BotFather                               |
| `TELEGRAM_WEBHOOK_SECRET`    | Validates Telegram webhook requests                     |
| `SUPABASE_URL`               | Supabase project URL                                    |
| `SUPABASE_ANON_KEY`          | Used by client/login flows                              |
| `SUPABASE_SERVICE_ROLE_KEY`  | Used server-side to verify OTP and manage users         |
| `INTEGRATION_TOKEN_KEY`      | AES key for encrypting integration OAuth tokens at rest |
| `SESSION_SECRET`             | Signs session cookies for the (forthcoming) web UI      |
| `TIMEZONE`                   | IANA TZ name, e.g. `America/New_York`                   |

Optional: `SENTRY_DSN`, `GEMINI_API_KEY`, `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_REGULAR`, `STRIPE_PRICE_ATHLETE`.

---

## Step 3: Deploy

```bash
fly deploy
```

Or push to `main` and let GitHub Actions deploy via `.github/workflows/deploy.yml`. To enable auto-deploy on a fork:

1. Add repo **secret** `FLY_API_TOKEN` (generate with `fly tokens create deploy -x 999999h`)
2. Add repo **variable** `ENABLE_FLY_DEPLOY=true`

`start.sh` runs `npm run db:migrate` before launching the server, so every deploy is migration-safe.

### Storage bucket

Create the `progress-photos` bucket once after the first deploy:

```bash
npm run setup:storage
```

Or create it manually in the Supabase dashboard under **Storage > New bucket** (name: `progress-photos`, private).

---

## Step 4: Set the Telegram webhook

```bash
npm run set-webhook
```

This reads `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, and your Fly app URL, then calls Telegram's `setWebhook`. Verify with:

```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

---

## Step 5: Cron (handled by pg-boss in-process)

There is no external cron service to configure. The server boots `pg-boss` on startup, which:

- Creates its own `pgboss` schema in Supabase Postgres (migrations run automatically)
- Registers cron schedules at boot (see `src/jobs/handlers.ts::registerJobSchedules`)
- Runs the scheduler + worker in the same Node process; multi-instance safe via Postgres locks

Current schedules (interpreted in `TIMEZONE` env var, defaults to `America/New_York`):

| Tick (cron-syntax)        | Job                       | Purpose                              |
|---------------------------|---------------------------|--------------------------------------|
| `0 6 * * 1-5`             | `daily-reminder.tick`     | Mon-Fri 6am morning workout nudge    |
| `0 20 * * 0`              | `weekly-plan.tick`        | Sunday 8pm — generate next week      |
| `0 * * * *`               | `check-reminders.tick`    | Hourly per-user reminder sweep       |
| `0 3 * * 3`               | `refresh-tokens.tick`     | Wed 3am — refresh integration tokens |
| `0 3 * * *`               | `daily-compaction.tick`   | Daily 3am — compact conversations    |
| `0 9 * * *`               | `trial-expiry.tick`       | Daily 9am — flip expired trials      |
| `0 4 * * *`               | `log-retention.tick`      | Daily 4am — prune tool_call_log      |

Each `.tick` fans out one `*.user` job per active user, with its own retry budget (typically 2-3 attempts with exponential backoff). Failed jobs are visible in `pgboss.job` (state `failed` or `cancelled`).

### Inspecting jobs

```sql
-- Recent failures by queue
SELECT name, COUNT(*), MAX(completed_on) AS last_seen
FROM pgboss.job
WHERE state = 'failed' AND created_on > now() - interval '1 day'
GROUP BY name ORDER BY last_seen DESC;

-- A specific user's job history
SELECT name, state, retry_count, output, completed_on
FROM pgboss.job
WHERE data->>'userId' = '<uuid>'
ORDER BY created_on DESC LIMIT 20;
```

### Changing a schedule

Edit `src/jobs/handlers.ts::registerJobSchedules` and redeploy. `pg-boss` upserts schedules on boot — no migration required.

---

## Step 6: Verify

```bash
curl https://<your-app>.fly.dev/health
```

Expected:

```json
{"ok": true, "backlog": 0}
```

`backlog` is the count of unprocessed items in the inbox. Anything non-zero that doesn't drain within a few seconds means the worker isn't running or is stuck on a long turn.

Send a message to your Telegram bot. You should see it in the inbox briefly, then a reply.

---

## Multi-instance scaling

The inbox uses a Postgres advisory lock keyed on `user_id`, so any number of Fly machines can pull from the same inbox without conflicting:

```bash
fly scale count 3
```

A single user's turns still execute strictly in order (the advisory lock guarantees serialization per user_id) — only different users parallelize across machines.

---

## Database migrations

- `start.sh` runs `npm run db:migrate` on every boot, so deploys auto-apply pending migrations.
- To create a new migration:

  ```bash
  npm run db:generate   # drizzle-kit writes a new file in drizzle/
  ```

- **Rollback:** drizzle-kit does not auto-generate down-migrations. To roll back, write the down SQL by hand and apply it via `psql $DATABASE_URL -f rollback.sql`. Then delete the offending migration file and the corresponding row from `drizzle.__drizzle_migrations`.

- `drizzle-kit studio` (run locally with `DATABASE_URL` pointing at production — be careful) gives you a browser-based DB editor.

---

## Importing existing users

To migrate someone from the old GitHub-repo-per-user version:

```bash
fly ssh console
# inside the container:
npm run import -- \
  --phone +15551234567 \
  --repo their-github/fitness-data \
  --github-token ghp_...
```

Use `--dry-run` first to validate parsing. The importer is idempotent — safe to re-run.

---

## Monitoring

- **Sentry** — set `SENTRY_DSN` to get error events, performance traces, and inbox-worker spans.
- **Fly logs** — `fly logs` for stdout/stderr.
- **Health** — `/health` returns `{ok, backlog}`. Hook this up to your uptime monitor.
- **Inbox depth** — alert on `backlog > 20` sustained for more than a minute. That signals the worker is wedged or under-provisioned.

---

## Updating

```bash
fly deploy
```

Or merge to `main` if CI deploys are enabled.

---

## Troubleshooting

**`/health` shows growing `backlog`** — worker isn't draining. Check `fly logs` for exceptions in `src/inbox/worker.ts`. A stuck advisory lock will release after `lock_expires_at`; until then that user's messages queue.

**Cron jobs not running** — check the Fly logs for `[pg-boss] started` at boot and `[jobs] schedules registered`. If you don't see those, the worker didn't start. Query `pgboss.schedule` to confirm schedules are present.

**Bot doesn't reply** — verify the webhook with `getWebhookInfo`. Then check Sentry / `fly logs` for handler errors.

**OAuth callback fails for an integration** — likely `INTEGRATION_TOKEN_KEY` differs from when the token was first encrypted. Rotating this key invalidates all stored integration tokens; users have to reconnect.

**Migration fails on boot** — `start.sh` will exit non-zero, Fly will mark the machine unhealthy, and the old machine stays up. Roll forward by fixing the migration and redeploying.

---

## Cost (rough estimate)

- Fly.io: ~$5-7/mo for a single shared-cpu-1x with 1GB RAM
- Supabase: $0 on free tier (Postgres + Auth)
- Anthropic: usage-based; a single user averages well under $5/mo
- Twilio (for Phone Auth SMS): pennies per OTP

Scaling past ~50 users will push Supabase into the Pro tier ($25/mo) and add a second Fly machine.

---

## Tiers and Billing

IronClaude has two paid tiers and a free trial:

- **Trial** — 30 days from signup, full access. Flipped to `expired` by the `trial-expiry` cron.
- **Regular** — standard tier (`STRIPE_PRICE_REGULAR`).
- **Athlete** — higher-touch tier (`STRIPE_PRICE_ATHLETE`).

Stripe webhook URL: `POST /api/stripe/webhook` — configure this in the Stripe dashboard and copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

To comp an account (skip Stripe and grant a tier directly):

```bash
npm run grant-tier -- --phone +15551234567 --tier athlete
```

The same script accepts `--tier regular` or `--tier trial` to reset.

If Stripe env vars are unset, the billing endpoints are disabled and access control falls back to trial-and-expired only.

---

## License

MIT
