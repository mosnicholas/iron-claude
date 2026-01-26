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
4. Deploy to Fly.io
5. Connect your Telegram bot

Once complete, message your bot on Telegram to start training.

---

## Prerequisites

You'll need:
- **Telegram Bot Token** - Create via [@BotFather](https://t.me/botfather)
- **GitHub Personal Access Token** - With `repo` scope for data storage
- **Anthropic API Key** - For Claude AI coaching
- **Gemini API Key** (optional) - For voice message transcription

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
│   ├── handlers/                ← HTTP request handlers
│   ├── server.ts                ← Express HTTP server
│   └── storage/                 ← GitHub data storage
├── scripts/                     ← Setup wizard
├── Dockerfile                   ← Docker build config
├── fly.toml                     ← Fly.io deployment config
└── crontab                      ← Scheduled task definitions
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
2. Check Fly.io logs: `fly logs`
3. Verify secrets are set: `fly secrets list`

### Re-run setup
```bash
npm run setup
```

---

## Future Enhancements

These are potential improvements not yet implemented:

### Infrastructure
- **Persistent volume for repo cache**: Add a Fly.io volume mount to `/data` to persist the fitness-data repo clone across deploys. This would eliminate the need to re-clone on cold starts. Currently uses `/tmp` which is cleared on each deploy.
- **Workout templates**: Pre-built program templates (5/3/1, PPL, etc.) that can be imported during onboarding.

### Wearable Integration (via MCP)
Connect to health wearables to pull recovery and readiness data directly into coaching decisions:

- **Whoop**: Recovery score, strain, HRV, sleep performance
- **Apple Watch / HealthKit**: Activity rings, heart rate, sleep data
- **Oura Ring**: Readiness score, sleep stages, HRV trends
- **Garmin**: Training status, body battery, stress levels

**How it would work**:
1. Configure MCP server for your wearable's API
2. Coach automatically pulls daily readiness scores
3. Training intensity adjusts based on recovery: "Whoop shows 45% recovery - programming a lighter day"
4. Weekly retrospectives include recovery correlation analysis

### Progress Photo Tracking
Send weekly photos to track physical progress alongside strength gains:

- **Weekly photo logging**: Send a progress photo via Telegram each week
- **Side-by-side comparisons**: "Here's week 1 vs week 12"
- **Organized storage**: Photos saved to `fitness-data/photos/YYYY-WXX.jpg`
- **Privacy-first**: All photos stored in your private GitHub repo

**Suggested workflow**:
1. Sunday planning message includes photo reminder
2. Send photo via Telegram
3. Coach confirms receipt and stores securely
4. Monthly summaries include visual progress alongside PR charts

---

## License

MIT
