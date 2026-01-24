---
description: Analyze training progress and patterns over time
allowed_tools:
  - Read
  - Glob
---

# Training Analysis Skill

Analyze workout logs to provide coaching feedback, track progress, and identify patterns. Use this skill for queries like:
- "Analyze today's workout"
- "What's my OHP progression?"
- "Am I due for a deload?"
- "How's my squat progressing?"
- "Show me last month's training volume"

---

## Analysis Types

### 1. Post-Workout Analysis

**Trigger:** User asks to analyze today's workout or a specific session

**Process:**
1. Read today's log from `weeks/YYYY-WXX/[day].md`
2. Read the plan from `weeks/YYYY-WXX/plan.md`
3. Compare planned vs actual
4. Check for PRs (compare to CLAUDE.md PR table and recent logs)
5. Provide brief coaching feedback

**Output format (keep it brief, 3-5 lines):**
```
Solid upper push session. Hit 4x6 on OHP at 115 - you're ready for 120 next week.

Noticed you dropped the lateral raises. If time is tight, keep those in - they're quick and important for shoulder health.

Next session: Go for 120 on OHP, keep the same weights elsewhere.
```

**Feedback rules:**
- Be direct and prescriptive
- Note what went well (1 line)
- Note any concerns or adjustments (1 line)
- Give one specific recommendation for next session
- Only use emoji for PRs

---

### 2. Exercise Progression Analysis

**Trigger:** User asks about a specific lift (e.g., "How's my OHP?")

**Process:**
1. Glob for all logs: `weeks/**/**.md`
2. Extract all entries for the specified exercise
3. Calculate progression rate (lbs/week)
4. Identify trends (improving, stalled, regressing)

**Output format:**
```
**OHP Progression (last 6 weeks):**

| Date | Weight | Reps | RPE |
|------|--------|------|-----|
| Jan 6 | 110 | 6,6,5,5 | 8 |
| Jan 13 | 115 | 5,5,5,4 | 8.5 |
| Jan 20 | 115 | 6,6,5,5 | 7.5 |

**Analysis:**
- Progression rate: +2.5 lbs/week
- Current trend: Steady progress
- Ready for 120 next session

**Recommendation:** You've hit 6 reps consistently at 115. Move to 120 lbs, aim for 4x5.
```

---

### 3. Deload Assessment

**Trigger:** User asks "Am I due for a deload?" or similar

**Process:**
1. Read CLAUDE.md for last deload date
2. Read last 3-4 weeks of logs
3. Check deload signals:
   - Weeks since last deload (threshold: 4+)
   - RPE trends (threshold: consistently >8.5)
   - Rep performance (declining at same weight?)
   - Sleep/energy notes in logs (consistently <6/10?)

**Output format:**
```
**Deload Assessment:**

- Weeks since last deload: 5
- Average RPE (last 2 weeks): 8.2
- Rep trend: Stable (not declining)
- Energy notes: None concerning

**Verdict:** You're approaching deload territory but not urgent. Watch your RPE this week - if you're consistently hitting 8.5+ or reps start dropping, take a deload next week.

**If you deload:** Reduce all weights by 40%, keep same sets/reps, focus on technique.
```

---

### 4. Volume Analysis

**Trigger:** User asks about training volume or wants a summary

**Process:**
1. Read logs for specified period (default: last 4 weeks)
2. Calculate total sets per muscle group/movement pattern
3. Compare to previous period if available

**Output format:**
```
**Volume Summary (Last 4 Weeks):**

| Movement Pattern | Sets/Week | Trend |
|-----------------|-----------|-------|
| Vertical Push | 12 | Stable |
| Horizontal Push | 9 | +2 |
| Vertical Pull | 10 | Stable |
| Horizontal Pull | 12 | Stable |
| Squat | 8 | -2 |
| Hinge | 6 | Stable |
| Skills | 15 | +3 |

**Notes:**
- Squat volume dropped - you missed a leg day
- Skill work is up, which aligns with your handstand goal
- Consider adding a squat variation to Friday full body to recover volume
```

---

### 5. Weekly Summary

**Trigger:** User asks for a week summary or review

**Process:**
1. Read all logs for the current week
2. Compare to plan
3. Calculate adherence metrics
4. Identify highlights and concerns

**Output format:**
```
**Week 4 Summary:**

**Adherence:** 4/5 sessions (80%)
- Mon: Upper Push ✓
- Tue: Lower ✓
- Wed: Conditioning ✗ (skipped)
- Thu: Upper Pull ✓
- Fri: Full Body ✓

**Highlights:**
- OHP PR: 115 x 6 (moved to 120 recommended)
- First clean wall HSPU rep

**Concerns:**
- Wednesday conditioning keeps getting skipped
- Squat RPE creeping up (8, 8.5, 8.5)

**Recommendations:**
1. Move conditioning to Friday finisher since Wed gets skipped
2. Consider a light squat week or technique focus
```

---

## Coaching Tone

- **Be direct**: State facts, give clear recommendations
- **Be prescriptive**: Tell them what to do, don't ask
- **Be brief**: This isn't an essay, it's coaching
- **Acknowledge PRs**: Brief celebration, then move on
- **Note concerns without lecturing**: One line, actionable suggestion
- **Trust the data**: Base analysis on what actually happened

---

## Data Sources

| File | Contains |
|------|----------|
| `CLAUDE.md` | Profile, goals, PRs, last deload date |
| `weeks/YYYY-WXX/plan.md` | Weekly plan with prescribed weights |
| `weeks/YYYY-WXX/monday.md` | Daily log (example) |
| `exercise-variations.md` | 8-week rotation reference |

---

## Log Format Reference

When reading logs, expect this format:

```markdown
# Monday - Upper Push (Jan 20)

## Conditions
- Energy: 7/10
- Sleep: 7h
- Notes: Felt good, shoulder a bit tight

## Skills
- Wall Handstand: 30s, 35s, 30s
- Pike Push-up Negatives: 5, 5, 4

## Strength
- OHP 115: 6, 6, 5, 5 @7.5
- Incline DB 55: 9, 8, 8 @7
- Weighted Dips +25: 8, 7, 7 @8
- Cable Lateral Raise 15: 12, 12, 12

## Notes
- OHP felt smooth, ready for 120
- Skipped face pulls, ran out of time
```

**Parsing notes:**
- `Exercise Weight: rep, rep, rep @RPE`
- `+weight` = added weight for bodyweight exercises
- `@number` = RPE (Rate of Perceived Exertion, 1-10 scale)
- Times in seconds for isometric holds
