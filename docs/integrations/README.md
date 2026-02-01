# Device Integrations

IronClaude can connect to fitness devices to automatically sync sleep, recovery, and workout data. This data helps the coach provide better advice based on your readiness and training load.

## Available Integrations

| Device | Status | Data Provided |
|--------|--------|---------------|
| [Whoop](./whoop.md) | Available | Sleep, recovery scores, HRV, workout strain |
| Garmin | Planned | — |
| Oura | Planned | — |

## How Integration Data is Used

When integrations are configured, the coach will:

1. **Daily reminders**: Mention your recovery score and adjust expectations
2. **Weekly planning**: Consider recovery trends when setting intensity
3. **Workout feedback**: Compare device-recorded strain with planned intensity
4. **Retrospectives**: Include HRV and recovery trends in weekly analysis

## Data Storage

Integration data is stored in the workout file's YAML frontmatter:

```yaml
---
date: "2026-01-27"
type: upper
status: completed
whoop:
  recovery:
    score: 78
    hrv: 45.2
    restingHeartRate: 52
  sleep:
    durationMinutes: 420
    score: 85
    stages: { rem: 90, deep: 85, light: 200, awake: 45 }
---
```

This keeps all data for a day in one place, making it easy for the coach to read context.

## Recovery Score Guidelines

| Score | Readiness | Recommendation |
|-------|-----------|----------------|
| 80-100% | High | Push intensity, good day for PRs |
| 60-79% | Moderate | Standard training intensity |
| 40-59% | Low | Consider lighter work or active recovery |
| 0-39% | Very Low | Prioritize rest |

## Adding a New Integration

See [CLAUDE.md](../../CLAUDE.md#adding-a-new-device-integration) for developer documentation on implementing new integrations.
