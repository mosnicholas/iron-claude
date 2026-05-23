/**
 * Scenario: Session Flow
 *
 * Pre-seed an active workout, ask the agent to wrap it up, verify the row's
 * status flips from in_progress → completed. Also: general chat shouldn't
 * spawn a workout row.
 */

import { createCoachAgentV2 } from "../../src/coach-v2/index.js";
import { setupTestEnv, type TestEnv } from "./setup.js";
import {
  expectNoWorkout,
  expectWorkoutExists,
  expectWorkoutStatus,
} from "./assertions.js";

const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
const describeWithApi = hasApiKey ? describe : describe.skip;

if (!hasApiKey) {
  it("ANTHROPIC_API_KEY not set — skipping session flow scenarios", () => {
    console.log("ANTHROPIC_API_KEY not set — skipping scenario tests");
  });
}

describeWithApi("Scenario: Session Flow", () => {
  let env: TestEnv;

  afterEach(() => {
    env?.cleanup();
  });

  it(
    "completes a workout and sets status to completed",
    async () => {
      env = await setupTestEnv({
        existingWorkout: {
          type: "upper",
          exercises: [
            { name: "Bench Press", sets: [{ reps: 5, weight: 175, rpe: 7 }] },
            { name: "Overhead Press", sets: [{ reps: 5, weight: 105, rpe: 7 }] },
            { name: "Barbell Row", sets: [{ reps: 8, weight: 155, rpe: 7 }] },
          ],
        },
      });

      const agent = createCoachAgentV2({
        userId: env.userId,
        timezone: "America/New_York",
        model: "claude-haiku-4-5",
        maxTurns: 15,
      });

      const response = await agent.runCoach(
        "that's it for today, skipping accessories. Felt good overall!"
      );

      await expectWorkoutExists(env);
      await expectWorkoutStatus(env, "completed");
      expect(response.message.length).toBeGreaterThan(0);
    },
    180_000
  );

  it(
    "general chat does not create a workout row",
    async () => {
      env = await setupTestEnv();

      const agent = createCoachAgentV2({
        userId: env.userId,
        timezone: "America/New_York",
        model: "claude-haiku-4-5",
        maxTurns: 15,
      });

      const response = await agent.runCoach(
        "How's my progress looking this week? Any suggestions?"
      );

      await expectNoWorkout(env);
      expect(response.message.length).toBeGreaterThan(20);
    },
    180_000
  );
});
