/**
 * Scenario: Plan Flexibility
 *
 * Tests that the agent handles workouts on different days correctly:
 * - Workout file uses the actual date, not the plan's day name
 * - Shifted workouts create a plan amendment
 * - Original plan sections are preserved after amendment
 *
 * These rules were in prompts/partials/plan-flexibility.md and need
 * test coverage to ensure the agent still handles them correctly.
 */

import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { createCoachAgentV2 } from "../../src/coach-v2/index.js";
import { setupTestRepo, type TestRepo } from "./setup.js";
import { readWorkoutFile, readPlanFile } from "./assertions.js";

const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
const describeWithApi = hasApiKey ? describe : describe.skip;

if (!hasApiKey) {
  it("ANTHROPIC_API_KEY not set — skipping plan flexibility scenarios", () => {
    console.log("ANTHROPIC_API_KEY not set — skipping scenario tests");
  });
}

describeWithApi("Scenario: Plan Flexibility", () => {
  let repo: TestRepo;

  afterEach(() => {
    repo?.cleanup();
  });

  it(
    "workout on a different day uses the actual date",
    async () => {
      // Setup: Plan has Monday exercises (bench, OHP, rows)
      // but "today" is whatever date the test runs on.
      // The user sends a Monday exercise — the file should be created
      // with today's actual date, not Monday's date.
      repo = setupTestRepo();

      const agent = createCoachAgentV2({
        model: "claude-haiku-4-5",

        repoPath: repo.repoPath,
      });

      // Send a Monday Upper A exercise (bench 175x5 is from Monday's plan)
      await agent.runCoach(
        "bench 175x5x3 RPE 7. Log this please."
      );

      const weekDir = join(repo.repoPath, "weeks", repo.currentWeek);
      const files = existsSync(weekDir) ? readdirSync(weekDir) : [];
      const workoutFiles = files.filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));

      // The workout file must be named with today's date
      if (workoutFiles.length > 0) {
        const todayFile = `${repo.today}.md`;
        expect(workoutFiles).toContain(todayFile);
      }

      // The file content should reference the actual date, not "Monday"
      const todayPath = join(weekDir, `${repo.today}.md`);
      if (existsSync(todayPath)) {
        const content = readWorkoutFile(repo.repoPath, repo.currentWeek, repo.today);
        // Frontmatter date must be today
        expect(content).toContain(repo.today);
      }
    },
    180_000
  );

  it(
    "shifted workout creates a plan amendment",
    async () => {
      // The plan says bench is on Monday. If we log bench on a different day,
      // the agent should amend plan.md with an Amendments section.
      repo = setupTestRepo();

      const agent = createCoachAgentV2({
        model: "claude-haiku-4-5",

        repoPath: repo.repoPath,
      });

      // Log Monday's exercise
      await agent.runCoach(
        "Did Monday's upper day today instead. Bench 175x5x3, OHP 105x5x3, rows 155x8x3. All RPE 7. Please log it and update the plan."
      );

      // Read plan.md — should have an amendments section
      const plan = readPlanFile(repo.repoPath, repo.currentWeek);

      // The plan should contain some form of amendment note
      const hasAmendment =
        plan.toLowerCase().includes("amendment") ||
        plan.toLowerCase().includes("shifted") ||
        plan.toLowerCase().includes("moved") ||
        plan.toLowerCase().includes("adjusted") ||
        plan.toLowerCase().includes("update");

      expect({
        planHasAmendment: hasAmendment,
        planPreview: plan.slice(-500),
      }).toEqual(expect.objectContaining({ planHasAmendment: true }));
    },
    180_000
  );

  it(
    "original plan sections are preserved after amendment",
    async () => {
      repo = setupTestRepo();

      const agent = createCoachAgentV2({
        model: "claude-haiku-4-5",

        repoPath: repo.repoPath,
      });

      // Log Monday's exercises on a different day and ask for plan update
      await agent.runCoach(
        "Did Monday's upper day today. Bench 175x5x3, OHP 105x5x3, rows 155x8x3. All RPE 7. Please log this and update the plan to reflect the shift."
      );

      // Read the plan
      const plan = readPlanFile(repo.repoPath, repo.currentWeek);

      // Original Monday section content should still be present (not deleted)
      expect(plan.toLowerCase()).toContain("bench press");
      expect(plan.toLowerCase()).toContain("175");

      // Other days should still be in the plan (not overwritten)
      const hasTuesday = plan.toLowerCase().includes("tuesday") || plan.toLowerCase().includes("lower");
      const hasThursday = plan.toLowerCase().includes("thursday") || plan.toLowerCase().includes("upper b");
      expect(hasTuesday || hasThursday).toBe(true);
    },
    180_000
  );
});
