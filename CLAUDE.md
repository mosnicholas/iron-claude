# IronClaude Development

## Architecture

### Two-Repo Setup
- **workout-routine** (this repo): System code, coaching logic, bot infrastructure
- **fitness-data** (private): Personal profile, workout logs, PRs, plans, retrospectives

### Repo Structure

```
workout-routine/
├── src/                  # Bot source code
├── scripts/              # Deployment and setup scripts
├── .env.example          # Environment template
└── CLAUDE.md             # This file
```

## Development Guidelines

### Code Style
- TypeScript for all source files
- Prefer async/await over callbacks
- Keep functions small and focused
- Use descriptive variable names
- **Always run `npm run lint:fix` after making code changes** to auto-format and fix issues
- Run `npx knip` periodically to detect unused code/dependencies

### Environment
- Uses Fly.io for deployment (Docker container with Express server)
- Telegram bot integration
- GitHub API for data persistence
- **Fly CLI**: Use `~/.fly/bin/fly` (not in PATH by default)

### Testing Changes
- Run `npm run dev` for local development
- Test bot commands via Telegram before deploying

## Claude Behavior

### Skills Reference
- `/plan-week` - Weekly planning workflow (includes progressive overload & deload logic)
- `/analyze` - Progress analysis and recommendations

### After Creating/Updating a Plan
1. Commit plan to athlete's fitness-data repo
2. Summarize changes to athlete via Telegram
3. Update any relevant files (prs.yaml if PRs mentioned, learnings.md if patterns noted)

### After Logging a Workout
1. Save workout log to `workouts/YYYY-MM-DD.md`
2. Check for new PRs and update `prs.yaml` if found
3. Provide brief feedback on the session
4. Note any patterns for `learnings.md`

### Weekly Planning Flow (Sundays)

The weekly planning is **interactive** - questions first, then plan:

1. **Cron triggers** (Sunday 8pm): Sends coaching questions via Telegram
   - "How are you feeling? Any fatigue or soreness?"
   - "Any schedule changes this week?"
   - "Anything you want to focus on?"

2. **User responds**: Their input is captured by the webhook

3. **Plan generation**: `generatePlanWithContext()` creates the plan incorporating their input
   - Adjusts intensity based on fatigue/energy
   - Works around schedule constraints
   - Prioritizes requested focus areas

4. **State tracking**: `state/planning-pending.json` in fitness-data tracks pending planning

**Key files:**
- `src/cron/weekly-plan.ts` - Cron job and plan generation
- `src/handlers/webhook.ts` - Detects pending planning state
- `src/storage/github.ts` - Planning state management

### Weekly Analysis
1. **Read**: profile.md, learnings.md, last 2-4 weeks of workouts/plans
2. **Analyze**: Weight progression, volume, RPE, skill progress, fatigue markers
3. **Update**: PRs if new records, learnings.md if new patterns emerge
4. **Create**: Retrospective in `retrospectives/`

### Data Updates
All athlete data changes go to their fitness-data repo:
- `profile.md` - Goals, preferences, limitations
- `learnings.md` - Coaching observations
- `prs.yaml` - Personal records
- `workouts/` - Session logs
- `plans/` - Training plans
- `retrospectives/` - Weekly analysis
