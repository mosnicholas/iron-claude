# Workout Management Logic

## Starting a Workout

When the user sends their first exercise of a session:

1. **Check for existing workout branch**
   - Look for `workout/*` branches with `in-progress.md`
   - If found and less than 4 hours old: offer to resume
   - If found and older: ask if they want to resume or start fresh

2. **Create new workout session**
   - Determine workout type from first exercise or ask
   - Create branch: `workout/YYYY-MM-DD-{type}`
   - Create `workouts/in-progress.md` with frontmatter:
   ```yaml
   ---
   date: "YYYY-MM-DD"
   type: {type}
   started: "HH:MM"
   location: {from profile or ask}
   status: in_progress
   plan_reference: "YYYY-WXX"
   branch: "workout/YYYY-MM-DD-{type}"
   ---
   ```

3. **Log the first exercise**
   - Parse the input
   - Add to the workout file
   - Commit: "Start workout: {exercise}"

## During a Workout

For each exercise logged:

1. **Parse the input** (see exercise-parsing.md)
2. **Update the workout file**
   - Add exercise under `## Exercises` section
   - Include planned vs actual if we have a plan
3. **Commit the change**
   - Message: "Add {exercise} set {n}" or "Add {exercise} {n} sets"
4. **Check for PRs**
   - Compare to `prs.yaml`
   - Alert immediately if PR detected: "🎉 New PR!"

## Handling Commentary

When user sends non-exercise text during a workout:

- **Effort indicators** ("felt heavy", "grinder", "easy")
  → Add as note to previous exercise

- **Questions** ("what's next?", "how many sets left?")
  → Check plan and respond

- **Skip requests** ("skip triceps today")
  → Note in workout, suggest alternative if appropriate

- **End signals** ("done", "that's it", "/done")
  → Trigger workout completion

## Completing a Workout (/done)

1. **Ask for energy level** (1-10) if not mentioned
2. **Calculate summary**:
   - Exercises completed vs planned
   - Skipped exercises
   - Added exercises
   - Total duration
3. **Detect PRs** across all logged exercises
4. **Update the workout file**:
   - Add `finished`, `duration_minutes`, `energy_level` to frontmatter
   - Add `prs_hit` array
   - Add `## Summary` section
   - Change `status: completed`
5. **Commit**: "Complete workout"
6. **Rename file**: `in-progress.md` → `YYYY-MM-DD.md`
7. **Commit**: "Finalize workout file"
8. **Update PRs** if any new records
   - Commit to main: "Update PRs: {achievement}"
9. **Merge branch to main**
10. **Delete branch**
11. **Send summary to user**

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
branch: "workout/2025-01-24-upper"
merged_at: "2025-01-24T07:35:00-05:00"
prs_hit:
  - exercise: Bench Press
    achievement: "175 x 6 (rep PR at this weight)"
---

# Workout — Friday, Jan 24

## Exercises

### Bench Press
*Planned: 3 x 3 @ 165 (speed work)*

| Set | Weight | Reps | Notes |
|-----|--------|------|-------|
| 1 | 165 | 3 | Fast, good bar speed |
| 2 | 165 | 3 | |
| 3 | 175 | 6 | Felt good, went heavier 🎉 **PR** |

### Pull-ups
*Planned: 3 x 8 @ BW*

| Set | Weight | Reps | Notes |
|-----|--------|------|-------|
| 1 | BW | 8 | |
| 2 | BW | 8 | |
| 3 | BW | 8 | |

---

## Summary

**Plan Adherence**
- Completed: Bench Press ✓, Pull-ups ✓
- Skipped: None
- Added: None
- Modified: Bench — went heavier than planned

**Observations**
- Bench felt strong, decided to push it
- Energy was high (8/10)
- Good session, finished under 50 min

---

## PRs

🎉 **Bench Press: 175 x 6** — New rep PR at this weight
```

## Handling Abandoned Workouts

If a workout branch exists but hasn't been touched in 4+ hours:

1. On next user message, ask:
   - "I see you started a workout earlier. Resume or start fresh?"
2. If resume: continue on existing branch
3. If start fresh:
   - Either merge as incomplete (for partial data)
   - Or delete branch (if minimal data logged)
   - Then start new session
