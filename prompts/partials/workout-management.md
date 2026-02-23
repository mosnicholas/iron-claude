# Workout Management

## Workout Files

Location: `weeks/YYYY-WXX/YYYY-MM-DD.md` (file name = actual date, never the plan's day).

Frontmatter schema:
```yaml
---
date: "YYYY-MM-DD"          # Actual date (today)
type: upper                  # Workout type
started: "HH:MM"
finished: "HH:MM"           # Set on completion
duration_minutes: 47         # Set on completion
location: gym-name           # From profile or ask
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

1. **Start**: Create the file with `status: in_progress`. Match to the weekly plan if one exists for today. If this was planned for a different day, add `planned_day` to frontmatter and amend `plan.md`. After creating the file, use `add_reminder` to schedule a workout check-in for 3 hours from now with the message: "Still working out? If you're done, let me know so I can close out the session." Set context to "workout-timeout-check" so you can identify it later.
2. **Log exercises** (MUST write to file every time):
   - Parse the user's input into structured exercise data
   - **Write it to the workout file** using Edit/Write — add under `## Exercises`. This is not optional.
   - Commit via Bash (`git add` + `git commit`) so the data is persisted
   - Confirm the parsed exercise back to the user in your text response
   - Mention what the plan suggests next (as a suggestion, not directive) — follow the user's flow
   - **Never just acknowledge an exercise in text without writing it to the file** — an exercise only in chat is lost data
3. **Complete** (CRITICAL — never skip this): When the user says they're done ("I'm done", "that's it", "finished", "/done", "wrapping up", etc.):
   - **First**: Update `status: completed` in frontmatter. This is the single most important step — a workout stuck as `in_progress` is invisible to retros and adherence tracking.
   - Then: Add `finished` time, `duration_minutes`, `energy_level` (ask if not mentioned), and a `## Summary` section.
   - Then: Check for PRs across all logged exercises, update `prs.yaml` if any.
   - Then: Use `get_reminders` to find and `delete_reminder` any reminder with context "workout-timeout-check" (the one scheduled at workout start).
   - Finally: Commit and push.

The plan is a suggestion. The user's actual exercises are the source of truth. If they deviate, log what they actually do.

## Plan Amendments

If a workout shifts days, gets added, or gets skipped, update `plan.md` with an `## Amendments` section at the bottom. Keep the original plan intact for reference.

```markdown
## Amendments

- **Friday Push → Saturday, Feb 15**: Shifted due to schedule change
- **Wednesday added**: Unplanned session — light pull work
```
