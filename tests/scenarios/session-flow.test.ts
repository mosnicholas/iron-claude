/**
 * Scenario: Session Flow
 *
 * Tests the full workout session lifecycle:
 * - Starting a workout (file created with status: in_progress)
 * - Ending a workout (status → completed)
 * - General chat (no file mutations)
 */

import { createCoachAgentV2 } from "../../src/coach-v2/index.js";
import { setupTestRepo, type TestRepo } from "./setup.js";
import {
  expectWorkoutFileExists,
  expectNoWorkoutFile,
  readWorkoutFile,
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
    "completes a workout and sets status to completed",
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

      repo = setupTestRepo({ existingWorkout });

      const agent = createCoachAgentV2({
        model: "claude-haiku-4-5",

        repoPath: repo.repoPath,
      });

      const response = await agent.runCoach(
        "that's it for today, skipping accessories. Felt good overall!"
      );

      // Workout file should still exist
      expectWorkoutFileExists(repo.repoPath, repo.currentWeek, repo.today);

      // The agent MUST have updated the frontmatter status to "completed"
      // This is the bug we saw in production: workouts left as in_progress
      // after the user said they were done, making them invisible to retros
      const content = readWorkoutFile(repo.repoPath, repo.currentWeek, repo.today);
      const statusMatch = content.match(/status:\s*(\S+)/);
      expect({
        frontmatterStatus: statusMatch?.[1],
        note: "Workout must have status: completed in frontmatter after user says done",
      }).toEqual(
        expect.objectContaining({ frontmatterStatus: "completed" })
      );

      // Response should acknowledge the workout ending
      expect(response.message.length).toBeGreaterThan(0);
    },
    180_000
  );

  it(
    "general chat does not create workout files",
    async () => {
      repo = setupTestRepo();

      const agent = createCoachAgentV2({
        model: "claude-haiku-4-5",

        repoPath: repo.repoPath,
      });

      const response = await agent.runCoach(
        "How's my progress looking this week? Any suggestions?"
      );

      // Should NOT create a workout file
      expectNoWorkoutFile(repo.repoPath, repo.currentWeek, repo.today);

      // Response should be substantive
      expect(response.message.length).toBeGreaterThan(20);
    },
    180_000
  );
});
