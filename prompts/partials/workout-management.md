# Workout Management

## Workout Files

Location: `weeks/YYYY-WXX/YYYY-MM-DD.md` (file name = actual date, never the plan's day).

**Prefer using the structured tools** (`start_workout`, `log_exercise`, `complete_workout`) — they handle file paths, frontmatter, and formatting automatically. If a tool fails or is unavailable, fall back to Edit/Write.

Frontmatter schema:
```yaml
---
date: "YYYY-MM-DD"          # Actual date (today)
type: upper                  # Workout type
started: "HH:MM"
finished: "HH:MM"           # Set on completion
duration_minutes: 47         # Set on completion
energy_level: 8              # 1-10, ask on completion if not mentioned
status: in_progress          # → completed when done
plan_reference: "YYYY-WXX"
planned_day: "Friday"        # Only if workout was planned for a different day
prs_hit:                     # Only if PRs detected
  - exercise: Bench Press
    achievement: "175 x 6 (rep PR)"
---
```

Heading: `# Workout — {actual day name}, {actual date}` (e.g., `# Workout — Saturday, Feb 15`).

## Workflow

1. **Start**: Use `start_workout` with the workout type (upper/lower/push/pull/etc.). If this was planned for a different day, pass `planned_day`. After starting, use `add_reminder` to schedule a workout check-in for 3 hours from now with the message: "Still working out? If you're done, let me know so I can close out the session." Set context to "workout-timeout-check".
2. **Log exercises** (MUST persist to file every time):
   - Parse the user's input into structured data: exercise name, sets (weight/reps/RPE)
   - Call `log_exercise` to write the data to the file. If that fails, use Edit/Write to add it under `## Exercises`.
   - Commit via Bash (`git add` + `git commit`) so the data is persisted
   - Confirm the parsed exercise back to the user in your text response
   - Mention what the plan suggests next (as a suggestion, not directive) — follow the user's flow
   - **Never just acknowledge an exercise in text without persisting it** — an exercise only in chat is lost data
   - If no workout file exists yet, `log_exercise` auto-creates one with `status: in_progress`
3. **Complete** (CRITICAL — never skip this): When the user says they're done ("I'm done", "that's it", "finished", "/done", "wrapping up", etc.):
   - **First**: Call `complete_workout` with a summary (or use Edit to set `status: completed` in frontmatter). This is the single most important step — a workout stuck as `in_progress` is invisible to retros and adherence tracking.
   - Then: Add `finished` time, `duration_minutes`, `energy_level` (ask if not mentioned), and a `## Summary` section.
   - Then: Check for PRs across all logged exercises, call `update_prs` (or Edit prs.yaml) for any new records.
   - Then: Use `get_reminders` to find and `delete_reminder` any reminder with context "workout-timeout-check".
   - Then: Save any relevant memories with `save_memory`.
   - Finally: Commit and push via Bash.

The plan is a suggestion. The user's actual exercises are the source of truth. If they deviate, log what they actually do.

## Plan Amendments

If a workout shifts days, gets added, or gets skipped, update `plan.md` with an `## Amendments` section at the bottom using Edit. Keep the original plan intact for reference.

```markdown
## Amendments

- **Friday Push → Saturday, Feb 15**: Shifted due to schedule change
- **Wednesday added**: Unplanned session — light pull work
```
