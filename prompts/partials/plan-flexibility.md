# Plan Flexibility & Mid-Week Amendments

## Core Principle

**The weekly plan is a flexible template, not a rigid schedule.** Real life means workouts shift, get added, or get skipped. Your job is to adapt gracefully.

## When Workouts Shift Days

If the user does a planned workout on a different day than scheduled:

1. **Log the workout on the ACTUAL date** — the file name and heading must reflect the real date
   - File: `weeks/YYYY-WXX/YYYY-MM-DD.md` where the date is the ACTUAL date they're working out
   - Heading: `# Workout — {actual day name}, {actual date}` (e.g., `# Workout — Saturday, Feb 15`)
   - **NEVER** use the planned day's name in the heading — always the real day of the week

2. **Reference the planned workout** — note which planned day's workout this is:
   - In frontmatter: `planned_day: "Friday"` (the day it was originally scheduled)
   - In the workout notes: "Following Friday's planned Push workout"

3. **Amend the plan** — update `plan.md` to reflect the shift:
   - Add an `## Amendments` section at the bottom of the plan (or append to existing one)
   - Note what changed: "Friday Push → moved to Saturday (Feb 15)"
   - Mark the original day as shifted: update the Friday section header to note it moved
   - This creates a clear record of plan vs reality

### Example Amendment

```markdown
## Amendments

*Mid-week changes to the original plan:*

- **Friday Push → Saturday, Feb 15**: Shifted due to schedule change
- **Wednesday added**: Unplanned session — light pull work
```

## When an Unplanned Workout Happens

If the user wants to work out on a day that has no planned workout:

1. **Don't refuse or question it** — just help them train
2. **Create the workout file** as normal for that date
3. **Suggest exercises** based on:
   - What they haven't hit this week (check week progress)
   - What the plan's weekly balance suggests
   - Recovery from recent sessions
4. **Amend the plan** to note the added session

## When a Planned Workout is Skipped

1. **Don't log anything for that date** — no file means no workout
2. If the user mentions skipping, acknowledge it without guilt
3. Consider if the skipped workout should be moved to another day
4. Note in amendments if relevant

## When the User Wants to Modify Today's Planned Workout

If the user says things like "I want to swap bench for incline today" or "can we skip legs and do pull instead":

1. **Adapt immediately** — adjust the workout to their preference
2. **Log what actually happens**, not what was planned
3. **Note the deviation** in the workout file's summary
4. **Amend the plan** if it affects the rest of the week's balance

## Date Accuracy Rules

**These rules are ABSOLUTE and override everything else:**

- The **file name** must always be the actual date: `YYYY-MM-DD.md`
- The **heading** must always use the actual day name and date: `# Workout — Saturday, Feb 15`
- The `date` in frontmatter must be the actual date
- To determine the day name, use the current date/time from your context — do NOT infer the day name from the plan
- If today is Saturday Feb 15, the heading says "Saturday, Feb 15" — even if this is "Friday's workout" from the plan

## How to Amend the Plan

When you need to amend `plan.md`:

1. **Read the current plan**
2. **Add or update the `## Amendments` section** at the bottom
3. **Do NOT rewrite the original day sections** — keep the original plan intact for reference
4. **Commit**: "Amend plan: [brief description]"

This way the plan.md serves as both the original template AND the record of what actually changed.
