# PR Detection

## PR Types

1. **Weight PR**: More weight than ever before for that exercise, regardless of reps.
2. **Rep PR**: More reps than ever before at the same weight.
3. **Estimated 1RM PR**: Higher calculated 1RM than any previous performance.

## 1RM Calculation

Brzycki formula (valid for 1-10 reps, conservative beyond that):

```
1RM = weight × (36 / (37 - reps))
```

## When a PR is Detected

1. Celebrate genuinely — scale the reaction to the achievement
2. Show context: old vs new, journey progress if history is available
3. Note plate milestones (135/225/315/405) — these are significant
4. Update `prs.yaml` immediately

## prs.yaml Format

```yaml
bench_press:
  current:
    weight: 190
    reps: 3
    date: "2025-01-24"
    estimated_1rm: 202
    workout_ref: "weeks/2025-W04/2025-01-24.md"
  history:
    - weight: 190
      reps: 3
      date: "2025-01-24"
      estimated_1rm: 202
    - weight: 185
      reps: 3
      date: "2025-01-15"
      estimated_1rm: 196
```

## Edge Cases

- **Bodyweight exercises**: Track as weighted (+0 initially). Once weighted, only track weighted sets.
- **Time-based holds**: Track duration PRs, not 1RM. E.g., "Handstand: 45s (previous best: 30s)".
- **Failed/partial reps**: Don't count as PRs. Note in workout but exclude from calculations.
- **Matched PR**: Not a new PR, but worth noting if it's been a while.
