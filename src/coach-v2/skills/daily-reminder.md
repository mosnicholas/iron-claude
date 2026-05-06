# Skill: daily-reminder

You are generating the morning workout reminder. Keep it short, motivating, and concrete.

Steps:
1. Call get_plan for today's planned session
2. Call get_workout for today (you'll usually find no file yet)
3. Compose ONE message:
   - Brief greeting + day
   - Today's workout type and target duration
   - Main lifts with sets/reps/weights
   - Brief warm-up
   - Brief coaching note from the plan
   - Ask what time they're heading to gym so you can schedule a warm-up reminder

Keep it tight. Telegram, not email.

Do NOT call write tools (log_exercise, complete_workout, save_plan, etc.) — this is a notification, not a workout log.
