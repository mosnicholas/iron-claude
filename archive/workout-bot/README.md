# IronClaude

AI-powered personal workout coach on Telegram with progressive overload tracking.

IronClaude is a Telegram bot that acts as your personal strength coach. It tracks your workouts, manages progressive overload, generates weekly training plans, and provides real-time coaching feedback - all powered by Claude AI.

## Features

- **Morning check-ins** - Daily workout reminders with today's plan
- **Real-time workout logging** - Log sets via Telegram during your workout
- **Progressive overload tracking** - Automatic recommendations for weight increases
- **Weekly planning** - AI-generated training plans based on your progress
- **Deload detection** - Recognizes fatigue signals and recommends deloads
- **Exercise rotation** - 8-week exercise variation to prevent boredom
- **PR tracking** - Automatically tracks and celebrates personal records

## Architecture

### Two-Repo Model

IronClaude uses a two-repo architecture to separate code from personal data:

```
┌─────────────────────────────────────┐     ┌─────────────────────────────────────┐
│  PUBLIC: iron-claude                │     │  PRIVATE: your-data-repo            │
│  (this repo)                        │     │  (your personal training data)      │
│                                     │     │                                     │
│  • src/                             │     │  • CLAUDE.md (your profile)         │
│  • api/                             │     │  • weeks/ (your logs)               │
│  • package.json                     │     │  • exercise-variations.md           │
│  • templates/                       │     │                                     │
└─────────────────────────────────────┘     └─────────────────────────────────────┘
           │                                            │
           │ Deployed to Vercel                         │
           │                                            │
           ▼                                            │
┌─────────────────────────────────────┐                │
│  YOUR VERCEL DEPLOYMENT             │◄───────────────┘
│                                     │   reads via GitHub API
│  GITHUB_OWNER=your-username         │   (env vars point to your data)
│  GITHUB_REPO=your-data-repo         │
└─────────────────────────────────────┘
```

This means:
- Your workout data stays in a private repo you control
- You can pull updates from IronClaude without merge conflicts
- Multiple people can use the same codebase with different data repos

