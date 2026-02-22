/**
 * Scenario: Workout Logging
 *
 * Tests that the agent correctly creates and updates workout files
 * when the user sends exercise data.
 *
 * Requires ANTHROPIC_API_KEY to run (calls the real model).
 */

import { createCoachAgent } from "../../src/coach/index.js";
import { setupTestRepo, type TestRepo } from "./setup.js";
import {
  expectWorkoutFileExists,
  expectWorkoutContains,
  expectSessionMode,
  readWorkoutFile,
} from "./assertions.js";

const SKIP_REASON = "ANTHROPIC_API_KEY not set — skipping scenario tests";
const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

const describeWithApi = hasApiKey ? describe : describe.skip;

describeWithApi("Scenario: Workout Logging", () => {
  let repo: TestRepo;

  afterEach(() => {
    repo?.cleanup();
  });

  it(
    "creates a workout file when user sends first exercise",
    async () => {
      repo = setupTestRepo();

      const agent = createCoachAgent({
        model: "claude-haiku-4-5",
        maxTurns: 5,
        repoPath: repo.repoPath,
      });

      const response = await agent.chat("bench 175x5x3, all sets felt good, RPE 7");

      // Core assertion: a workout file should exist for today
      expectWorkoutFileExists(repo.repoPath, repo.currentWeek, repo.today);

      // The file should contain the exercise data
      expectWorkoutContains(repo.repoPath, repo.currentWeek, repo.today, "175");
      expectWorkoutContains(repo.repoPath, repo.currentWeek, repo.today, "bench");

      // Session should be active
      expectSessionMode(repo.repoPath, "workout_active");

      // Response should acknowledge the exercise
      expect(response.message.length).toBeGreaterThan(0);
      expect(response.turnsUsed).toBeGreaterThan(0);
    },
    120_000
  );

  it(
    "appends to existing workout when logging additional exercises",
    async () => {
      // Pre-seed a workout file with one exercise already logged
      const existingWorkout = `---
date: "${new Date().toISOString().split("T")[0]}"
type: upper
status: in_progress
---
# Workout

## Bench Press
- 175 x 5 x 3 (RPE 7)
`;

      repo = setupTestRepo({
        existingWorkout,
        sessionState: {
          mode: "workout_active",
          lastUpdated: new Date().toISOString(),
          workout: {
            date: new Date().toISOString().split("T")[0],
            type: "upper",
            exercisesCompleted: ["Bench Press"],
            currentExercise: null,
            plannedRemaining: ["Overhead Press", "Barbell Row", "Dumbbell Curl", "Tricep Pushdown"],
          },
        },
      });

      const agent = createCoachAgent({
        model: "claude-haiku-4-5",
        maxTurns: 5,
        repoPath: repo.repoPath,
      });

      const response = await agent.chat("OHP 105x5x3 RPE 7");

      // Workout file should now contain both exercises
      const content = readWorkoutFile(repo.repoPath, repo.currentWeek, repo.today);
      expect(content.toLowerCase()).toContain("bench");
      expect(content.toLowerCase()).toContain("105");

      // Session should still be active with updated state
      expectSessionMode(repo.repoPath, "workout_active");

      expect(response.message.length).toBeGreaterThan(0);
    },
    120_000
  );
});

if (!hasApiKey) {
  it(SKIP_REASON, () => {
    console.log(SKIP_REASON);
  });
}
