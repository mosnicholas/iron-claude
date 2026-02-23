/**
 * Scenario: Workout Logging
 *
 * Tests that the agent correctly creates and updates workout files
 * when the user sends exercise data.
 *
 * Requires ANTHROPIC_API_KEY to run (calls the real model).
 */

import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { createCoachAgent } from "../../src/coach/index.js";
import { setupTestRepo, type TestRepo } from "./setup.js";
import {
  expectWorkoutContains,
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
        maxTurns: 15,
        repoPath: repo.repoPath,
      });

      const response = await agent.chat(
        "Just finished bench press: 175 x 5 x 3 sets. RPE 7, all sets felt good. Please log this workout."
      );

      // Diagnostic: if the file wasn't created, log what the agent actually did
      const weekDir = join(repo.repoPath, "weeks", repo.currentWeek);
      const filesInWeek = existsSync(weekDir)
        ? readdirSync(weekDir)
        : [];

      // Core assertion: a workout file should exist for today
      expect({
        fileExists: existsSync(join(weekDir, `${repo.today}.md`)),
        filesInWeekDir: filesInWeek,
        turnsUsed: response.turnsUsed,
        toolsUsed: response.toolsUsed,
        responsePreview: response.message.slice(0, 200),
      }).toEqual(
        expect.objectContaining({ fileExists: true })
      );

      // The file should contain the exercise data
      expectWorkoutContains(repo.repoPath, repo.currentWeek, repo.today, "175");
      expectWorkoutContains(repo.repoPath, repo.currentWeek, repo.today, "bench");
    },
    180_000
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

      repo = setupTestRepo({ existingWorkout });

      const agent = createCoachAgent({
        model: "claude-haiku-4-5",
        maxTurns: 15,
        repoPath: repo.repoPath,
      });

      const response = await agent.chat("OHP 105x5x3 RPE 7");

      // Workout file should now contain both exercises
      const content = readWorkoutFile(repo.repoPath, repo.currentWeek, repo.today);
      expect(content.toLowerCase()).toContain("bench");
      expect(content.toLowerCase()).toContain("105");

      expect(response.message.length).toBeGreaterThan(0);
    },
    180_000
  );
});

if (!hasApiKey) {
  it(SKIP_REASON, () => {
    console.log(SKIP_REASON);
  });
}