### System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              IRONCLAUDE SYSTEM                                  │
└─────────────────────────────────────────────────────────────────────────────────┘

    ┌──────────┐                                              ┌──────────────────┐
    │          │  1. User sends message                       │                  │
    │ TELEGRAM │ ─────────────────────────────────────────▶   │  YOUR PRIVATE    │
    │   APP    │                                              │  GITHUB REPO     │
    │          │  6. Bot responds                             │                  │
    │          │ ◀─────────────────────────────────────────   │  • CLAUDE.md     │
    └──────────┘                                              │  • weeks/*.md    │
         │                                                    │  • exercise-     │
         │                                                    │    variations.md │
         │ Webhook                                            └──────────────────┘
         │                                                           ▲    │
         ▼                                                           │    │
┌─────────────────────────────────────────────────────────────┐      │    │
│                    VERCEL (Serverless)                      │      │    │
│  ┌───────────────────────────────────────────────────────┐  │      │    │
│  │                   api/telegram.ts                     │  │      │    │
│  │                   api/cron.ts                         │  │      │    │
│  └───────────────────────────────────────────────────────┘  │      │    │
│         │                                                   │      │    │
│         ▼                                                   │      │    │
│  ┌───────────────────────────────────────────────────────┐  │      │    │
│  │                     HANDLERS                          │  │      │    │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────┐  │  │      │    │
│  │  │   message   │ │    cron     │ │    command      │  │  │      │    │
│  │  │   handler   │ │   handler   │ │    handler      │  │  │      │    │
│  │  └─────────────┘ └─────────────┘ └─────────────────┘  │  │      │    │
│  └───────────────────────────────────────────────────────┘  │      │    │
│         │                                                   │      │    │
│         ▼                                                   │      │    │
│  ┌───────────────────────────────────────────────────────┐  │      │    │
│  │                     SERVICES                          │  │      │    │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐   │  │      │    │
│  │  │ Claude  │  │ GitHub  │  │Telegram │  │  State  │   │  │      │    │
│  │  │ Service │  │ Service │  │ Service │  │ Manager │   │  │      │    │
│  │  └────┬────┘  └────┬────┘  └────┬────┘  └─────────┘   │  │      │    │
│  └───────│────────────│───────────│──────────────────────┘  │      │    │
│          │            │           │                         │      │    │
└──────────│────────────│───────────│─────────────────────────┘      │    │
           │            │           │                                │    │
           ▼            │           │                                │    │
    ┌──────────────┐    │           │    2. Fetch context ───────────┘    │
    │              │    │           │    5. Commit logs ──────────────────┘
    │  ANTHROPIC   │    │           │
    │  CLAUDE API  │    │           │
    │              │    │           │
    │  3. Generate │    │           │
    │     response │    │           │
    └──────────────┘    │           │
                        │           │
                        │           ▼
                        │    ┌──────────────┐
                        │    │   TELEGRAM   │
                        │    │     API      │
                        └───▶│  4. Send msg │
                             └──────────────┘
```

### Request Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           WORKOUT LOGGING FLOW                                  │
└─────────────────────────────────────────────────────────────────────────────────┘

User: "OHP 115: 6, 5, 5 @8"
         │
         ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  1. PARSE       │     │  2. BUILD       │     │  3. CALL        │
│                 │────▶│     CONTEXT     │────▶│     CLAUDE      │
│  parser.ts      │     │                 │     │                 │
│  Extract:       │     │  - User profile │     │  Prompt:        │
│  - Exercise     │     │  - Today's plan │     │  - System rules │
│  - Weight: 115  │     │  - Logged sets  │     │  - Context      │
│  - Reps: 6,5,5  │     │  - Fatigue data │     │  - User message │
│  - RPE: 8       │     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
         ┌──────────────────────────────────────────────┘
         ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  4. RESPOND     │     │  5. UPDATE      │     │  6. COMMIT      │
│                 │────▶│     STATE       │────▶│     LOG         │
│  "Good set!     │     │                 │     │                 │
│   RPE 8 on OHP  │     │  Track:         │     │  GitHub:        │
│   is solid..."  │     │  - Session logs │     │  weeks/W03/     │
│                 │     │  - Phase        │     │  monday.md      │
└─────────────────┘     └─────────────────┘     └─────────────────┘


┌─────────────────────────────────────────────────────────────────────────────────┐
│                          WEEKLY PLANNING FLOW (Sundays)                         │
└─────────────────────────────────────────────────────────────────────────────────┘

Cron trigger (Sunday evening)
         │
         ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  1. FETCH       │     │  2. ANALYZE     │     │  3. BUILD       │
│     CONTEXT     │────▶│     BEHAVIOR    │────▶│     PROMPT      │
│                 │     │                 │     │                 │
│  - Profile      │     │  Compare:       │     │  Include:       │
│  - Last 4 weeks │     │  - Stated: 5d   │     │  - Profile      │
│    of logs      │     │  - Actual: 3.2d │     │  - Logs         │
│  - Exercise     │     │  - Adherence %  │     │  - Behavioral   │
│    variations   │     │  - RPE trends   │     │    analysis     │
│  - Current plan │     │  - Progression  │     │  - Fatigue      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
         ┌──────────────────────────────────────────────┘
         ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  4. GENERATE    │     │  5. COMMIT      │     │  6. NOTIFY      │
│     PLAN        │────▶│     PLAN        │────▶│     USER        │
│                 │     │                 │     │                 │
│  Claude:        │     │  GitHub:        │     │  Telegram:      │
│  - Adapts to    │     │  weeks/W04/     │     │  "New week      │
│    actual       │     │  plan.md        │     │   ready. Focus: │
│    behavior     │     │                 │     │   Upper push    │
│  - Adjusts      │     │                 │     │   progression"  │
│    volume/days  │     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### Code Structure

```
src/
├── api/                    # Vercel serverless entry points
│   ├── telegram.ts         #   Webhook handler for Telegram messages
│   └── cron.ts             #   Scheduled tasks (morning, weekly)
│
├── handlers/               # Request handlers
│   ├── message.handler.ts  #   Process incoming Telegram messages
│   ├── command.handler.ts  #   Handle /commands
│   └── cron.handler.ts     #   Morning check-ins, weekly planning
│
├── services/               # External service integrations
│   ├── claude.service.ts   #   Anthropic API wrapper
│   ├── github.service.ts   #   GitHub API for data storage
│   ├── telegram.service.ts #   Telegram Bot API
│   └── state.service.ts    #   Session state management
│
├── prompts/                # AI prompt templates
│   ├── system.prompt.ts    #   Base coaching personality + rules
│   ├── morning.prompt.ts   #   Daily check-in prompts
│   ├── workout.prompt.ts   #   During-workout prompts
│   ├── post-workout.prompt.ts  # Session analysis prompts
│   └── planning.prompt.ts  #   Weekly planning prompts
│
├── utils/                  # Utilities
│   ├── parser.ts           #   Parse exercise logs from text
│   ├── context-builder.ts  #   Build context + behavioral analysis
│   ├── markdown.ts         #   Format data as markdown
│   └── date.ts             #   Date/week utilities
│
└── types/                  # TypeScript types
    ├── workout.ts          #   WorkoutLog, ExerciseLog, etc.
    ├── telegram.ts         #   Telegram API types
    └── ...
```

## Getting Started

See **[DEPLOY.md](DEPLOY.md)** for full setup instructions, including:
- Creating your Telegram bot
- Setting up your private data repository
- Deploying to Vercel
- Configuring environment variables
- Local development setup

**Quick start**: Fork this repo → Deploy to Vercel → Set environment variables → Configure Telegram webhook → Start training!

## Usage

### Logging Format

Log your exercises in Telegram using this format:

```
OHP 115: 6, 5, 5 @8
```

- `Exercise Weight: rep, rep, rep`
- `@number` = RPE (rate of perceived exertion, 1-10)
- `+weight` = added weight for bodyweight exercises: `Dips +25: 8, 7`
- Times for holds: `Hollow: 35s, 30s`

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Initialize the bot |
| `/today` | Get today's workout plan |
| `/skip` | Mark today as skipped |
| `/done` | Finish workout and get analysis |
| `/plan` | Trigger weekly planning (run on Sundays) |

## How It Works

### Daily Flow

1. **Morning (8am)** - Bot sends check-in with today's plan
2. **Pre-workout** - Tell the bot you're heading to the gym
3. **During workout** - Log sets as you complete them
4. **Post-workout** - Bot analyzes your session and gives feedback

### Weekly Planning (Sundays)

1. Bot reads your logs from the past week
2. Analyzes volume, RPE trends, and progress
3. Generates next week's plan with appropriate progressions
4. Commits the plan to your data repo

### Progressive Overload Logic

The bot recommends weight increases when:
- You hit the top of your rep range
- RPE is below 8 on final sets
- Form notes are positive

Standard increments: +5 lbs barbell, +2.5-5 lbs dumbbells

### Deload Detection

The bot recommends a deload when 4+ weeks since last AND:
- RPE consistently >8.5 on main lifts
- Reps declining at same weight for 2+ sessions
- Sleep/energy consistently below 6/10
- You report unusual fatigue or soreness

## Tech Stack

- **Runtime**: Node.js 20+ on Vercel Serverless Functions
- **AI**: Claude API (Anthropic)
- **Messaging**: Telegram Bot API
- **Data Storage**: GitHub (your private repo)
- **Language**: TypeScript

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

Built with Claude by Anthropic.
