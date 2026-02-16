# Weekly Retrospective Prompt

You are generating a weekly retrospective analysis. This runs Saturday evening before Sunday planning.

## Step 1: Gather Data

Read these files:
- `profile.md` — Goals, preferences, **and coaching style**
- Current week's data: `weeks/YYYY-WXX/`
  - `plan.md` — Weekly training plan
  - `YYYY-MM-DD.md` — Workout logs by date
- `prs.yaml` for PR achievements
- `learnings.md` for context

**IMPORTANT**: Pay attention to the "Coaching Style" section in `profile.md`. Apply this style when communicating the retrospective to the user.

## Step 2: Calculate Metrics

### Adherence Rate

**CRITICAL — Verify by reading actual files:**

1. Use Glob to find all workout files: `weeks/YYYY-WXX/????-??-??.md`
2. Read EACH file and check the `status` field in frontmatter
3. Count only files where `status: completed`
4. Do NOT rely on the plan to determine how many workouts happened
5. Check for plan amendments — shifted workouts count for the day they actually happened

```
planned_sessions = count(planned workout days in plan.md)
completed_sessions = count(workout log FILES with status=completed in frontmatter)
adherence_rate = completed_sessions / planned_sessions * 100
```

**Common mistakes to avoid:**
- Don't count `status: in_progress` as completed
- Don't count from the plan — a planned day with no workout file means it was skipped
- If a workout was moved from Friday to Saturday, it still counts as completed (check `planned_day` in frontmatter)

### Volume Analysis

Count total sets per category:
- **Push**: Chest, shoulders, triceps exercises
- **Pull**: Back, biceps exercises
- **Legs**: Quads, hamstrings, glutes, calves

Compare to previous week if available.

### PR Summary
- List all PRs hit this week
- Note type (weight, rep, estimated 1RM)
- Calculate improvement percentage

### Energy Trends
- Average energy level across sessions
- Any sessions with notably low/high energy
- Correlation with performance

### RPE Analysis
Analyze RPE patterns across the week:

**Strength Gains**: Look for exercises where the same RPE now corresponds to higher weights
- Example: "Your @8 on bench was 185 two weeks ago, now it's 195 - you're stronger!"

**Fatigue Detection**: Look for exercises where the same weight requires higher RPE
- Example: "OHP 115 has gone from @7 to @8.5 over 3 sessions - fatigue accumulating"

**Session Difficulty**: Calculate difficulty score for each session
- Based on average RPE, max RPE, and set count
- Categories: Easy (<40), Moderate (40-60), Hard (60-80), Brutal (80+)

## Step 3: Identify Patterns

### Positive Patterns
- What went well?
- Which exercises progressed?
- What scheduling worked?
- Any consistency improvements?

### Concerning Patterns
- Missed sessions (why?)
- Declining performance
- Persistent fatigue
- Recurring skips (same day/exercise)

### Behavioral Insights
- Time of day preferences
- Session duration preferences
- Equipment/exercise preferences
- Response to modifications

## Step 4: Generate Recommendations

Based on analysis, recommend:

1. **For next week's plan**
   - Volume adjustments
   - Exercise swaps
   - Scheduling changes
   - Intensity modifications

2. **For the client**
   - Focus areas
   - Recovery suggestions
   - Habit improvements

3. **For learnings.md**
   - New patterns to record
   - Preferences discovered
   - Important context

## Step 5: Create Retrospective

Create file: `weeks/YYYY-WXX/retro.md`

### Retrospective Structure

```markdown
---
week: "2025-W03"
generated_at: "2025-01-18T18:00:00-05:00"
planned_sessions: 5
completed_sessions: 4
adherence_rate: 80%
---

# Week 3 Retrospective

## Summary

[2-3 sentence overview of the week]

---

## Adherence

| Day | Planned | Actual | Status |
|-----|---------|--------|--------|
| Mon | Push | Push | ✓ Complete |
| Tue | Rest | Rest | ✓ |
| Wed | Pull | Pull | ✓ Complete |
| Thu | Legs | Legs | ⚠️ Partial |
| Fri | Upper | — | → Moved to Sat |
| Sat | Optional | Upper | ✓ Complete (from Fri plan) |
| Sun | Rest | Rest | ✓ |

**Adherence Rate:** 80% (4/5 planned sessions)

*Note: Shifted workouts (e.g., Friday's workout done Saturday) still count toward adherence. Check plan amendments and `planned_day` in workout frontmatter.*

---

## Wins 🎉

- [Specific achievement with numbers]
- [Progress noted]
- [Consistency improvement]
- [Positive habit]

---

## Areas for Improvement

- [Specific issue with context]
- [Pattern to address]
- [Suggested fix]

---

## Volume Analysis

| Category | This Week | Last Week | Change |
|----------|-----------|-----------|--------|
| Push sets | 19 | 18 | +5% |
| Pull sets | 16 | 16 | — |
| Leg sets | 10 | 14 | -28% |
| **Total** | **45** | **48** | **-6%** |

[Brief analysis of volume changes]

---

## PRs This Week

🎉🎉 **Bench Press**: 185 × 3 (WEIGHT PR!)
- Previous: 180 × 3
- Est. 1RM: 196 (+5 lbs)
- Journey: Started at 135 → Now 185 (+50 lbs in 6 months!)

---

## RPE Analysis

### Strength Trends
| Exercise | Old @8 | Current @8 | Change |
|----------|--------|------------|--------|
| Bench Press | 175 | 185 | +5.7% stronger |
| Squat | 225 | 225 | Maintaining |

### Fatigue Indicators
- OHP: RPE creeping up at 115 lbs (7 → 8 over 2 weeks) - watch closely
- No other concerns

### Session Difficulty
| Day | Session | Difficulty | Category |
|-----|---------|------------|----------|
| Mon | Push | 58 | Moderate |
| Wed | Pull | 62 | Hard |
| Fri | Legs | 71 | Hard |

**Weekly Average:** 64 (Hard) - solid training week

---

## Patterns Observed

1. **[Pattern name]**: [Description and implication]
2. **[Pattern name]**: [Description and implication]
3. **[Pattern name]**: [Description and implication]

---

## Recommendations for Next Week

1. [Specific, actionable recommendation]
2. [Specific, actionable recommendation]
3. [Specific, actionable recommendation]
4. [Specific, actionable recommendation]
5. [Specific, actionable recommendation]

---

*Generated automatically on Saturday evening*
```

## Step 6: Update Learnings

If new patterns were discovered:

1. Read current `learnings.md`
2. Add new insights under appropriate category
3. Update date at bottom
4. Commit: "Update learnings: [brief description]"

## Step 7: Notify User

Send summary via Telegram:

```
📊 **Week X Retrospective**

**Adherence:** 4/5 sessions (80%)
**PRs:** Bench 185×3 (Weight PR) 🎉
**Total Volume:** 45 sets

**Wins:**
• Bench moving well
• Consistent morning schedule

**Watch:**
• Thursday energy was low
• Leg volume down

Full retro saved. Ready to plan Week X+1 tomorrow!
```

## Handling Incomplete Data

If workout logs are missing:

1. Note which days are missing
2. Ask user if they want to fill in
3. If no response by planning time:
   - Use available data
   - Note gaps in retrospective
   - Don't penalize adherence for truly missing data
