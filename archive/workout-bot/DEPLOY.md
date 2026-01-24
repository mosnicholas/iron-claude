# Deploying IronClaude

This guide walks you through setting up your own IronClaude instance.

## Prerequisites

Before setting up IronClaude, you'll need:

1. **Telegram Bot** - Create one via [@BotFather](https://t.me/botfather)
2. **Anthropic API Key** - Get one at [console.anthropic.com](https://console.anthropic.com)
3. **GitHub Personal Access Token** - With `repo` scope for reading your data repo
4. **Vercel Account** - For hosting (free tier works)

## Step 1: Create Your Data Repository

IronClaude stores your training data in a separate private GitHub repository. This keeps your personal data separate from the code.

1. Create a new **private** GitHub repository (e.g., `workout-data`)

2. Copy the template files from `templates/` in this repo:
   ```
   templates/CLAUDE.md              → your-repo/CLAUDE.md
   templates/exercise-variations.md → your-repo/exercise-variations.md
   templates/weeks/2026-W01/plan.md → your-repo/weeks/2026-W01/plan.md
   ```

3. Customize `CLAUDE.md` with your profile:
   - Your name
   - Your goals (strength, fat loss, skills, etc.)
   - Your training preferences (days per week, session length)
   - Your gym/equipment availability
   - Any injuries or limitations

### Data Repository Structure

Your private data repository should have this structure:

```
your-data-repo/
├── CLAUDE.md              # Your profile, goals, preferences
├── exercise-variations.md # Your exercise rotation schedule
└── weeks/
    ├── 2026-W01/
    │   ├── plan.md        # Weekly training plan
    │   ├── monday.md      # Workout log (created when you log)
    │   └── tuesday.md     # Workout log
    ├── 2026-W02/
    │   └── ...
    └── ...
```

## Step 2: Deploy to Vercel

1. **Fork this repository** to your GitHub account

2. **Import to Vercel**:
   - Go to [vercel.com/new](https://vercel.com/new)
   - Select your forked repository
   - Vercel will auto-detect it as a Node.js project

3. **Configure environment variables** (see table below)

4. **Deploy** - Click deploy and wait for the build to complete

## Step 3: Configure Telegram Webhook

After deployment, connect your Telegram bot to your Vercel deployment:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-vercel-app.vercel.app/api/telegram"}'
```

Replace:
- `<YOUR_BOT_TOKEN>` with your Telegram bot token
- `your-vercel-app` with your Vercel deployment URL

### Verify Webhook

Check that the webhook is set correctly:

```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo"
```

You should see your URL in the response.

## Step 4: Configure Cron Jobs (Optional)

For automatic morning check-ins and weekly planning, set up Vercel Cron:

Create or update `vercel.json` in the project root:

```json
{
  "crons": [
    {
      "path": "/api/cron?type=morning",
      "schedule": "0 8 * * 1-5"
    },
    {
      "path": "/api/cron?type=weekly",
      "schedule": "0 18 * * 0"
    }
  ]
}
```

This configures:
- Morning check-ins at 8am on weekdays (Mon-Fri)
- Weekly planning at 6pm on Sundays

Note: Vercel Cron uses UTC. Adjust times for your timezone.

## Step 5: Start Training

Message your bot on Telegram to begin! Try:
- Send "hi" to start a conversation
- Send `/today` to see today's plan
- Send `/plan` to trigger weekly planning

## Environment Variables

Configure these in Vercel's project settings → Environment Variables:

| Variable | Description | Required | Example |
|----------|-------------|----------|---------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather | Yes | `123456:ABC-DEF...` |
| `TELEGRAM_CHAT_ID` | Your Telegram user ID | Yes | `123456789` |
| `ANTHROPIC_API_KEY` | Anthropic API key | Yes | `sk-ant-...` |
| `GITHUB_TOKEN` | GitHub PAT with `repo` scope | Yes | `ghp_...` |
| `GITHUB_OWNER` | GitHub username for data repo | Yes | `yourusername` |
| `GITHUB_REPO` | Name of your data repo | Yes | `workout-data` |

### Getting Your Telegram Chat ID

1. Message [@userinfobot](https://t.me/userinfobot) on Telegram
2. It will reply with your user ID
3. Use this as `TELEGRAM_CHAT_ID`

### Creating a GitHub Personal Access Token

1. Go to GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Generate new token with `repo` scope
3. Copy the token immediately (you won't see it again)

## Local Development

For local development and testing:

```bash
# Clone the repo
git clone https://github.com/yourusername/iron-claude.git
cd iron-claude

# Install dependencies
npm install

# Create .env file
cp .env.example .env
# Edit .env with your values

# Run locally with Vercel CLI
npm run dev
```

### Testing Locally with ngrok

To test Telegram webhooks locally:

1. Install [ngrok](https://ngrok.com/)
2. Run `ngrok http 3000`
3. Set webhook to your ngrok URL:
   ```bash
   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d '{"url": "https://your-ngrok-url.ngrok.io/api/telegram"}'
   ```

## Troubleshooting

### Bot not responding

1. Check webhook is set: `curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"`
2. Check Vercel function logs for errors
3. Verify all environment variables are set

### GitHub API errors

1. Verify `GITHUB_TOKEN` has `repo` scope
2. Check `GITHUB_OWNER` and `GITHUB_REPO` are correct
3. Ensure the data repo exists and token has access

### Claude API errors

1. Verify `ANTHROPIC_API_KEY` is valid
2. Check you have API credits available
3. Review Vercel logs for specific error messages

## Updating

To get updates from the main IronClaude repo:

```bash
# Add upstream remote (one time)
git remote add upstream https://github.com/original/iron-claude.git

# Fetch and merge updates
git fetch upstream
git merge upstream/main
git push
```

Vercel will automatically redeploy when you push.
