# IronClaude

AI-powered personal workout coach using Claude Code skills and optional Telegram notifications.

## Quick Start

### 1. Clone and Setup

```bash
git clone <your-repo-url> iron-claude
cd iron-claude
```

### 2. Run Onboarding

```bash
claude /onboarding
```

This asks 24 questions about your goals, preferences, and experience level, then creates your personalized `CLAUDE.md` profile.

### 3. Start Training

```bash
# Generate your first weekly plan
claude /plan-week

# Get today's workout
claude "what's today's workout?"

# Analyze after training
claude "analyze today"
```

That's it. No API keys, no complex setup.

---

## Architecture

```
iron-claude/
├── CLAUDE.md                    ← Your profile (created by /onboarding)
├── exercise-variations.md       ← 8-week rotation reference
├── weeks/                       ← Workout logs and plans
│   └── 2026-W04/
│       ├── plan.md              ← Weekly plan
│       └── monday.md            ← Daily logs
├── .claude/
│   └── skills/
│       ├── onboarding.md        ← First-time setup
│       ├── plan-week.md         ← Sunday planning
│       └── analyze.md           ← Progress analysis
├── src/                         ← Core application code
│   ├── bot/                     ← Telegram bot integration
│   │   ├── telegram.ts          ← Telegram API client
│   │   ├── commands.ts          ← Bot commands (/help, /today, etc.)
│   │   └── voice.ts             ← Voice message transcription
│   ├── coach/                   ← AI coaching agent
│   │   ├── index.ts             ← CoachAgent class (Claude Agent SDK)
│   │   └── prompts.ts           ← System prompts
│   ├── cron/                    ← Scheduled tasks
│   │   ├── daily-reminder.ts    ← Morning workout reminders
│   │   ├── weekly-plan.ts       ← Sunday planning automation
│   │   └── weekly-retro.ts      ← Weekly retrospective
│   ├── storage/                 ← Data storage layer
│   │   ├── github.ts            ← GitHub API client
│   │   └── repo-sync.ts         ← Local repo cloning for SDK
│   └── utils/                   ← Date utilities, SDK helpers
├── api/                         ← Vercel serverless endpoints
│   ├── webhook.ts               ← Telegram webhook handler
│   └── cron/                    ← Cron job endpoints
├── templates/                   ← Templates for new users
└── vercel.json                  ← Deployment & cron configuration
```

**Key insight:** All AI/coaching logic lives in Claude Code skills. The Telegram bot is optional and just handles text I/O.

---

## Daily Workflow

### Morning
- **With Telegram:** Get automatic morning reminder
- **Without Telegram:** Run `claude "what's today's workout?"`

### At the Gym
- **With Telegram:** Send logs like `OHP 115: 6, 5, 5 @8`
- **Without Telegram:** Log directly to `weeks/YYYY-WXX/monday.md`

### After Training
```bash
claude "analyze today"
```
Get brief coaching feedback on what went well and what to focus on next.

### Weekly (Sundays)
```bash
claude /plan-week
```
Generate next week's plan based on your progress and behavioral patterns.

---

## Skills Reference

### `/onboarding`
First-time setup. Creates your `CLAUDE.md` profile through 24 questions:
- Profile basics (name, gym, experience)
- Goals and targets
- Training preferences
- Injury history
- Coaching style preferences

### `/plan-week`
Weekly planning skill. Reads your logs, analyzes patterns, and generates:
- Next week's training plan with specific weights/reps
- Behavioral insights (actual vs planned training)
- Deload recommendations when needed
- Progressive overload adjustments

### `/analyze`
Progress analysis. Handles queries like:
- "Analyze today's workout"
- "What's my OHP progression?"
- "Am I due for a deload?"
- "Show me last month's volume"

---

## Log Format

When logging workouts (either via Telegram or markdown):

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

**Format breakdown:**
- `Exercise Weight: rep, rep, rep @RPE`
- `+weight` = added weight for bodyweight exercises
- `@number` = RPE (Rate of Perceived Exertion, 1-10)
- Times in seconds for holds

---

## Optional: Telegram Notifications

If you want mobile logging and morning reminders, you can deploy the bot to Vercel.

**Features:**
- Morning workout reminders (weekdays, 6am your timezone)
- Log workouts via Telegram messages
- Voice message support (with OpenAI Whisper)
- Weekly planning and retrospective automation

See **[DEPLOY.md](./DEPLOY.md)** for full deployment instructions.

---

## Customization

### Modify Exercise Rotation
Edit `exercise-variations.md` to customize the 8-week rotation for your preferred exercises.

### Adjust Coaching Style
Update the preferences in `CLAUDE.md`:
- `Feedback style`: Direct / Balanced / Gentle
- `Deload approach`: Scheduled / When needed / I'll tell you

### Customize Skills
Edit files in `.claude/skills/` to change how planning and analysis work.

---

## Session Continuity

Use `claude -c` to continue a conversation:

```bash
claude /plan-week
# Claude generates plan, asks about schedule...

claude -c "Actually I have a work trip Wednesday"
# Claude adjusts the plan
```

---

## File Reference

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Your profile, goals, preferences, PRs |
| `exercise-variations.md` | 8-week rotation reference |
| `weeks/YYYY-WXX/plan.md` | Weekly training plan |
| `weeks/YYYY-WXX/[day].md` | Daily workout logs |
| `templates/daily-log.md` | Log template |

---

## Troubleshooting

### "CLAUDE.md not found"
Run `/onboarding` to create your profile.

### "No plan found for today"
Run `/plan-week` to generate this week's plan.

### Telegram not responding
1. Check webhook is set: `curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"`
2. Verify environment variables in Vercel
3. Check Vercel function logs

---

## License

MIT
