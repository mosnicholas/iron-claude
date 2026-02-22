---
name: workout-complete
description: Complete and summarize a workout session
---

The user is finishing their workout. Generate a completion summary:

1. Read the current workout file and session state
2. List all exercises completed with sets/reps/weight
3. Note any PRs hit
4. Note any exercises skipped from the plan
5. Brief coaching note (what went well, what to watch)
6. Update the workout file status to "completed"
7. Use the `end_session` tool to clear session state
8. Save any relevant memories from the session
