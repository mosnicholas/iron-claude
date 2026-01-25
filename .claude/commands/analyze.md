# Progress Analysis

Analyze workout data and answer questions about training progress, patterns, and recommendations.

## Capabilities

This skill handles queries like:
- "Analyze today's workout"
- "What's my OHP progression?"
- "Am I due for a deload?"
- "Show me last month's volume"
- "How's my squat progressing?"
- "Compare this week to last week"

## Workflow

### Step 1: Understand the Query

Parse the user's question to determine:
- **Time range**: Today, this week, last month, all time, specific dates
- **Focus area**: Specific lift, overall progress, fatigue/recovery, skills
- **Analysis type**: Trend, comparison, recommendation, summary

### Step 2: Gather Data

Read relevant files:
- **CLAUDE.md** - Profile, PRs, goals
- **weeks/** - Workout logs matching the time range

Use glob patterns like:
- `weeks/2026-W*/plan.md` - All weekly plans
- `weeks/2026-W04/*.md` - Specific week's logs
- `weeks/**/monday.md` - All Monday sessions

### Step 3: Perform Analysis

**For lift progression:**
- Extract all instances of the lift from logs
- Track weight × reps over time
- Calculate trend (increasing/stalling/decreasing)
- Note RPE patterns
- Identify PRs

**For deload assessment:**
- Count weeks since last deload
- Check RPE trends (>8.5 consistently = fatigue)
- Look for rep decline at same weight
- Check for user-reported fatigue

**For volume analysis:**
- Sum sets per muscle group per week
- Compare to previous weeks
- Identify any significant changes

**For daily analysis:**
- Compare planned vs actual
- Note any missed exercises
- Highlight PRs or notable performances
- Flag concerning RPE or form notes

### Step 4: Present Findings

Format response based on query type:

**Lift Progression Example:**
```
## OHP Progression (Last 4 Weeks)

| Week | Weight | Reps | RPE | Notes |
|------|--------|------|-----|-------|
| W01  | 110    | 6,6,5,5 | 8 | Solid |
| W02  | 115    | 6,5,5,5 | 8.5 | Grind on last set |
| W03  | 115    | 6,6,5,5 | 8 | Better |
| W04  | 115    | 6,6,6,5 | 7.5 | Ready for 120 |

**Trend:** Steady progress. Weight held while reps improved.
**Recommendation:** Increase to 120 lbs next session.
```

**Deload Assessment Example:**
```
## Deload Check

- Weeks since last deload: 5
- Recent RPE average: 8.2
- Rep trends: Stable
- Energy/sleep notes: None logged

**Assessment:** Not yet needed. Monitor for another 1-2 weeks.
If RPE climbs above 8.5 or reps start declining, schedule deload.
```

**Daily Analysis Example:**
```
## Today's Session Analysis

**Completed:** 4/5 planned exercises
**Missed:** Cable lateral raises (time constraint)

**Highlights:**
- OHP: 120 × 6,6,5,5 @8 - New weight PR!
- Weighted dips: +30 × 8,7,7 - Strong performance

**Notes:**
- Good session overall
- OHP progressing well, stay at 120 next week
- Consider supersetting laterals with another exercise to save time
```

## Analysis Principles

1. **Be specific** - Use actual numbers from logs
2. **Be actionable** - End with clear recommendations
3. **Be honest** - If data is limited, say so
4. **Be concise** - Focus on what matters for the query
5. **Update PRs** - If a PR was hit, offer to update CLAUDE.md
