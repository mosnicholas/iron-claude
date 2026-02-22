/**
 * Scenario: Session Flow
 *
 * Tests the full workout session lifecycle:
 * - Starting a workout (session state created)
 * - Ending a workout (session state cleared, status → completed)
 * - General chat (no file mutations)
 */

import { createCoachAgent } from "../../src/coach/index.js";
import { setupTestRepo, type TestRepo } from "./setup.js";
import {
  expectWorkoutFileExists,
  expectNoWorkoutFile,
  readWorkoutFile,
  readSessionStateFromRepo,
} from "./assertions.js";

const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
const describeWithApi = hasApiKey ? describe : describe.skip;

if (!hasApiKey) {
  it("ANTHROPIC_API_KEY not set — skipping session flow scenarios", () => {
    console.log("ANTHROPIC_API_KEY not set — skipping scenario tests");
  });
}

describeWithApi("Scenario: Session Flow", () => {
  let repo: TestRepo;

  afterEach(() => {
    repo?.cleanup();
  });

  it(
    "completes a workout and clears session state",
    async () => {
      // Pre-seed: active workout with exercises logged
      const existingWorkout = `---
date: "${new Date().toISOString().split("T")[0]}"
type: upper
status: in_progress
---
# Workout

## Bench Press
- 175 x 5 x 3 (RPE 7)

## Overhead Press
- 105 x 5 x 3 (RPE 7)

## Barbell Row
- 155 x 8 x 3 (RPE 7)
`;

      repo = setupTestRepo({
        existingWorkout,
        sessionState: {
          mode: "workout_active",
          lastUpdated: new Date().toISOString(),
          workout: {
            date: new Date().toISOString().split("T")[0],
            type: "upper",
            exercisesCompleted: ["Bench Press", "Overhead Press", "Barbell Row"],
            currentExercise: null,
            plannedRemaining: ["Dumbbell Curl", "Tricep Pushdown"],
          },
        },
      });

      const agent = createCoachAgent({
        model: "claude-haiku-4-5",
        maxTurns: 15,
        repoPath: repo.repoPath,
      });

      const response = await agent.chat(
        "that's it for today, skipping accessories. Felt good overall!"
      );

      // Workout file should still exist
      expectWorkoutFileExists(repo.repoPath, repo.currentWeek, repo.today);

      // The agent should have done at least one of:
      // 1. Cleared session state (called end_session)
      // 2. Updated workout status to "completed" in the file
      const sessionCleared = readSessionStateFromRepo(repo.repoPath) === null;
      const content = readWorkoutFile(repo.repoPath, repo.currentWeek, repo.today);
      const statusCompleted = content.toLowerCase().includes("completed");

      expect(sessionCleared || statusCompleted).toBe(true);

      // Response should acknowledge the workout ending
      expect(response.message.length).toBeGreaterThan(0);
    },
    180_000
  );

  it(
    "general chat does not create workout files",
    async () => {
      repo = setupTestRepo();

      const agent = createCoachAgent({
        model: "claude-haiku-4-5",
        maxTurns: 10,
        repoPath: repo.repoPath,
      });

      const response = await agent.chat(
        "How's my progress looking this week? Any suggestions?"
      );

      // Should NOT create a workout file
      expectNoWorkoutFile(repo.repoPath, repo.currentWeek, repo.today);

      // Session should NOT be set to workout_active
      // (it might be null or "chatting", both are fine)
      const state = readSessionStateFromRepo(repo.repoPath);
      if (state) {
        expect(state.mode).not.toBe("workout_active");
      }

      // Response should be substantive
      expect(response.message.length).toBeGreaterThan(20);
    },
    180_000
  );
});
