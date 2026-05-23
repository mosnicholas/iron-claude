# IronClaude

AI-powered personal workout coach over Telegram (and soon web). Postgres-backed, multi-user-ready, open source.

IronClaude pairs the Claude Agent SDK with a fitness data model in Postgres. It logs your workouts, tracks PRs, plans your week, and adapts to recovery signals from wearables — all from a chat interface.

---

## Quickstart (self-hosters)

Prerequisites: Node.js 20+, Docker, a Supabase project (free tier OK), a Telegram bot, and an Anthropic API key.

```bash
# 1. Clone and install
git clone https://github.com/your-fork/iron-claude.git
cd iron-claude
npm install

# 2. Start local Postgres for development
docker compose up -d postgres
```

### 3. Create a Supabase project

Go to https://supabase.com and create a project (free tier is fine). You'll use Supabase for Phone Auth only — the local Postgres above is your application database.

1. Enable Phone Auth: **Authentication > Providers > Phone**
2. Connect your own Twilio account in Supabase's dashboard (Supabase relays via Twilio)
3. Copy these values into `.env`:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

### 4. Generate local secrets

```bash
openssl rand -base64 32   # INTEGRATION_TOKEN_KEY
openssl rand -base64 32   # SESSION_SECRET
```

Add both to `.env`.

### 5. Create a Telegram bot

Message [@BotFather](https://t.me/botfather) and run `/newbot`. Save the token.

```env
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 16)
```

### 6. Add your Anthropic API key

```env
ANTHROPIC_API_KEY=sk-ant-...
```

### 7. Migrate and run

```bash
npm run db:migrate
npm run dev
```

### 8. Sign up

The hosted web onboarding flow at `http://localhost:8080/onboard.html` is **coming soon**. For now, sign up by messaging your Telegram bot — it auto-creates a user on first contact and runs an onboarding conversation to build your profile.

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

The inbox decouples channel ingestion from agent execution. Multiple app instances can pull from the same inbox safely — an advisory lock keyed on `user_id` guarantees turn-by-turn ordering per user.

---

## Telegram commands

You can also just chat naturally — the agent understands context.

| Command     | Description                              |
|-------------|------------------------------------------|
| `/today`    | Show today's workout                     |
| `/plan`     | Show this week's plan                    |
| `/fullplan` | Show full plan with all details          |
| `/done`     | Complete current workout                 |
| `/prs`      | Show personal records                    |
| `/help`     | List all commands                        |

### Logging exercises

```
OHP 115: 6, 5, 5 @8
Dips +25: 8, 7, 7
Pull-ups: 10, 8, 7
Handstand: 30s, 25s, 30s
```

Format: `Exercise Weight: rep, rep, rep @RPE`
- `+weight` = added weight for bodyweight exercises
- `@number` = RPE (1-10)

---

## Migrating from the GitHub-repo version

Earlier versions of IronClaude stored each user's data as markdown in a private GitHub repo. The importer brings that history into Postgres.

```bash
npm run import -- \
  --phone +15551234567 \
  --repo your-github/fitness-data \
  --github-token ghp_...
```

Add `--dry-run` to validate the parse without writing to the database:

```bash
npm run import -- --phone +15551234567 --repo your-github/fitness-data \
  --github-token ghp_... --dry-run
```

The importer maps `profile.md`, `learnings.md`, `prs.yaml`, weekly plans, retros, and per-day workout files into the new schema. It is idempotent — re-running it skips rows that already exist.

To run the importer against a deployed instance, see `DEPLOY.md` (use `fly ssh console`).

---

## Customization

User data lives in Postgres now — there is no per-user repo. To edit your data:

- **Easiest:** chat with the bot ("update my profile to mention a left-shoulder limitation")
- **Direct:** open a SQL shell or `drizzle-kit studio` and edit rows

Editable entities: `profile`, `learnings`, `prs`, `plans`, `retros`, `workouts`. The schema lives in `src/db/schema.ts`.

---

## Testing

```bash
npm test                                          # Unit + integration tests (~10s)
npm run test:all                                  # Includes scenarios
ANTHROPIC_API_KEY=sk-... npm run test:scenarios   # End-to-end agent runs
```

Integration tests run against the local Postgres started by `docker compose up -d postgres`.

---

## Troubleshooting

**Bot not responding?**

1. Check the webhook: `curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"`
2. Check the inbox: `curl http://localhost:8080/health` (returns `{ok: true, backlog: N}`)
3. Tail logs: `npm run dev` output, or `fly logs` in production

**Inbox stuck?** Look for items in the `inbox` table with `processed_at IS NULL` and a non-null `lock_expires_at` in the past — that means an instance crashed mid-turn. The worker will retry automatically.

---

## Future enhancements

- Web UI for browsing workout history, PRs, and plans
- WhatsApp / SMS adapter (the inbox abstraction makes this a thin shim)
- Photo storage in S3 for progress tracking

---

## Deploying to production

See [DEPLOY.md](./DEPLOY.md) for a step-by-step Fly.io + Supabase deployment guide.

---

## License

MIT
