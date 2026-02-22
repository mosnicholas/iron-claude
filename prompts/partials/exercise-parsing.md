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

## Plate Math & Natural Language Weights

Users sometimes describe weights using plate configurations:

| Description | Calculation | Total |
|-------------|-------------|-------|
| "bar with 10s" | 45 (bar) + 10 + 10 | 65 lbs |
| "bar with 25s" | 45 + 25 + 25 | 95 lbs |
| "bar with 45s" / "a plate" | 45 + 45 + 45 | 135 lbs |
| "two plates" / "two plates each side" | 45 + 90 + 90 | 225 lbs |
| "plate and a quarter each side" | 45 + (45+25) + (45+25) | 185 lbs |

Standard barbell = 45 lbs unless stated otherwise.
"Each side" means the weight is on both ends (reflected in total).

When uncertain, confirm: "Bar + 10s each side = 65 lbs total — right?"

## Retroactive Set Descriptions

Users sometimes describe sets after the fact:
- "2 & 3 were with bar & 10lb plates" → Sets 2 and 3 used 65 lbs
- "last set was at 185" → Most recent set used 185 lbs
- "first two were warmup" → Sets 1 and 2 were warmup sets

Update already-logged sets rather than creating new ones.
