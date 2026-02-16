# Historical Data Exploration

## When to Look at Historical Data

You should actively explore past workout data when:

1. **Generating a retrospective** — read ALL workout files in the week folder, not just what's in your context
2. **Planning a new week** — review the last 2-4 weeks of workouts, plans, and retros
3. **Answering progress questions** — "how's my bench trending?", "am I getting stronger?"
4. **Detecting patterns** — consistency, scheduling preferences, exercise preferences
5. **Setting targets** — use historical performance to set realistic weight/rep goals

## How to Explore the Data

### Finding Week Folders

```
weeks/
├── 2026-W05/
│   ├── plan.md
│   ├── retro.md
│   ├── 2026-01-27.md
│   ├── 2026-01-28.md
│   └── 2026-01-30.md
├── 2026-W06/
│   ├── plan.md
│   ├── 2026-02-02.md
│   └── ...
```

Use `Glob` to find available weeks:
- `weeks/*/plan.md` — all weekly plans
- `weeks/*/retro.md` — all retrospectives
- `weeks/*/*.md` — all files (plans, retros, workouts)
- `weeks/2026-W*/*.md` — all files for 2026

### Counting Completed Workouts

**CRITICAL**: To count completed workouts in a week, you MUST:

1. List all date-named files in the week folder: `weeks/YYYY-WXX/????-??-??.md`
2. Read each file and check `status` in frontmatter
3. Count only files with `status: completed`
4. Do NOT count from the plan — the plan shows what was intended, not what happened
5. Do NOT assume a file exists means the workout was completed — check the status

### Reading Workout Details

Each workout file (`YYYY-MM-DD.md`) contains:
- **Frontmatter**: date, type, status, started/finished times, energy level, PRs
- **Exercises section**: Every exercise with sets, reps, weights, RPE
- **Summary section** (if completed): Plan adherence, observations

### Reading Plans

Each plan file (`plan.md`) contains:
- **Frontmatter**: week, dates, planned sessions, theme
- **Day sections**: Each day with exercises, sets, reps, target weights
- **Amendments section** (if any): Mid-week changes to the plan

### Reading Retrospectives

Each retro file (`retro.md`) contains:
- **Frontmatter**: planned vs completed sessions, adherence rate
- **Adherence table**: Plan vs actual for each day
- **Volume analysis**: Sets per category, week-over-week trends
- **PRs**: Records hit that week
- **RPE analysis**: Strength and fatigue trends
- **Recommendations**: What to adjust going forward

## Important Rules

1. **Always read actual files** — don't rely solely on injected context for retros/planning
2. **Verify workout counts** by reading files, not by referencing the plan
3. **Look at multi-week trends** when making recommendations (at least 2-4 weeks)
4. **Cross-reference** plans with actual workouts to assess adherence accurately
5. **Check for amendments** in plan.md — the plan may have changed mid-week
