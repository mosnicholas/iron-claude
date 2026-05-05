/**
 * Scenario: Response Quality
 *
 * Tests for bugs seen in production screenshots:
 *
 * 1. VERBOSITY — Coach sends walls of text instead of concise Telegram-style
 *    messages. Exercise acknowledgments should be short, not multi-paragraph.
 *
 * 2. NO FABRICATION — Coach must not invent exercises the user didn't report.
 *    If the user says "bench 175x5", the response and log should only contain
 *    bench press, not the entire plan's worth of exercises.
 *
 * 3. CORRECT DATE — The workout file must be named after today's actual date,
 *    not inferred from the plan's day labels (e.g., "Monday — Upper A").
 *
 * 4. PLAN REGURGITATION — When acknowledging a single exercise, the coach
 *    should not dump the entire weekly plan back at the user.
 */

import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { createCoachAgentV2 } from "../../src/coach-v2/index.js";
import { setupTestRepo, type TestRepo } from "./setup.js";
import { readWorkoutFile, readPRsFile } from "./assertions.js";

const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
const describeWithApi = hasApiKey ? describe : describe.skip;

if (!hasApiKey) {
  it("ANTHROPIC_API_KEY not set — skipping response quality scenarios", () => {
    console.log("ANTHROPIC_API_KEY not set — skipping scenario tests");
  });
}

describeWithApi("Scenario: Response Quality", () => {
  let repo: TestRepo;

  afterEach(() => {
    repo?.cleanup();
  });

  it(
    "keeps exercise acknowledgment concise (no wall of text)",
    async () => {
      repo = setupTestRepo();

      const agent = createCoachAgentV2({
        model: "claude-haiku-4-5",

        repoPath: repo.repoPath,
      });

      const response = await agent.runCoach(
        "bench 175x5x3 RPE 7. Please log this."
      );

      // The response should be concise — this is Telegram, not email.
      // A good acknowledgment is ~50-300 chars. Anything over 1500 is a wall of text.
      // (Production bug: coach was sending 2000+ char responses for a single exercise)
      expect(response.message.length).toBeLessThan(1500);

      // Should NOT contain the full weekly plan content
      // (Production bug: coach would dump "## Monday — Upper A\n## Tuesday — Lower A..." etc)
      const planDayHeaders = ["## Tuesday", "## Thursday", "## Friday"].filter((h) =>
        response.message.includes(h)
      );
      expect(planDayHeaders).toHaveLength(0);
    },
    180_000
  );

  it(
    "does not fabricate exercises the user did not report",
    async () => {
      repo = setupTestRepo();

      const agent = createCoachAgentV2({
        model: "claude-haiku-4-5",

        repoPath: repo.repoPath,
      });

      // User only reports ONE exercise
      await agent.runCoach(
        "Just did bench press: 175x5x3. RPE 7. Please log this workout."
      );

      // Check the workout file — it should ONLY contain bench press,
      // not exercises the user didn't do (OHP, rows, curls, etc.)
      const weekDir = join(repo.repoPath, "weeks", repo.currentWeek);
      const todayFile = join(weekDir, `${repo.today}.md`);

      if (existsSync(todayFile)) {
        const content = readWorkoutFile(repo.repoPath, repo.currentWeek, repo.today);
        const contentLower = content.toLowerCase();

        // The file should contain bench
        expect(contentLower).toContain("bench");

        // The file should NOT log exercises the user didn't report as completed
        // (These are in the plan but the user only said "bench")
        const fabricatedExercises = [
          "barbell row",
          "dumbbell curl",
          "tricep pushdown",
          "lateral raise",
          "face pull",
        ];

        const fabricated = fabricatedExercises.filter((ex) => {
          // Check if the exercise appears with set/rep data (not just mentioned in notes)
          const exPattern = new RegExp(`${ex}[\\s\\S]{0,50}\\d+\\s*x\\s*\\d+`, "i");
          return exPattern.test(content);
        });

        expect({
          fabricatedExercisesFound: fabricated,
          note: "These exercises were NOT reported by the user but appear in the log with set/rep data",
        }).toEqual(
          expect.objectContaining({ fabricatedExercisesFound: [] })
        );
      }
    },
    180_000
  );

  it(
    "uses today's actual date for the workout file, not the plan day name",
    async () => {
      repo = setupTestRepo();

      const agent = createCoachAgentV2({
        model: "claude-haiku-4-5",

        repoPath: repo.repoPath,
      });

      await agent.runCoach(
        "Squat 225x5x3 RPE 8. Please log this workout."
      );

      const weekDir = join(repo.repoPath, "weeks", repo.currentWeek);
      const files = existsSync(weekDir) ? readdirSync(weekDir) : [];
      const workoutFiles = files.filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));

      // If a workout file was created, it must be named with today's date
      if (workoutFiles.length > 0) {
        const todayFile = `${repo.today}.md`;
        expect(workoutFiles).toContain(todayFile);

        // There should be exactly one workout file (for today), not files for other days
        const nonTodayFiles = workoutFiles.filter((f) => f !== todayFile);
        expect(nonTodayFiles).toHaveLength(0);
      }

      // The date in frontmatter should match today
      const todayPath = join(weekDir, `${repo.today}.md`);
      if (existsSync(todayPath)) {
        const content = readWorkoutFile(repo.repoPath, repo.currentWeek, repo.today);
        // Frontmatter date should be today
        expect(content).toContain(repo.today);
      }
    },
    180_000
  );

  it(
    "does not modify prs.yaml when exercise is at or below existing PR",
    async () => {
      repo = setupTestRepo();

      const agent = createCoachAgentV2({
        model: "claude-haiku-4-5",

        repoPath: repo.repoPath,
      });

      // Squat PR is 225x5. Logging exactly 225x5 (matching, not exceeding)
      // should NOT trigger a PR update
      await agent.runCoach(
        "Squats today: 225x5x3, RPE 8. Standard working sets. Please log this."
      );

      const prs = readPRsFile(repo.repoPath);

      // The existing squat PR should be unchanged
      expect(prs).toContain("225");
      // The date should still be the original fixture date, not today
      expect(prs).toContain("2026-02-10");
    },
    180_000
  );
});
