# Deployment Guide

Deploy IronClaude to Vercel for Telegram notifications, morning reminders, and automated weekly planning.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    Telegram     │────▶│     Vercel      │────▶│     GitHub      │
│   (messages)    │     │  (serverless)   │     │   (storage)     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │   Claude API    │
                        │   (coaching)    │
                        └─────────────────┘
```

**Endpoints:**
- `POST /api/webhook` - Telegram message handler
- `GET /api/cron/daily-reminder` - Morning workout reminder
- `GET /api/cron/weekly-plan` - Sunday planning automation
- `GET /api/cron/weekly-retro` - Saturday retrospective

---

## Prerequisites

- [Vercel account](https://vercel.com)
- [Telegram account](https://telegram.org)
- [Anthropic API key](https://console.anthropic.com)
- GitHub repository for workout data storage
- (Optional) [OpenAI API key](https://platform.openai.com) for voice transcription

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

## Step 4: Deploy to Vercel

### Option A: Vercel CLI

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy from project root
vercel

# Follow prompts to link to your Vercel account
```

### Option B: GitHub Integration

1. Push your repo to GitHub
2. Go to [vercel.com/new](https://vercel.com/new)
3. Import your repository
4. Deploy

---

## Step 5: Configure Environment Variables

In Vercel dashboard → Your Project → Settings → Environment Variables:

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `TELEGRAM_BOT_TOKEN` | Bot token from BotFather | `123456789:ABCdef...` |
| `TELEGRAM_CHAT_ID` | Your chat ID | `987654321` |
| `ANTHROPIC_API_KEY` | Claude API key | `sk-ant-...` |
| `GITHUB_TOKEN` | Fine-grained personal access token | `github_pat_...` |
| `GITHUB_REPO` | Repository in `owner/repo` format | `username/workout-routine` |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `TELEGRAM_WEBHOOK_SECRET` | Secret for webhook verification | _(none)_ |
| `CRON_SECRET` | Bearer token for cron endpoints | _(none)_ |
| `OPENAI_API_KEY` | For voice message transcription | _(none)_ |
| `TIMEZONE` | Your timezone | `America/New_York` |

---

## Step 6: Set Telegram Webhook

Tell Telegram where to send messages:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://your-app.vercel.app/api/webhook"
```

**With webhook secret** (recommended):

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://your-app.vercel.app/api/webhook&secret_token=YOUR_SECRET"
```

Then set `TELEGRAM_WEBHOOK_SECRET` to the same value in Vercel.

### Verify webhook is set:

```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

---

## Cron Schedule

Defined in `vercel.json`:

| Job | Schedule (UTC) | Description |
|-----|----------------|-------------|
| Daily Reminder | `0 11 * * 1-5` | 11am UTC, Mon-Fri |
| Weekly Retro | `0 23 * * 6` | 11pm UTC, Saturday |
| Weekly Plan | `0 1 * * 0` | 1am UTC, Sunday |

**Note:** Adjust times based on your timezone. The default assumes US Eastern (UTC-5).

To change schedules, edit `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/daily-reminder",
      "schedule": "0 11 * * 1-5"
    }
  ]
}
```

---

## Testing

### Test webhook locally

```bash
# Install dependencies
npm install

# Build
npm run build

# Use Vercel CLI for local development
vercel dev
```

### Test cron endpoints manually

```bash
# Without CRON_SECRET
curl https://your-app.vercel.app/api/cron/daily-reminder

# With CRON_SECRET
curl -H "Authorization: Bearer YOUR_SECRET" https://your-app.vercel.app/api/cron/daily-reminder
```

### Test bot

Send a message to your bot on Telegram. You should get a response.

---

## Troubleshooting

### Bot not responding

1. Check webhook is set:
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
   ```
2. Verify environment variables in Vercel dashboard
3. Check Vercel function logs: Vercel Dashboard → Deployments → Functions

### "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID"

Environment variables not set. Add them in Vercel dashboard and redeploy.

### "Unauthorized" on cron endpoints

You have `CRON_SECRET` set but the request doesn't include the bearer token. Vercel cron jobs automatically include this if configured.

### Voice messages not working

Set `OPENAI_API_KEY` in environment variables. Voice transcription uses OpenAI Whisper.

### GitHub storage errors

1. Verify `GITHUB_TOKEN` has correct permissions
2. Verify `GITHUB_REPO` format is `owner/repo`
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
# Redeploy
vercel --prod

# Or push to GitHub (if using GitHub integration)
git push
```
