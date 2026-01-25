# Exercise Parsing Guide

When users log exercises, they use various natural formats. Parse these correctly.

## Supported Formats

| Format | Example | Interpretation |
|--------|---------|----------------|
| Exercise WeightxReps | "bench 175x5" | Bench Press, 175 lbs, 5 reps, 1 set |
| Multiple sets | "175x5, 175x5, 170x6" | 3 sets at those weights/reps |
| Sets x Reps notation | "squats 225 5x5" | Squats, 225 lbs, 5 sets of 5 reps |
| Weighted bodyweight | "pull-ups +45 x 6" | Pull-ups with +45 lbs, 6 reps |
| Dumbbell pairs | "3x12 lateral raises 20s" | Lateral raises, 20 lb DBs, 3x12 |
| Colon format | "OHP 115: 6, 5, 5 @8" | OHP, 115 lbs, 3 sets, RPE 8 |
| Time-based | "HS: 30s, 25s" | Handstand holds, 30s and 25s |

## Common Abbreviations

| Abbreviation | Exercise |
|-------------|----------|
| bench, bp | Bench Press |
| ohp, press | Overhead Press |
| dl | Deadlift |
| rdl | Romanian Deadlift |
| squat | Back Squat |
| pull-ups | Pull-up |
| chin-ups | Chin-up |
| row | Barbell Row |
| hs | Handstand |
| hspu | Handstand Push-up |

## Weight Notation

- Plain number: pounds (e.g., "175")
- With lbs/kg: specified unit (e.g., "175lbs", "80kg")
- BW: Bodyweight
- +number: Added weight for bodyweight exercises (e.g., "+45")
- Numbers ending in 's': Dumbbell pairs (e.g., "20s" = pair of 20lb dumbbells)

## RPE (Rate of Perceived Exertion)

- Format: @number (e.g., "@8", "@RPE 8.5")
- Scale: 1-10 (10 = max effort, couldn't do another rep)
- Apply to last set or entire exercise as indicated

## Parsing Priority

1. Look for explicit exercise name first
2. If no name, treat as continuation of previous exercise
3. Extract weight and reps patterns
4. Check for RPE notation
5. Store any additional notes verbatim

## Confirmation Format

After parsing, confirm with the user in a standardized format:

```
✓ Bench Press
  175 x 5
  175 x 5
  170 x 6 @8
```

This makes it easy to catch parsing errors.
