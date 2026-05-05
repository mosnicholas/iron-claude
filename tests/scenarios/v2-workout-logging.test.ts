/**
 * Scenario: Workout Logging (v2 harness)
 *
 * Mirrors tests/scenarios/workout-logging.test.ts but exercises the
 * coach-v2 harness directly via createCoachAgentV2's runCoach().
 *
 * Asserts on file side effects — same contract as v1 tests.
 *
 * Requires ANTHROPIC_API_KEY.
 */

import { existsSync } from "fs";
import { join } from "path";
import { createCoachAgentV2 } from "../../src/coach-v2/index.js";
import { setupTestRepo, type TestRepo } from "./setup.js";
import { expectWorkoutContains, readWorkoutFile } from "./assertions.js";

const SKIP_REASON = "ANTHROPIC_API_KEY not set — skipping v2 scenario tests";
const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
const describeWithApi = hasApiKey ? describe : describe.skip;

describeWithApi("Scenario v2: Workout Logging", () => {
  let repo: TestRepo;
  afterEach(() => repo?.cleanup());

  it(
    "creates a workout file when user sends first exercise",
    async () => {
      repo = setupTestRepo();
      const agent = createCoachAgentV2({
        repoPath: repo.repoPath,
        // Use Haiku for speed/cost in tests, same as v1 scenario tests.
        model: "claude-haiku-4-5",
      });

      const response = await agent.runCoach(
        "Just finished bench press: 175 x 5 x 3 sets. RPE 7, all sets felt good. Please log this workout."
      );

      const path = join(repo.repoPath, "weeks", repo.currentWeek, `${repo.today}.md`);
      expect({
        fileExists: existsSync(path),
        toolsUsed: response.toolsUsed,
        responsePreview: response.message.slice(0, 200),
      }).toEqual(expect.objectContaining({ fileExists: true }));

      expectWorkoutContains(repo.repoPath, repo.currentWeek, repo.today, "175");
      expectWorkoutContains(repo.repoPath, repo.currentWeek, repo.today, "ench");
      // The whole point of v2: log_exercise must have been called.
      expect(response.toolsUsed).toContain("log_exercise");
    },
    180_000
  );

  it(
    "persists multiple exercises across separate messages — the v1 regression case",
    async () => {
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
        repoPath: repo.repoPath,
        model: "claude-haiku-4-5",
      });

      await agent.runCoach("bench 175x5x3 RPE 7");
      await agent.runCoach("OHP 105x5x3 RPE 7");

      const content = readWorkoutFile(repo.repoPath, repo.currentWeek, repo.today);
      const lower = content.toLowerCase();
      expect({
        benchInFile: lower.includes("bench") && lower.includes("175"),
        ohpInFile: (lower.includes("ohp") || lower.includes("overhead")) && lower.includes("105"),
        filePreview: content.slice(0, 600),
      }).toEqual(expect.objectContaining({ benchInFile: true, ohpInFile: true }));
    },
    240_000
  );

  it(
    "marks workout completed when user says they're done",
    async () => {
      const existingWorkout = `---
date: "${new Date().toISOString().split("T")[0]}"
type: upper
status: in_progress
started: "10:00"
---
# Workout

## Exercises

### Bench Press
- 175 x 5
- 175 x 5
- 175 x 5
`;
      repo = setupTestRepo({ existingWorkout });
      const agent = createCoachAgentV2({
        repoPath: repo.repoPath,
        model: "claude-haiku-4-5",
      });

      const response = await agent.runCoach(
        "I'm done. That was a solid one. Energy was about 8/10."
      );

      const content = readWorkoutFile(repo.repoPath, repo.currentWeek, repo.today);
      expect(content).toContain("status: completed");
      expect(content).toContain("## Summary");
      expect(response.toolsUsed).toContain("complete_workout");
    },
    180_000
  );
});

if (!hasApiKey) {
  it(SKIP_REASON, () => {
    console.log(SKIP_REASON);
  });
}
