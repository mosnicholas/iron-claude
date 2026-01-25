# Weekly Planning (Sundays)

Generate a personalized training plan for the upcoming week based on logged workout data, behavioral patterns, and profile preferences.

## Workflow

### Step 1: Gather Context

Read the following files:

1. **CLAUDE.md** - User profile, goals, preferences, injury history
2. **exercise-variations.md** - 8-week rotation reference
3. **weeks/** - Last 2-4 weeks of logs and plans

Use glob pattern `weeks/**/plan.md` and `weeks/**/*.md` to find recent data.

### Step 2: Analyze Behavioral Patterns

Before planning, calculate these metrics from the logs:

**Training Frequency:**
- Stated days/week (from CLAUDE.md preferences)
- Actual days/week (count logged workouts)
- Gap between stated and actual

**Exercise Adherence:**
- Main lifts: % completed vs planned
- Accessories: % completed vs planned
- Skills/Conditioning: % completed vs planned

**Intensity Trends:**
- Average RPE across sessions
- RPE range (min - max)
- Trend direction (increasing/stable/decreasing)

**Progression Rates:**
- For each main lift: lbs gained per week
- Identify stalls (same weight 2+ weeks)

**Consistency Patterns:**
- Most reliable training days
- Often missed days

### Step 3: Check for Deload Signals

Recommend deload when 4+ weeks since last deload AND any of:
- RPE consistently >8.5 on main lifts
- Reps declining at same weight for 2+ sessions
- Sleep/energy consistently <6/10
- User reports unusual fatigue/soreness

### Step 4: Apply Progressive Overload Logic

Recommend weight increase when:
- Hit top of rep range (e.g., 4x6 when range is 5-6)
- RPE <8 on final sets
- Form notes are positive

Increment amounts:
- Barbell lifts: +5 lbs
- Dumbbell lifts: +2.5-5 lbs
- Bodyweight: add +2.5-5 lbs or increase reps

### Step 5: Generate the Plan

Create `weeks/YYYY-WXX/plan.md` with:

```markdown
# Week XX Plan (Mon Jan XX - Sun Jan XX)

## Week Focus
- [Primary focus for the week]
- [Any adjustments from behavioral analysis]

## Schedule Overview
| Day | Type | Key Lifts |
|-----|------|-----------|
| Mon | Upper Push | OHP, Incline DB |
| Tue | Lower | Squat, RDL |
| Wed | Conditioning | HIIT |
| Thu | Upper Pull | Pull-ups, Rows |
| Fri | Full Body | DL, Bench |
| Sat | Rest | |
| Sun | Rest | |

---

## Monday - Upper Push

### Skills (do first, fresh)
- Wall Handstand Practice: 5 x 30s holds
- Pike Push-up Negatives: 3 x 5

### Main Work
- **OHP**: 120 lbs - 4x5-6 (increase from 115 if last week was 4x6)
- **Incline DB Press**: 55 lbs - 3x8-10

### Accessories
- Weighted Dips: +25 lbs - 3x8
- Cable Lateral Raise: 15 lbs - 3x12-15

### Notes
[Any specific notes for this session]

---

[Continue for each training day...]
```

### Step 6: Update CLAUDE.md

Update the following in CLAUDE.md:
- Program week number
- Any new PRs from last week
- Notes if behavioral patterns require adjustment

### Step 7: Ask Follow-up Questions

Use AskUserQuestion to check:
- Any travel or schedule changes this week?
- Any new injuries or soreness?
- Energy/motivation level (1-10)?

Adjust the plan based on responses.

---

## Adaptive Coaching Philosophy

**Base recommendations on OBSERVED PATTERNS, not stated preferences.**

### Core Principles

1. **Observe > Assume**: Trust logged data over stated goals
2. **Meet them where they are**: If they train 3x/week consistently, optimize for 3x
3. **Progressive realism**: Set targets based on actual progression rate, not ideal rate
4. **Prioritize ruthlessly**: If accessories get cut, put critical work in main lifts
5. **Acknowledge drift**: When patterns shift, adapt the plan proactively

### When Behavioral Data Conflicts with Stated Preferences

- Trust the data
- Directly acknowledge the gap when presenting the plan
- Example: "I noticed you've been averaging 3 training days, not the 5 planned. This week's plan is optimized for 3-4 days."
- No guilt-tripping, just matter-of-fact adaptation
