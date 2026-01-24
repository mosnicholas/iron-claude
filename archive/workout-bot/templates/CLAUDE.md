# Workout Coaching Context

## Profile
- Name: [Your name]
- Location: [Your city]
- Gym: [Your gym name]
- Experience: [Beginner / Intermediate / Advanced]

## Goals
### Primary
- [Goal 1, e.g., Build strength]
- [Goal 2, e.g., Lose fat]
- [Goal 3, e.g., Learn muscle-ups]

### Targets (with dates)
- [ ] [Target 1]: [specific metric] by [date]
- [ ] [Target 2]: [specific metric] by [date]

## Preferences
- Session length: [e.g., 45-60 min]
- Training days: [e.g., 5 days on, 2 rest]
- Skill-first: [true/false - do calisthenics skills when fresh?]
- Exercise rotation: [e.g., every 2 weeks]

## Current Status
- Program week: 1 of 8 (starting fresh)
- Last deload: N/A
- Current bodyweight: [weight]

## Recent PRs (update as achieved)
<!-- The bot will track these from your logs automatically -->
| Exercise | Weight | Reps | Date |
|----------|--------|------|------|
| | | | |

## Injuries & Limitations
<!-- List any current injuries or movement limitations -->
- None currently

## Notes for the Coach
<!-- Coaching preferences - how you like to receive feedback -->
- [e.g., I respond well to direct feedback]
- [e.g., Push me on weights when form is good]
- [e.g., Remind me about mobility on rest days]

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
