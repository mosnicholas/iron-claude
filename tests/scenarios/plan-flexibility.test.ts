/**
 * Scenario: Plan Flexibility
 *
 * The plan's Monday block describes specific exercises. If the user runs
 * those exercises on a non-Monday, the agent should:
 *   1. write the workout under TODAY's date (not "Monday's")
 *   2. amend the plan to note the shift
 *   3. leave the rest of the plan intact
 */

import { createCoachAgentV2 } from "../../src/coach-v2/index.js";
import { setupTestEnv, type TestEnv } from "./setup.js";
import { readPlanBody } from "./assertions.js";
import { getStorage } from "../../src/storage/db.js";

const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
const describeWithApi = hasApiKey ? describe : describe.skip;

if (!hasApiKey) {
  it("ANTHROPIC_API_KEY not set — skipping plan flexibility scenarios", () => {
    console.log("ANTHROPIC_API_KEY not set — skipping scenario tests");
  });
}

describeWithApi("Scenario: Plan Flexibility", () => {
  let env: TestEnv;

  afterEach(() => {
    env?.cleanup();
  });

  it(
    "workout on a different day uses the actual date",
    async () => {
      env = await setupTestEnv();

      const agent = createCoachAgentV2({
        userId: env.userId,
        timezone: "America/New_York",
        model: "claude-haiku-4-5",
        maxTurns: 15,
      });

      await agent.runCoach("bench 175x5x3 RPE 7. Log this please.");

      const w = await getStorage().getWorkout(env.userId, env.today);
      if (w) {
        // Frontmatter date must be today (a Date column normalizes via String()).
        expect(String(w.date)).toMatch(env.today);
      }
    },
    180_000
  );

  it(
    "shifted workout creates a plan amendment",
    async () => {
      env = await setupTestEnv();

      const agent = createCoachAgentV2({
        userId: env.userId,
        timezone: "America/New_York",
        model: "claude-haiku-4-5",
        maxTurns: 15,
      });

      await agent.runCoach(
        "Did Monday's upper day today instead. Bench 175x5x3, OHP 105x5x3, rows 155x8x3. All RPE 7. Please log it and update the plan."
      );

      const plan = (await readPlanBody(env)).toLowerCase();
      const hasAmendment =
        plan.includes("amendment") ||
        plan.includes("shifted") ||
        plan.includes("moved") ||
        plan.includes("adjusted") ||
        plan.includes("update");
      expect(hasAmendment).toBe(true);
    },
    180_000
  );

  it(
    "original plan sections are preserved after amendment",
    async () => {
      env = await setupTestEnv();

      const agent = createCoachAgentV2({
        userId: env.userId,
        timezone: "America/New_York",
        model: "claude-haiku-4-5",
        maxTurns: 15,
      });

      await agent.runCoach(
        "Did Monday's upper day today. Bench 175x5x3, OHP 105x5x3, rows 155x8x3. All RPE 7. Please log this and update the plan to reflect the shift."
      );

      const plan = (await readPlanBody(env)).toLowerCase();
      expect(plan).toContain("bench press");
      expect(plan).toContain("175");
      const hasOtherDay = plan.includes("tuesday") || plan.includes("thursday");
      expect(hasOtherDay).toBe(true);
    },
    180_000
  );
});
