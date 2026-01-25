# Workout Coaching Onboarding

Welcome the user and explain that you'll ask a series of questions to set up their personalized workout coaching profile. Their answers will be saved to `CLAUDE.md`.

## Onboarding Flow

Ask questions in logical groups using `AskUserQuestion`. After each group, update `CLAUDE.md` with the answers before proceeding.

### Group 1: Profile Basics

1. **Name**: What should I call you?
2. **Location**: What city are you in? (for gym/class recommendations)
3. **Gym**: What gym do you go to? (e.g., Equinox, commercial gym, home gym)
   - If home gym: What equipment do you have?

### Group 2: Experience Level

4. **Lifting experience**: How long have you been strength training?
   - Beginner (< 1 year)
   - Intermediate (1-3 years)
   - Advanced (3+ years)

5. **Calisthenics experience**: What's your calisthenics level?
   - None / Beginner
   - Early intermediate (working on basics like pull-ups, dips)
   - Intermediate (L-sit, muscle-up attempts, handstand work)
   - Advanced (muscle-ups, handstand push-ups, levers)

6. **Current skills**: What calisthenics skills can you currently do? (pull-ups, dips, handstand holds, L-sit, muscle-ups, etc.)

### Group 3: Goals

7. **Primary goals**: What are your main training goals? (Select all that apply)
   - Build strength
   - Build muscle / hypertrophy
   - Lose fat / body recomposition
   - Calisthenics skills
   - Athletic performance
   - General fitness / health

8. **Specific targets**: What specific goals do you want to achieve? Ask for:
   - The goal (e.g., "freestanding handstand 30s", "OHP 135 lbs x 5")
   - Target date (optional but encouraged)

9. **Calisthenics skill goals**: Which skills are you working toward?
   - Handstand / handstand push-ups
   - Planche progressions
   - Front lever
   - Muscle-ups
   - Other (specify)

### Group 4: Current Stats & Baseline

10. **Bodyweight**: What's your current bodyweight? (for tracking and load calculations)

11. **Current lifts**: What are your current working weights for main lifts? (approximate is fine)
    - Overhead Press
    - Bench Press / Incline Press
    - Squat
    - Deadlift
    - Weighted Pull-up / Chin-up
    - Weighted Dips

### Group 5: Preferences & Constraints

12. **Session length**: How long do you want your workouts to be?
    - 30-45 min
    - 45-60 min
    - 60-75 min
    - 75+ min

13. **Training frequency**: How many days per week can you train?
    - 3 days
    - 4 days
    - 5 days
    - 6 days

14. **Exercise variety**: How often do you want to rotate exercises?
    - Keep exercises consistent (change rarely)
    - Rotate every 2-4 weeks (recommended)
    - High variety (change frequently)

15. **Skill priority**: When should calisthenics skills be programmed?
    - First, when fresh (recommended)
    - After main lifts
    - Separate skill sessions

### Group 6: Injuries & Limitations

16. **Current injuries**: Do you have any current injuries or pain?
    - If yes: What body part? How does it affect training?

17. **Past injuries**: Any past injuries I should know about that might flare up?

18. **Movement limitations**: Are there any exercises you can't do or need to avoid?

### Group 7: Schedule & Context

19. **Preferred training days**: Which days do you typically train?
    - Weekday preferences
    - Rest day preferences

20. **Schedule constraints**: Any schedule constraints I should know about? (travel, work hours, etc.)

21. **Class preferences**: If at a gym with classes (like Equinox), are you interested in:
    - Yoga / Pilates for recovery
    - Spin / cardio classes
    - HIIT classes
    - None / prefer solo training

### Group 8: Coaching Style

22. **Feedback preference**: How do you prefer feedback?
    - Direct and push me hard
    - Balanced encouragement and critique
    - Gentle and supportive

23. **Deload approach**: How do you feel about deload weeks?
    - Program them regularly (every 4-6 weeks)
    - Only when I feel I need it
    - I'll tell you when I need one

24. **Anything else**: Is there anything else I should know about you or your training?

## After Onboarding

Once all questions are answered:

1. Update `CLAUDE.md` with all collected information
2. Confirm the profile looks correct
3. Ask if they want to generate their first weekly plan
4. Explain the workflow:
   - Use `/plan-week` on Sundays to generate the weekly plan
   - Log workouts in `weeks/YYYY-WXX/day.md` using the simple format
   - Use `/analyze` for progress analysis
