# Workout Coaching Context

## Profile
- Name: Nick
- Location: NYC
- Gym: Equinox
- Experience: Advanced (3+ years lifting), Early intermediate calisthenics

## Goals
### Primary
- Build strength (main lifts)
- Lose fat
- Calisthenics skills: handstand push-ups, planche

### Targets (with dates)
- [ ] Freestanding handstand: 30s by [date]
- [ ] Wall HSPU: 5 reps by [date]
- [ ] OHP: 135 lbs x 5 by [date]
- [ ] Weighted pull-up: +45 lbs x 5 by [date]
- [ ] Back squat: [target] by [date]
- [ ] Planche: Tuck hold 10s by [date]

## Preferences
- Anti-boredom: Rotate exercises every 2 weeks (see exercise-variations.md)
- Skill-first: Always do calisthenics when fresh
- Session length: 45-60 min max
- 5 days on, 2 rest (Sat/Sun rest)

## Current Status
- Program week: 1 of 8 (starting fresh)
- Last deload: N/A (starting tracking)
- Current bodyweight: [update when known]

## Recent PRs (update as achieved)
<!-- Claude will track these from logs automatically -->
| Exercise | Weight | Reps | Date |
|----------|--------|------|------|
| | | | |

## Injuries & Limitations
<!-- Empty unless injured -->
- None currently

## Equinox/NYC Context
- Classes available: Yoga, Pilates, cycling, HIIT, etc.
- Preferred location: [location]
- Schedule constraints: [any]

## Notes for Claude
- I respond well to direct feedback
- Push me on weights when form is good
- Remind me about mobility on rest days
- Reference weekly-routine.md for base program structure
- Reference exercise-variations.md for 8-week rotation

---

## Coaching Logic Reference

### Deload Recommendation
Recommend deload when 4+ weeks since last deload AND any of:
- RPE consistently >8.5 on main lifts
- Reps declining at same weight for 2+ sessions
- Sleep/energy consistently <6/10
- User reports unusual fatigue/soreness

### Progressive Overload
Recommend weight increase when:
- Hit top of rep range (e.g., 4x6 when range is 5-6)
- RPE <8 on final sets
- Form notes are positive
- Increment: +5 lbs barbell, +2.5-5 lbs DB

### Weekly Workflow (Sundays)
1. Read: CLAUDE.md, last 2-4 weeks in weeks/ (plan + logs)
2. Analyze: Weight progression, volume, RPE, skill progress, fatigue
3. Generate: Next week's plan.md in weeks/YYYY-WXX/
4. Update: CLAUDE.md with program week, PRs, notes
