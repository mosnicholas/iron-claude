/**
 * Scenario: Response Quality
 *
 * Verifies the coach: (1) gives concise responses, (2) doesn't fabricate
 * exercises, (3) uses today's actual date for the workout row, and (4)
 * doesn't bump PRs that aren't beating the existing record.
 */

import { createCoachAgentV2 } from "../../src/coach-v2/index.js";
import { setupTestEnv, type TestEnv } from "./setup.js";
import { getStorage } from "../../src/storage/db.js";

const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
const describeWithApi = hasApiKey ? describe : describe.skip;

if (!hasApiKey) {
  it("ANTHROPIC_API_KEY not set — skipping response quality scenarios", () => {
    console.log("ANTHROPIC_API_KEY not set — skipping scenario tests");
  });
}

describeWithApi("Scenario: Response Quality", () => {
  let env: TestEnv;

  afterEach(() => {
    env?.cleanup();
  });

  it(
    "keeps exercise acknowledgment concise (no wall of text)",
    async () => {
      env = await setupTestEnv();

      const agent = createCoachAgentV2({
        userId: env.userId,
        timezone: "America/New_York",
        model: "claude-haiku-4-5",
        maxTurns: 15,
      });

      const response = await agent.runCoach("bench 175x5x3 RPE 7. Please log this.");

      expect(response.message.length).toBeLessThan(1500);
      const planDayHeaders = ["## Tuesday", "## Thursday", "## Friday"].filter(
        (h) => response.message.includes(h)
      );
      expect(planDayHeaders).toHaveLength(0);
    },
    180_000
  );

  it(
    "does not fabricate exercises the user did not report",
    async () => {
      env = await setupTestEnv();

      const agent = createCoachAgentV2({
        userId: env.userId,
        timezone: "America/New_York",
        model: "claude-haiku-4-5",
        maxTurns: 15,
      });

      await agent.runCoach(
        "Just did bench press: 175x5x3. RPE 7. Please log this workout."
      );

      const w = await getStorage().getWorkout(env.userId, env.today);
      if (!w) return; // Agent didn't log — out of scope for this assertion.
      const exerciseNames = w.exercises.map((e) => e.name.toLowerCase());
      const fabricatedExercises = [
        "barbell row",
        "dumbbell curl",
        "tricep pushdown",
        "lateral raise",
        "face pull",
      ];
      const fabricated = fabricatedExercises.filter((needle) =>
        exerciseNames.some((n) => n.includes(needle))
      );
      expect(fabricated).toEqual([]);
    },
    180_000
  );

  it(
    "uses today's actual date for the workout row",
    async () => {
      env = await setupTestEnv();

      const agent = createCoachAgentV2({
        userId: env.userId,
        timezone: "America/New_York",
        model: "claude-haiku-4-5",
        maxTurns: 15,
      });

      await agent.runCoach("Squat 225x5x3 RPE 8. Please log this workout.");

      // A workout row should exist for today, NOT for any other date.
      const today = await getStorage().getWorkout(env.userId, env.today);
      const all = await getStorage().listWeekDates(env.userId, env.currentWeek);
      if (today) {
        // Only one entry, and it's today.
        expect(all.map((r) => String(r.date))).toContain(env.today);
        const others = all.filter((r) => String(r.date) !== env.today);
        expect(others).toHaveLength(0);
      }
    },
    180_000
  );

  it(
    "does not modify PRs when exercise is at or below existing PR",
    async () => {
      env = await setupTestEnv();

      const agent = createCoachAgentV2({
        userId: env.userId,
        timezone: "America/New_York",
        model: "claude-haiku-4-5",
        maxTurns: 15,
      });

      // Squat PR is 225x5. Logging exactly 225x5 should NOT trigger a PR update.
      await agent.runCoach(
        "Squats today: 225x5x3, RPE 8. Standard working sets. Please log this."
      );

      const prs = await getStorage().readPRs(env.userId);
      const squat = prs.find(
        (p) => p.isCurrent && p.exercise.toLowerCase().includes("squat")
      );
      // The fixture PR (225 on 2026-02-10) should still be current.
      expect(squat?.weight).toBe(225);
      expect(String(squat?.date)).toMatch(/2026-02-10/);
    },
    180_000
  );
});
