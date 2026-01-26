# RPE Analysis Guide

RPE (Rate of Perceived Exertion) is a powerful tool for tracking fatigue and strength gains over time.

## What RPE Tells Us

| RPE | Meaning | Reps Left |
|-----|---------|-----------|
| 6 | Light | 4+ reps left |
| 7 | Moderate | 3 reps left |
| 8 | Hard | 2 reps left |
| 9 | Very Hard | 1 rep left |
| 10 | Maximum | No reps left |

## RPE Pattern Analysis

### Detecting Strength Gains

**The key insight**: If the same RPE now corresponds to a higher weight, you're getting stronger!

**How to spot it**:
- Look at sets logged at @8 over time
- Compare the weights used at that RPE
- Example: "Your @8 used to be 185, now it's 195 - you're 5% stronger!"

**What to tell the athlete**:
```
📈 Strength Trend Alert!
Your bench @8 was 185 lbs in December
Now it's 195 lbs at the same effort level
That's real strength gain - the weights got heavier but the effort stayed the same!
```

### Detecting Fatigue

**The warning sign**: If the same weight now requires a higher RPE, fatigue may be accumulating.

**How to spot it**:
- Look at recent sessions with the same exercise and weight
- Check if RPE is trending upward
- 3+ sessions with increasing RPE at the same weight = fatigue pattern

**What to tell the athlete**:
```
⚠️ Fatigue Pattern Detected
OHP 115 lbs:
- 2 weeks ago: @7
- Last week: @7.5
- This week: @8.5

Same weight is feeling harder. Consider:
- Extra recovery day
- Deload week
- Check sleep/stress/nutrition
```

### Session Difficulty Scoring

Calculate a difficulty score for each workout:

**Formula**:
1. Average RPE across all sets (base score)
2. Bonus for high-intensity sets (RPE 9-10)
3. Volume multiplier (more sets = harder session)

**Categories**:
- Easy (< 40): Recovery session, technique work
- Moderate (40-60): Typical training session
- Hard (60-80): Pushing intensity or volume
- Brutal (80+): PR attempts, heavy singles, max effort day

**Use this for**:
- Weekly load management
- Identifying overreaching
- Correlating performance with recovery

## RPE Analysis in Weekly Retrospectives

Include an RPE section in retrospectives:

```markdown
## RPE Analysis

### Strength Trends
- Bench Press: @8 weight increased from 175 → 185 (+5.7%)
- Squat: Consistent @7-8 at 225 (technique dialed in)

### Fatigue Indicators
- OHP: RPE creeping up at 115 lbs (7 → 8.5 over 3 weeks)
  - Recommendation: Consider deload or extra rest

### Session Difficulty This Week
| Day | Session | Difficulty | Category |
|-----|---------|------------|----------|
| Mon | Push | 65 | Hard |
| Wed | Pull | 52 | Moderate |
| Fri | Legs | 78 | Hard |

Average weekly difficulty: 65 (Hard)
```

## Actionable Insights

When you detect patterns, provide specific recommendations:

**Strength gains detected**:
- "Time to increase your working weights!"
- "Your base fitness is improving - let's push the progression"
- "Consider testing a new max in the next 2-3 weeks"

**Fatigue detected**:
- "Let's schedule a deload week"
- "Add an extra rest day this week"
- "Drop intensity 10-15% and focus on technique"
- "How's sleep been? Stress levels?"

**Consistent RPE**:
- "Technique is dialed in - you're efficient with this weight"
- "Good base established - ready to progress when you feel ready"
