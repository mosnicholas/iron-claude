# Workout Management Logic

## Starting a Workout

When the user sends their first exercise of a session:

1. **Check for existing in-progress workout**
   - Look for any workout file in `weeks/YYYY-WXX/` with `status: in_progress` in frontmatter
   - If found and less than 4 hours old: offer to resume
   - If found and older: ask if they want to resume or start fresh

2. **Create new workout session**
   - Determine workout type from first exercise or ask
   - Create `weeks/YYYY-WXX/YYYY-MM-DD.md` with frontmatter:
   ```yaml
   ---
   date: "YYYY-MM-DD"
   type: {type}
   started: "HH:MM"
   location: {from profile or ask}
   status: in_progress
   plan_reference: "YYYY-WXX"
   ---
   ```

3. **Log the first exercise**
   - Parse the input
   - Add to the workout file
   - Commit to main: "Start workout: {exercise}"

## During a Workout

For each exercise logged:

1. **Parse the input** (see exercise-parsing.md)
2. **Update the workout file**
   - Add exercise under `## Exercises` section
   - Include planned vs actual if we have a plan
3. **Commit the change to main**
   - Message: "Add {exercise}" or "Log {n} sets of {exercise}"
4. **Check for PRs**
   - Compare to `prs.yaml`
   - Alert immediately if PR detected: "🎉 New PR!"
5. **Guide to next exercise**
   - If a weekly plan exists, proactively tell them what's next: "Next up: {exercise from plan}"
   - Don't ask "What's next?" - inform them based on the plan
   - If they've completed all planned exercises, let them know: "That's everything on today's plan!"

## Handling Commentary

When user sends non-exercise text during a workout:

- **Effort indicators** ("felt heavy", "grinder", "easy")
  → Add as note to previous exercise

- **Questions** ("what's next?", "how many sets left?")
  → Check plan and respond

- **Skip requests** ("skip triceps today")
  → Note in workout, suggest alternative if appropriate

- **End signals** — Trigger workout completion (see below)
  Examples: "done", "I'm done", "that's it", "finished", "that's all",
  "workout complete", "wrapping up", "calling it a day", "/done"

## Completing a Workout

**IMPORTANT**: Workout completion can be triggered by `/done` command OR by natural language
indicating the workout is finished. Both should follow the same completion workflow.

When the user indicates they're done (via command or natural language):

1. **Ask for energy level** (1-10) if not mentioned during the session
2. **Calculate summary**:
   - Exercises completed vs planned
   - Skipped exercises
   - Added exercises
   - Total duration
3. **Detect PRs** across all logged exercises
4. **Update the workout file** with all completion data:
   - Add `finished`, `duration_minutes`, `energy_level` to frontmatter
   - Add `prs_hit` array if any PRs
   - Add `## Summary` section with observations
   - **CRITICAL**: Change `status: completed` in the frontmatter
5. **Commit to main**: "Complete workout"
6. **Update PRs** if any new records (update prs.yaml)
7. **Send summary to user**

## Workout File Structure

```markdown
---
date: "2025-01-24"
type: upper
started: "06:45"
finished: "07:32"
duration_minutes: 47
location: equinox-flatiron
energy_level: 8
status: completed
plan_reference: "2025-W04"
warmup_completed: true
cooldown_completed: true
prs_hit:
  - exercise: Bench Press
    achievement: "175 x 6 (rep PR at this weight)"
---

# Workout — Friday, Jan 24

## Warm-up
*Planned: 5 min cardio + band work*

- 5 min bike ✓
- Band pull-aparts: 2 × 15 ✓
- Light bench: 2 × 10 @ bar ✓

## Exercises

### Bench Press
*Planned: 3 x 3 @ 165 (speed work) — Rest: 3 min*

| Set | Weight | Reps | Rest | Notes |
|-----|--------|------|------|-------|
| 1 | 165 | 3 | 3 min | Fast, good bar speed |
| 2 | 165 | 3 | 3 min | |
| 3 | 175 | 6 | — | Felt good, went heavier 🎉 **PR** |

### Pull-ups
*Planned: 3 x 8 @ BW — Rest: 90 sec*

| Set | Weight | Reps | Rest | Notes |
|-----|--------|------|------|-------|
| 1 | BW | 8 | 90 sec | |
| 2 | BW | 8 | 90 sec | |
| 3 | BW | 8 | — | |

## Cool-down
*Planned: 5 min stretching*

- Chest doorway stretch ✓
- Shoulder stretches ✓
- Light walk ✓

---

## Summary

**Plan Adherence**
- Completed: Bench Press ✓, Pull-ups ✓
- Skipped: None
- Added: None
- Modified: Bench — went heavier than planned
- Warm-up: ✓ Completed
- Cool-down: ✓ Completed

**Observations**
- Bench felt strong, decided to push it
- Energy was high (8/10)
- Good session, finished under 50 min

---

## PRs

🎉 **Bench Press: 175 x 6** — New rep PR at this weight
```

## Handling Abandoned Workouts

If a workout file with `status: in_progress` exists but hasn't been touched in 4+ hours:

1. On next user message, ask:
   - "I see you started a workout earlier. Resume or start fresh?"
2. If resume: continue updating the existing file
3. If start fresh:
   - Mark the old workout as `status: abandoned` or delete if minimal data
   - Create a new workout file for today
