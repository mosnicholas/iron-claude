# Estimated 1RM (e1RM) Tracking Guide

Track estimated 1-rep max for compound lifts to measure strength progress over time.

## What is e1RM?

Estimated 1RM predicts the maximum weight you could lift for a single rep based on submaximal performance. It's safer and more practical than testing actual 1RMs regularly.

## Formula: Epley Method

```
e1RM = weight × (1 + reps/30)
```

**With RPE adjustment** (more accurate):
```
e1RM = weight × (1 + (reps + (10 - RPE))/30)
```

The RPE adjustment accounts for reps left in reserve. If you did 5 reps at RPE 8 (2 reps left), the adjusted formula treats it as if you could have done 7 reps.

## Important: Only Track Sets ≤10 Reps

The formula becomes unreliable beyond 10 reps. Skip high-rep sets when calculating e1RM.

| Reps | Approximate % of 1RM |
|------|---------------------|
| 1 | 100% |
| 3 | 110% ÷ 1.10 = ~91% |
| 5 | 117% ÷ 1.17 = ~85% |
| 8 | 127% ÷ 1.27 = ~79% |
| 10 | 133% ÷ 1.33 = ~75% |

## Compound Lifts to Track

**Primary (always track):**
- Bench Press
- Squat (Back Squat)
- Deadlift
- Overhead Press
- Barbell Row

**Secondary (track if logged frequently):**
- Romanian Deadlift (RDL)
- Front Squat
- Incline Bench
- Weighted Pull-up
- Weighted Chin-up

## After Each Workout

When a workout is completed:

1. **Calculate e1RM for each compound lift**
   - Find the best set (highest e1RM) for each exercise
   - Use RPE-adjusted formula if RPE was logged
   - Skip sets with more than 10 reps

2. **Store in analytics/e1rm-history.yaml**
   - Record date, e1RM, weight, reps, RPE, workout reference
   - Update current best if new PR

3. **Check for e1RM PRs**
   - Compare to previous best e1RM for that exercise
   - Flag if new PR achieved

4. **Show in workout confirmation**
   - Display e1RM with comparison to last session
   - Format: "Squat e1RM: 315 (+5 from last session)"

## e1RM Display Format

### In Workout Confirmations

Show e1RM for each compound lift with comparison:

```
Compound Lift e1RMs:
• Bench Press e1RM: 225 (+5 from last session)
• Squat e1RM: 315 (same as last session)
• Deadlift e1RM: 405 (+10 from last session) 📈 NEW e1RM PR!
```

### e1RM PR Celebration

When a new e1RM PR is hit:

```
📈 e1RM PR!
Deadlift: 405 (+15 from previous best of 390)
Based on: 365 × 4 @ RPE 8
```

## e1rm-history.yaml Format

```yaml
# Estimated 1RM History
# Tracked using Epley formula: weight × (1 + reps/30)

bench_press:
  current_best:
    e1rm: 225
    date: "2025-01-24"
    weight: 205
    reps: 3
  sessions:
    - date: "2025-01-24"
      e1rm: 225
      weight: 205
      reps: 3
      rpe: 8
      workoutRef: "weeks/2025-W04/2025-01-24.md"
    - date: "2025-01-20"
      e1rm: 220
      weight: 185
      reps: 5
      workoutRef: "weeks/2025-W04/2025-01-20.md"

squat:
  current_best:
    e1rm: 315
    date: "2025-01-22"
    weight: 275
    reps: 4
  sessions:
    - date: "2025-01-22"
      e1rm: 315
      weight: 275
      reps: 4
      rpe: 9
      workoutRef: "weeks/2025-W04/2025-01-22.md"
```

## e1RM Trends in Retrospectives

Include e1RM trends in weekly retrospectives:

```markdown
## e1RM Trends

| Exercise | Current e1RM | 4 Weeks Ago | Change |
|----------|-------------|-------------|--------|
| Bench Press | 225 | 215 | ↑ +10 |
| Squat | 315 | 305 | ↑ +10 |
| Deadlift | 405 | 385 | ↑ +20 |
| OHP | 145 | 145 | → 0 |

**Analysis:**
- Deadlift progressing fastest (+20 lbs / 4 weeks)
- OHP plateau - consider programming change
- Overall strength trending up consistently
```

## When to Mention e1RM

- **Always**: In workout completion summaries
- **Always**: When flagging new e1RM PRs
- **Weekly**: In retrospectives, show 4-week trends
- **On Request**: /prs command should include e1RM PRs

## Relationship to Weight PRs

e1RM PRs and Weight PRs are different:

- **Weight PR**: Lifted more absolute weight than ever (e.g., 225×1 vs previous 220×1)
- **e1RM PR**: Higher calculated max than any previous performance (e.g., 205×3 = 225 e1RM vs previous 225 e1RM of 220)

Both are worth celebrating! Weight PRs are more impressive (actually moved more iron), but e1RM PRs still indicate progress.
