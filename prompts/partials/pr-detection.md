# PR Detection Guide

## What Counts as a PR

There are three types of personal records:

### 1. Weight PR
**Definition**: Lifting more weight than ever before for that exercise, regardless of reps.

**Example**: If best previous bench was 185x3, doing 190x1 is a weight PR.

**Celebration level**: High 🎉🎉

### 2. Rep PR (at a specific weight)
**Definition**: More reps than ever before at the same weight.

**Example**: If best at 175 was 5 reps, doing 175x6 is a rep PR.

**Celebration level**: Medium 🎉

### 3. Estimated 1RM PR
**Definition**: Higher calculated 1RM than any previous performance.

**Formula**: 1RM = weight × (36 / (37 - reps)) [Brzycki formula]

**Example**: 175x6 (est 1RM: 203) beats previous best of 185x3 (est 1RM: 196).

**Celebration level**: Medium 📈

## PR Detection Logic

For each exercise logged:

1. **Extract best set**
   - Find the set with highest estimated 1RM
   - Skip time-based sets (holds, cardio)
   - Skip bodyweight-only sets (unless weighted)

2. **Compare to history**
   ```
   current_1rm = calculate_1rm(weight, reps)

   is_weight_pr = weight > max(all_previous_weights)
   is_rep_pr = reps > max(reps_at_same_weight)
   is_1rm_pr = current_1rm > previous_best_1rm
   ```

3. **Prioritize notification**
   - Weight PR > Rep PR > 1RM PR
   - Only announce the highest-level PR

## 1RM Calculation

Using the Brzycki formula (valid for 1-10 reps):

```
1RM = weight × (36 / (37 - reps))
```

| Reps | % of 1RM |
|------|----------|
| 1 | 100% |
| 2 | 95% |
| 3 | 93% |
| 4 | 90% |
| 5 | 87% |
| 6 | 85% |
| 8 | 80% |
| 10 | 75% |

For 10+ reps, the formula becomes less accurate. Use conservatively.

## PR Announcement Format

### Weight PR (Celebrate BIG!)
```
🎉🎉 NEW WEIGHT PR! 🎉🎉
You just moved more iron than ever before!

Bench Press: 190 x 3
Previous best: 185 x 3
+5 lbs!
Est. 1RM: 202 lbs (+6 lbs)
```

### Rep PR
```
🎉 REP PR!
More reps, more glory!

Bench Press: 175 x 6
Previous best at 175: 5 reps
+1 rep!
Est. 1RM: 203 lbs
```

### Estimated 1RM PR
```
📈 New estimated 1RM!
The math says you're stronger!

Bench Press: 175 x 6 (Est. 1RM: 203)
Previous best: 196 lbs
+7 lbs to your estimated max!
```

## Milestone Celebrations (LEGENDARY!)

When someone hits a plate milestone, this is a BIG DEAL. Celebrate accordingly!

### Plate Milestones (lbs)
| Weight | Name | Significance |
|--------|------|--------------|
| 135 | One Plate Club | First major milestone |
| 225 | Two Plate Club | Intermediate strength |
| 315 | Three Plate Club | Advanced lifter |
| 405 | Four Plate Club | Elite territory |
| 495+ | Five Plate Club | Legendary |

### Milestone Announcement Format
```
🏆👑 MILESTONE ACHIEVED! 👑🏆
Welcome to the TWO PLATE CLUB!

Bench Press: 225 x 2
This is a moment to remember!

📈 Your bench journey:
Started: 135 lbs → Now: 225 lbs
Total gain: +90 lbs over 8 months
That's ~11 lbs/month of pure progress!
```

## Journey Context

When celebrating PRs, add context about their journey when history is available:

```
📈 Your Squat journey:
Started: 185 lbs (March 2025)
Now: 275 lbs (January 2026)
Total gain: +90 lbs over 10 months
That's 9 lbs/month of consistent gains!
```

This context makes PRs more meaningful and shows the athlete their progress over time.

## PRs to Track

Track PRs for these movements:

**Primary (always track)**:
- Bench Press
- Squat (Back Squat)
- Deadlift
- Overhead Press
- Weighted Pull-up
- Weighted Chin-up
- Barbell Row

**Secondary (track if logged frequently)**:
- Incline Bench
- Front Squat
- Romanian Deadlift
- Dumbbell Press variants
- Any exercise logged 5+ times

## Updating prs.yaml

When a PR is detected:

1. Add new record to history array
2. Update current if applicable
3. Include workout reference for context

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

**Bodyweight exercises**:
- Track as "weighted" even if +0 lbs initially
- Once weighted, only track weighted sets
- Include bodyweight in notes for context

**Time-based holds**:
- Don't calculate 1RM
- Track as duration PR instead
- "Handstand: 45s (previous best: 30s)"

**Failed/partial reps**:
- Don't count as PRs
- Note in workout but exclude from PR calculation

**Same weight, same reps**:
- Not a PR, but note if it's been a while since achieved
- "Matched your bench PR from 3 months ago!"
