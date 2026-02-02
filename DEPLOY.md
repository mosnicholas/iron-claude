# Deploying IronClaude to Fly.io

Deploy IronClaude to Fly.io for Telegram notifications, morning reminders, and automated weekly planning.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Telegram                                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Fly.io (Docker Container)                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Express Server (src/server.ts)                       │  │
│  │  - POST /api/webhook (Telegram messages)              │  │
│  │  - GET /api/cron/* (scheduled tasks)                  │  │
│  │  - GET /health (health check)                         │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Supercronic (cron scheduler)                         │  │
│  │  - Daily reminders                                    │  │
│  │  - Weekly retrospective                               │  │
│  │  - Weekly planning                                    │  │
│  └───────────────────────────────────────────────────────┘  │
│                              │                               │
│              ┌───────────────┴───────────────┐              │
│              ▼                               ▼               │
│  ┌─────────────────────┐     ┌─────────────────────────┐    │
│  │  Claude Agent SDK   │     │  GitHub API             │    │
│  │  (AI coaching)      │     │  (data storage)         │    │
│  └─────────────────────┘     └─────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

**Endpoints:**
- `POST /api/webhook` - Telegram message handler
- `GET /api/cron/daily-reminder` - Morning workout reminder
- `GET /api/cron/weekly-plan` - Sunday planning (generates retro + plan)
- `GET /health` - Health check

---

## Prerequisites

- [Fly.io account](https://fly.io)
- [Fly CLI](https://fly.io/docs/flyctl/install/) installed
- [Telegram account](https://telegram.org)
- [Anthropic API key](https://console.anthropic.com)
- GitHub repository for workout data storage
- (Optional) [Gemini API key](https://aistudio.google.com) for voice transcription

---

## Quick Deploy

The easiest way to deploy is using the setup wizard:

```bash
npm run setup
```

This will:
1. Collect your credentials
2. Create the fitness-data GitHub repo
3. Run the onboarding conversation
4. Configure your Fly.io app (generates `fly.toml`)
5. Deploy to Fly.io
6. Configure the Telegram webhook

---

## Step 1: Create Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/botfather)
2. Send `/newbot`
3. Choose a name (e.g., "IronClaude")
4. Choose a username (e.g., "iron_claude_bot")
5. Save the **bot token** (looks like `123456789:ABCdef...`)

---

## Step 2: Get Your Chat ID

1. Message your new bot (send anything)
2. Open this URL in your browser (replace `<TOKEN>` with your bot token):
   ```
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```
3. Find `"chat":{"id":123456789}` in the response
4. Save this **chat ID**

---

## Step 3: Create GitHub Token

The bot stores workout data in your GitHub repo.

1. Go to [GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens](https://github.com/settings/tokens?type=beta)
2. Click "Generate new token"
3. Name: "IronClaude Bot"
4. Repository access: Select your workout-routine repo
5. Permissions:
   - Contents: Read and write
   - Metadata: Read-only
6. Generate and save the **token**

---

## Step 4: Install Fly CLI

```bash
curl -L https://fly.io/install.sh | sh
fly auth login
```

---

## Step 5: Deploy to Fly.io

### Configure fly.toml

Copy the template and customize it:

```bash
cp fly.toml.example fly.toml
```

Edit `fly.toml` and update:
- `app` - Your unique app name (e.g., `my-fitness-coach`)
- `primary_region` - Your nearest [Fly.io region](https://fly.io/docs/reference/regions/) (e.g., `ewr`, `lax`, `lhr`)

### Build the application

```bash
npm install
npm run build
```

### Create the app (first time only)

```bash
fly apps create <your-app-name>
```

### Set secrets

```bash
fly secrets set \
  TELEGRAM_BOT_TOKEN=your_bot_token \
  TELEGRAM_CHAT_ID=your_chat_id \
  TELEGRAM_WEBHOOK_SECRET=random_secret_string \
  ANTHROPIC_API_KEY=your_anthropic_key \
  GITHUB_TOKEN=your_github_token \
  DATA_REPO=username/fitness-data \
  TIMEZONE=America/New_York \
  CRON_SECRET=another_random_secret
```

Optional (for voice messages):
```bash
fly secrets set GEMINI_API_KEY=your_gemini_key
```

### Deploy

```bash
fly deploy
```

---

## Step 6: Set Telegram Webhook

Tell Telegram where to send messages:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<your-app>.fly.dev/api/webhook&secret_token=<WEBHOOK_SECRET>"
```

Or use the helper script:
```bash
npm run set-webhook https://<your-app>.fly.dev/api/webhook
```

### Verify webhook is set:

```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

---

## Environment Variables

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `TELEGRAM_BOT_TOKEN` | Bot token from BotFather | `123456789:ABCdef...` |
| `TELEGRAM_CHAT_ID` | Your chat ID | `987654321` |
| `TELEGRAM_WEBHOOK_SECRET` | Secret for webhook verification | `random_string` |
| `ANTHROPIC_API_KEY` | Claude API key | `sk-ant-...` |
| `GITHUB_TOKEN` | Fine-grained personal access token | `github_pat_...` |
| `DATA_REPO` | Repository in `owner/repo` format | `username/fitness-data` |
| `TIMEZONE` | Your timezone | `America/New_York` |
| `CRON_SECRET` | Bearer token for cron endpoints | `another_random_string` |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `GEMINI_API_KEY` | For voice message transcription | _(none)_ |
| `GIT_COMMIT_EMAIL` | Email for data repo commits | `coach@fitness-bot.local` |
| `GIT_COMMIT_NAME` | Name for data repo commits | `Fitness Coach` |

---

## Cron Schedule

Scheduled tasks run via Supercronic inside the container. Defined in `crontab`:

| Job | Schedule (UTC) | Description |
|-----|----------------|-------------|
| Daily Reminder | `0 11 * * 1-5` | 11am UTC (6am EST), Mon-Fri |
| Weekly Retro | `0 23 * * 6` | 11pm UTC (6pm EST), Saturday |
| Weekly Plan | `0 1 * * 0` | 1am UTC (8pm EST), Sunday |

**Note:** Adjust times based on your timezone. The default assumes US Eastern (UTC-5).

To change schedules, edit `crontab` and redeploy:

```
# Daily reminder - 11:00 UTC on weekdays
0 11 * * 1-5 curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:8080/api/cron/daily-reminder
```

---

## Testing

### Test locally

```bash
npm install
npm run build
npm start

# In another terminal:
curl http://localhost:8080/health
```

### Test cron endpoints manually

```bash
# With CRON_SECRET
curl -H "Authorization: Bearer YOUR_SECRET" https://<your-app>.fly.dev/api/cron/daily-reminder
```

### Test bot

Send a message to your bot on Telegram. You should get a response.

---

## Health Check

The `/health` endpoint returns the application status:

```bash
curl https://<your-app>.fly.dev/health
```

**Response:**
```json
{"status": "ok"}
```

Use this to verify the app is running. Fly.io uses this endpoint internally to monitor machine health.

---

## Monitoring

### View logs

```bash
fly logs
```

### Check status

```bash
fly status
```

### SSH into container

```bash
fly ssh console
```

---

## Troubleshooting

### Bot not responding

1. Check webhook is set:
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
   ```
2. View application logs:
   ```bash
   fly logs
   ```
3. Verify secrets are set:
   ```bash
   fly secrets list
   ```

### "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID"

Secrets not set. Add them with `fly secrets set` and redeploy.

### "Unauthorized" on cron endpoints

You have `CRON_SECRET` set but the request doesn't include the bearer token. The internal Supercronic calls include this automatically.

### Voice messages not working

Set `GEMINI_API_KEY` secret. Voice transcription uses Gemini.

### GitHub storage errors

1. Verify `GITHUB_TOKEN` has correct permissions
2. Verify `DATA_REPO` format is `owner/repo`
3. Check token hasn't expired

---

## Security Notes

- **Webhook secret**: Prevents unauthorized requests to your webhook
- **CRON_SECRET**: Prevents manual triggering of cron jobs
- **Chat ID verification**: Bot only responds to your chat ID
- **Fine-grained tokens**: Use minimal GitHub permissions

---

## Updating

After code changes:

```bash
npm run build
fly deploy
```

---

## Cost

Fly.io pricing for this setup:
- ~$5-7/month for an always-on small VM (1 shared CPU, 1GB RAM)
- First $5/month is included in the free tier

To reduce costs, you can enable auto-stop (machine stops when idle):
```toml
# In fly.toml
[http_service]
  auto_stop_machines = true
```

Note: This adds cold-start latency when the bot receives a message after being idle.

---

## Auto-Deploy (Optional)

Set up automatic deployments when you push to GitHub.

### Option A: Fly.io Dashboard (Recommended)

Connect your Fly.io app directly to GitHub:

1. Deploy once manually: `fly deploy`
2. Go to [Fly.io Dashboard](https://fly.io/dashboard) → Your App → Settings
3. Connect to your GitHub repository
4. Fly.io will auto-deploy on push to main

**Pros:** Simple, no tokens to manage
**Cons:** Less control over build process

### Option B: GitHub Actions

This repo includes GitHub Actions workflows that are disabled by default.

To enable auto-deploy:

1. Go to your repo: **Settings → Secrets and variables → Actions**
2. Add a **variable**: `ENABLE_FLY_DEPLOY` = `true`
3. Add a **secret**: `FLY_API_TOKEN` = your Fly.io deploy token
4. (Optional) Add variable `FLY_REGION` for PR previews (default: `ewr`)

Generate a Fly.io token:
```bash
fly tokens create deploy -x 999999h
```

**Pros:** Full control, PR preview environments
**Cons:** Requires managing tokens

### For Forks

If you fork this repo, the deploy workflows will **not** run automatically (they check for `ENABLE_FLY_DEPLOY`). This is intentional - each fork manages its own deployment.

To deploy your fork:
1. Configure your own `fly.toml`
2. Deploy manually with `fly deploy`
3. Or enable GitHub Actions in your fork's settings
