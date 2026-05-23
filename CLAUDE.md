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
├── tests/scenarios/      # Agent scenario tests (end-to-end, calls real model)
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

### Date Handling
**Always use `src/utils/date.ts` for date manipulations** - never use inline `new Date()` formatting.

Key functions:
- `getDateInfoTZAware()` - Get comprehensive date info (date, time, dayOfWeek, isoWeek, timezone) - pulls timezone from `TIMEZONE` env var
- `getTimezone()` - Get configured timezone from env (defaults to America/New_York)
- `getCurrentWeek(timezone?)` - Get current ISO week string (e.g., "2026-W05")
- `getToday(timezone?)` - Get today's date as YYYY-MM-DD
- `getDayNameInTimezone(date, timezone)` - Get day name for a date in a specific timezone
- `formatISOWeek(date)` - Format a Date as ISO week string

The `getDateInfoTZAware()` function includes sanity checks and logging to help debug timezone issues.

### Environment
- Uses Fly.io for deployment (Docker container with Express server)
- Telegram bot integration
- GitHub API for data persistence
- **Fly CLI**: Use `~/.fly/bin/fly` (not in PATH by default)

### Testing

**Unit tests** (no API key needed, fast):
```bash
npm test              # 268 tests — runs in ~10s
```

**Scenario tests** (requires `ANTHROPIC_API_KEY`, calls real model):
```bash
ANTHROPIC_API_KEY=sk-... npm run test:scenarios   # 10 tests — runs in ~2 min
```

Scenario tests validate end-to-end agent behavior by:
1. Creating an isolated temp repo with fixture data (profile, PRs, plan, learnings)
2. Running the real CoachAgent (Haiku model) against it
3. Asserting on **file side effects** (workout file created, prs.yaml updated, session state)

Test suites:
- `tests/scenarios/workout-logging.test.ts` — creates workout files, appends exercises
- `tests/scenarios/pr-detection.test.ts` — detects new PRs, ignores sub-PR weights
- `tests/scenarios/session-flow.test.ts` — workout completion, general chat isolation
- `tests/scenarios/response-quality.test.ts` — concise responses, no fabrication, correct dates

**After making changes to coaching logic, prompts, or tools, always run scenario tests** to catch regressions.

To add a new scenario test, use the existing pattern:
- Add fixtures to `tests/scenarios/fixtures.ts` if needed
- Use `setupTestRepo()` from `tests/scenarios/setup.ts` to create isolated repos
- Assert on file side effects using helpers from `tests/scenarios/assertions.ts`
- Use `createCoachAgent({ repoPath, model: "claude-haiku-4-5", maxTurns: 15 })` for the agent

### Local Development
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

### Git Workflow
**Always push after committing.** When you `git add` and `git commit` changes to the fitness-data repo, follow up with `git push` to ensure the remote is up to date. Do not leave commits unpushed.

### After Logging a Workout
1. Save workout log to `weeks/YYYY-WXX/YYYY-MM-DD.md` (in the appropriate week folder)
2. Check for new PRs and update `prs.yaml` if found
3. Provide brief feedback on the session
4. Note any patterns for `learnings.md`

### Nutrition Coaching

Nutrition logging shares the per-day file with the workout — `weeks/YYYY-WXX/YYYY-MM-DD.md` — under a `## Nutrition` section. Each meal is a `### Meal (HH:MM)` block with one item per line and a `_Subtotal: ..._` footer. Frontmatter carries the rolled-up daily totals (`protein_g`, `kcal`, optionally `carbs_g`, `fat_g`) so other code can read totals without re-parsing the meal body.

**Tools** (`src/coach-v2/tools/nutrition.ts`):
- `lookup_food(query, limit?)` — searches USDA FoodData Central, returns top matches with per-100g macros. The agent calls this BEFORE log_meal to ground macros — this is the fix for the fabrication bug where the coach was guessing protein values.
- `log_meal({ meal, items, notes?, date? })` — appends a meal section and recomputes the daily rollup. Auto-creates the daily file if absent. `start_workout` now upgrades a nutrition-only file in place rather than refusing.

**USDA API**: free tier via `USDA_API_KEY` (or `DEMO_KEY` rate-limited fallback). Get a key at https://fdc.nal.usda.gov/api-key-signup.html.

