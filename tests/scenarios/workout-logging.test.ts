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
import { createCoachAgentV2 } from "../../src/coach-v2/index.js";
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

      const agent = createCoachAgentV2({
        model: "claude-haiku-4-5",

        repoPath: repo.repoPath,
      });

      const response = await agent.runCoach(
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

      const agent = createCoachAgentV2({
        model: "claude-haiku-4-5",

        repoPath: repo.repoPath,
      });

      const response = await agent.runCoach("OHP 105x5x3 RPE 7");

      // Workout file should now contain both exercises
      const content = readWorkoutFile(repo.repoPath, repo.currentWeek, repo.today);
      expect(content.toLowerCase()).toContain("bench");
      expect(content.toLowerCase()).toContain("105");

      expect(response.message.length).toBeGreaterThan(0);
    },
    180_000
  );
  it(
    "persists multiple exercises across separate messages to the file",
    async () => {
      // This catches the production bug where the agent acknowledged
      // exercises in text but never wrote them to the workout file.
      // Only the initial "Start workout" commit appeared in git.
      const existingWorkout = `---
date: "${new Date().toISOString().split("T")[0]}"
type: upper
status: in_progress
started: "10:00"
---
# Workout

## Exercises
`;

      repo = setupTestRepo({ existingWorkout });

      const agent = createCoachAgentV2({
        model: "claude-haiku-4-5",

        repoPath: repo.repoPath,
      });

      // Simulate two separate Telegram messages (separate runQuery calls)
      await agent.runCoach("bench 175x5x3 RPE 7");
      await agent.runCoach("OHP 105x5x3 RPE 7");

      // BOTH exercises must appear in the workout file, not just in chat
      const content = readWorkoutFile(repo.repoPath, repo.currentWeek, repo.today);
      const contentLower = content.toLowerCase();

      const hasBenchInFile = contentLower.includes("bench") && contentLower.includes("175");
      const hasOhpInFile =
        (contentLower.includes("ohp") || contentLower.includes("overhead")) &&
        contentLower.includes("105");

      expect({
        benchWrittenToFile: hasBenchInFile,
        ohpWrittenToFile: hasOhpInFile,
        note: "Both exercises must be in the workout FILE, not just acknowledged in chat",
        filePreview: content.slice(0, 500),
      }).toEqual(
        expect.objectContaining({
          benchWrittenToFile: true,
          ohpWrittenToFile: true,
        })
      );
    },
    240_000
  );
});

if (!hasApiKey) {
  it(SKIP_REASON, () => {
    console.log(SKIP_REASON);
  });
}
