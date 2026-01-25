# IronClaude

AI-powered personal workout coach with Telegram integration.

## Quick Start

```bash
git clone <your-repo-url> iron-claude
cd iron-claude
npm install
npm run setup
```

The setup wizard will:
1. Collect your API credentials (Telegram, GitHub, Anthropic)
2. Create a private GitHub repo for your fitness data
3. Run an AI-powered onboarding conversation to build your profile
4. Deploy to Vercel
5. Connect your Telegram bot

Once complete, message your bot on Telegram to start training.

---

## Prerequisites

You'll need:
- **Telegram Bot Token** - Create via [@BotFather](https://t.me/botfather)
- **GitHub Personal Access Token** - With `repo` scope for data storage
- **Anthropic API Key** - For Claude AI coaching
- **OpenAI API Key** (optional) - For voice message transcription

---

## Daily Workflow

### Morning
Get an automatic reminder with today's workout plan.

### At the Gym
Log workouts via Telegram:
```
OHP 115: 6, 5, 5 @8
Dips +25: 8, 7, 7
Pull-ups: 10, 8, 7
```

### After Training
Ask for analysis:
```
analyze today
```

### Weekly (Sundays)
The bot automatically generates next week's plan, or ask:
```
plan next week
```

---

## Architecture

```
iron-claude/
├── CLAUDE.md                    ← Your profile (created during setup)
├── exercise-variations.md       ← 8-week rotation reference
├── weeks/                       ← Workout logs and plans
│   └── 2026-W04/
│       ├── plan.md              ← Weekly plan
│       └── monday.md            ← Daily logs
├── .claude/
│   └── commands/                ← Claude Code slash commands
│       ├── plan-week.md         ← Weekly planning
│       └── analyze.md           ← Progress analysis
├── src/
│   ├── bot/                     ← Telegram bot
│   ├── coach/                   ← AI coaching (Claude Agent SDK)
│   ├── cron/                    ← Scheduled tasks
│   └── storage/                 ← GitHub data storage
├── api/                         ← Vercel serverless endpoints
├── scripts/                     ← Setup wizard
└── vercel.json                  ← Deployment & cron config
```

---

## Log Format

```
# Standard format
OHP 115: 6, 5, 5 @8

# Bodyweight with added weight
Dips +25: 8, 7, 7

# Isometric holds
Handstand: 30s, 25s, 30s

# Without RPE
Pull-ups: 10, 8, 7
```

**Format:** `Exercise Weight: rep, rep, rep @RPE`
- `+weight` = added weight for bodyweight exercises
- `@number` = RPE (Rate of Perceived Exertion, 1-10)

---

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/today` | Show today's workout |
| `/week` | Show this week's plan |
| `/log` | Quick log format help |
| `/help` | List all commands |

You can also just chat naturally - the AI understands context.

---

## Customization

### Exercise Rotation
Edit `exercise-variations.md` to customize the 8-week rotation.

### Coaching Style
Update preferences in `CLAUDE.md`:
- `Feedback style`: Direct / Balanced / Gentle
- `Deload approach`: Scheduled / When needed / I'll tell you

### Claude Code Commands
After setup, you can also use Claude Code locally:
```bash
claude /plan-week    # Generate weekly plan
claude /analyze      # Analyze progress
```

---

## Troubleshooting

### Bot not responding
1. Check webhook: `curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"`
2. Verify environment variables in Vercel dashboard
3. Check Vercel function logs

### Re-run setup
```bash
npm run setup
```

---

## License

MIT