**Macro targets** live in `profile.md` under `## Nutrition` if the athlete has configured them. The current daily rollup is surfaced to the coach in the dynamic state block (`Today's nutrition rollup`) so it can give "you're at X, need Y more by EOD" feedback without an extra tool call.

**Photo input**: meal photos flow through the existing webhook → image block → coach handler path. The prompt instructs the coach to identify visible items, call `lookup_food` for each, then `log_meal`.

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
- `weeks/` - Week-based organization (YYYY-WXX folders)
  - `weeks/YYYY-WXX/plan.md` - Weekly training plan
  - `weeks/YYYY-WXX/retro.md` - Weekly retrospective
  - `weeks/YYYY-WXX/YYYY-MM-DD.md` - Workout logs (with device integration data)

## Device Integrations

### Current Integrations
- **Whoop** - Sleep, recovery scores, HRV, and workout strain data
  - **OAuth note:** Whoop's token endpoint requires `Content-Type: application/x-www-form-urlencoded` (not JSON) for all token requests (exchange and refresh). See `src/integrations/whoop/oauth.ts`.

### Using Integration Data
Integration data is stored with key metrics in frontmatter for programmatic access, and full details in a readable markdown table:

```markdown
---
date: "2026-01-27"
type: upper
status: in_progress
recovery_score: 78
sleep_hours: 7.0
---
# 2026-01-27

## Whoop Data

| Metric | Value |
|--------|-------|
| Recovery Score | 78% |
| HRV | 45.2 ms |
| Resting HR | 52 bpm |
| Sleep Duration | 7h 0m |
| Sleep Score | 85% |
| Deep Sleep | 90 min |
| REM Sleep | 85 min |
| Light Sleep | 180 min |

*No workout logged yet.*
```

When integrations are configured, check recovery data to inform training recommendations:
- **80-100% recovery**: Push intensity, good day for PRs
- **60-79% recovery**: Standard training intensity
- **40-59% recovery**: Consider lighter work or active recovery
- **0-39% recovery**: Prioritize rest

Access key metrics from frontmatter (`frontmatter.recovery_score`, `frontmatter.sleep_hours`) or read the full table for detailed data.

### Adding a New Device Integration

To add a new integration (e.g., Garmin, Oura):

1. **Create the integration folder**: `src/integrations/{device}/`

2. **Implement required files**:
   ```
   src/integrations/{device}/
   ├── index.ts          # Exports
   ├── client.ts         # API client for the device
   ├── oauth.ts          # OAuth flow helpers
   ├── webhooks.ts       # Webhook parsing & normalization
   ├── integration.ts    # DeviceIntegration implementation
   └── setup.ts          # Interactive CLI setup wizard
   ```

3. **Implement the DeviceIntegration interface** (`src/integrations/types.ts`):
   - `isConfigured()` - Check if tokens are set
   - `getAuthUrl()` - Generate OAuth URL
   - `handleOAuthCallback()` - Exchange code for tokens
   - `refreshToken()` - Refresh expired tokens
   - `fetchSleep()`, `fetchRecovery()`, `fetchWorkouts()` - Fetch data
   - `verifyWebhook()`, `parseWebhook()` - Handle webhooks

4. **Register the integration** in `src/server.ts`:
   ```typescript
   import { get{Device}Integration } from "./integrations/{device}/integration.js";
   registerIntegration(get{Device}Integration());
   ```

5. **Add metadata** to `src/integrations/registry.ts`:
   ```typescript
   {
     name: "Device Name",
     slug: "device",
     description: "What data it provides",
     available: true,
     scopes: ["required", "oauth", "scopes"],
     docsUrl: "https://developer.example.com",
   }
   ```

6. **Update setup scripts**:
   - Add to `scripts/setup-integration.ts`
   - Add `npm run setup:{device}` to `package.json`

7. **Add tests**: `src/integrations/{device}/webhooks.test.ts`

### Key Integration Files
- `src/integrations/types.ts` - Shared interfaces (SleepData, RecoveryData, etc.)
- `src/integrations/registry.ts` - Integration registration and discovery
- `src/integrations/storage.ts` - Week-based data persistence
- `src/integrations/webhook-handler.ts` - Unified webhook router
