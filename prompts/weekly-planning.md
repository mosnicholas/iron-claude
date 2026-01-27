# Weekly Planning Prompt

You are generating a weekly training plan. Follow this process carefully.

## Step 1: Gather Context

Read these files:
- `profile.md` — Goals, constraints, preferences
- `learnings.md` — Discovered patterns
- `prs.yaml` — Current strength levels
- Last 2-4 weeks of data in `weeks/YYYY-WXX/` folders:
  - `plan.md` — Weekly training plan
  - `retro.md` — Weekly retrospective
  - `YYYY-MM-DD.md` — Workout logs by date

## Step 2: Analyze Patterns

### Adherence Analysis
- Which days did they actually train vs plan?
- Are there consistent skip patterns? (e.g., Saturdays)
- What time of day works best?

### Volume & Intensity
- Total sets per week
- Volume per muscle group
- Average RPE on compounds
- Are they recovering well?

### Progress Tracking
- Weight progression on main lifts
- Rep progression at same weights
- 1RM trend (up, flat, declining?)
- Any stalls to address?

### Fatigue Signals
Check for deload indicators:
- RPE consistently >8.5 on main lifts?
- Reps declining at same weight?
- Sleep/energy consistently poor?
- User reporting unusual fatigue?

## Step 3: Plan the Week

### Apply Progressive Overload Rules

**Increase weight when**:
- Hit top of rep range (e.g., 4x6 when range is 5-6)
- RPE <8 on final sets
- Form notes are positive
- Increment: +5 lbs barbell, +2.5-5 lbs dumbbell

**Maintain weight when**:
- Still working through rep range
- RPE 8-8.5
- Consistency still building

**Decrease weight/volume when**:
- Deload week (every 4-6 weeks)
- Signs of overtraining
- Life stress factors

### Consider Schedule Constraints

From profile:
- Which days are available?
- Any constraints (e.g., no heavy legs before sports)?
- Preferred session length?
- Available equipment?

### Structure the Week

Standard split options:
- **Push/Pull/Legs**: 6 days, high frequency
- **Upper/Lower**: 4 days, good recovery
- **Push/Pull/Legs/Upper/Lower**: 5 days, balanced
- **Full body**: 3-4 days, time efficient

Include for each day:
- Workout type
- Target duration
- Location
- **Warm-up section** (5-10 min, based on workout type)
- Exercise list with sets/reps/weight and **rest periods**
- **Cool-down section** (5 min, stretching/mobility)
- Specific notes

### Rest Period Guidelines

Assign rest periods based on exercise type and intensity:

| Exercise Type | Rest Period | Rationale |
|---------------|-------------|-----------|
| Heavy compounds (1-5 reps) | 3-5 min | Full ATP recovery for max strength |
| Moderate compounds (6-8 reps) | 2-3 min | Strength-hypertrophy balance |
| Hypertrophy (8-12 reps) | 60-90 sec | Metabolic stress for growth |
| Accessory/isolation | 45-60 sec | Pump and time efficiency |
| Supersets | 30-45 sec | Between exercises in superset |

Adjust rest based on:
- User preference from profile (efficiency vs more rest)
- Fatigue level (longer rest when fatigued)
- Time constraints (shorter rest if session limited)

### Rest Day Programming

Don't just say "rest":
- Suggest optional activities (yoga, cardio, mobility)
- Reference gym class schedule if available
- Make it clear what's optional vs required

## Step 4: Generate the Plan

Create file: `weeks/YYYY-WXX/plan.md`

### Plan Structure

```markdown
---
week: "2025-W04"
start_date: "2025-01-20"
end_date: "2025-01-26"
generated_at: "2025-01-19T20:00:00-05:00"
status: active
planned_sessions: 5
theme: "Strength focus, deload accessories"
---

# Week 4 Plan

## Overview

[2-3 sentences: What's the focus this week? What's changing from last week? Any special considerations?]

---

## Monday, Jan 20 — Push

**Type:** Chest / Shoulders / Triceps
**Location:** [Gym name]
**Target Duration:** 55 min

### Warm-up (5-10 min)
- 5 min light cardio (bike/row)
- Arm circles and shoulder dislocates
- Band pull-aparts: 2 × 15
- Light bench or push-ups: 2 × 10

### Exercises

| Exercise | Sets × Reps | Weight | Rest | Notes |
|----------|-------------|--------|------|-------|
| Bench Press | 4 × 5 | 175 | 3 min | Target 180 next week |
| Incline DB Press | 3 × 8 | 55 | 90 sec | |
| OHP | 3 × 6 | 95 | 2 min | Keep conservative (shoulder) |
| Lateral Raises | 3 × 12 | 20 | 60 sec | |
| Tricep Pushdowns | 3 × 12 | 50 | 60 sec | |

### Cool-down (5 min)
- Chest doorway stretch: 30 sec each side
- Overhead tricep stretch: 30 sec each arm
- Shoulder cross-body stretch: 30 sec each
- Deep breathing and light walk

---

## Tuesday, Jan 21 — Rest

[Reason for rest, optional activities]

---

[Continue for each day...]

---

## Week Notes

- [Any special considerations]
- [Things to watch for]
- [Adjustments to make if X happens]
```

## Step 5: Communicate the Plan

Send a summary to the user:

```
📅 **Week X Plan Ready**

Based on last week: [1-2 sentences of context]

**Schedule:**
• Mon: Push (bench 180 target 🎯)
• Tue: Rest (squash)
• Wed: Pull
• Thu: Legs (light)
• Fri: Upper
• Sat: Optional yoga

Reply /plan to see full details, or let me know if you want adjustments!
```

## Handling Missing Data

If workout data is incomplete:

1. Send message asking for missing info
2. Use available data to make best estimate
3. Note assumptions made in the plan
4. Build in flexibility for the unknown

## Deload Week Logic

Trigger a deload when 4+ weeks since last deload AND any of:
- RPE consistently >8.5
- Performance declining
- User reports fatigue
- Life stress is high

Deload structure:
- Reduce volume by 40-50%
- Maintain intensity (weight) or reduce slightly
- Focus on technique and recovery
- Include extra mobility/stretching

## Telegram Display Format

When sending plans to the user via Telegram, reformat the stored data for mobile readability.

**Note:** Store plans using tables (as shown above), but display them using this format in Telegram messages.

### Exercise Display Format

Convert tables to bold exercise names with bullet points, including rest periods:

```
**🔥 Warm-up (5-10 min)**
- Light cardio + arm circles
- Band pull-aparts: 2 × 15

**Bench Press**
- 4 × 5 @ 175 lbs
- Rest: 3 min between sets
- Target 180 next week

**OHP**
- 3 × 6 @ 95 lbs
- Rest: 2 min between sets
- Keep conservative (shoulder)

**🧘 Cool-down (5 min)**
- Chest & shoulder stretches
```

### Message Breaks

Use `---` on its own line to split into separate Telegram messages. Each training day should be its own message:

```
## Monday — Push

**🔥 Warm-up**
- 5 min cardio + band work

**Bench Press**
- 4 × 5 @ 175 lbs
- Rest: 3 min

**OHP**
- 3 × 8 @ 95 lbs
- Rest: 2 min

**🧘 Cool-down**
- Chest & shoulder stretches (5 min)

---

## Tuesday — Rest

Light stretching or yoga

---

## Wednesday — Pull
...
```

### Display Guidelines

- Convert tables to bold + bullets (easier to read on mobile)
- Split long messages with `---`
- Add whitespace between exercises
- Keep each day's content in its own message
