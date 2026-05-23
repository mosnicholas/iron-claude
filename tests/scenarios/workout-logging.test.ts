/**
 * Scenario: Workout Logging
 *
 * Verifies the agent persists exercise data through the real `log_exercise`
 * tool — not just acknowledging in chat. Storage is a real Postgres
 * (testcontainers, shared via jest globalSetup) so the test only depends on
 * `claude-haiku-4-5` for the LLM call.
 */

import { createCoachAgentV2 } from "../../src/coach-v2/index.js";
import { setupTestEnv, type TestEnv } from "./setup.js";
import {
  expectExerciseLogged,
  expectWorkoutExists,
  readWorkout,
} from "./assertions.js";

const SKIP_REASON = "ANTHROPIC_API_KEY not set — skipping scenario tests";
const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
const describeWithApi = hasApiKey ? describe : describe.skip;

describeWithApi("Scenario: Workout Logging", () => {
  let env: TestEnv;

  afterEach(() => {
    env?.cleanup();
  });

  it(
    "creates a workout row when user sends first exercise",
    async () => {
      env = await setupTestEnv();

      const agent = createCoachAgentV2({
        userId: env.userId,
        timezone: "America/New_York",
        model: "claude-haiku-4-5",
        maxTurns: 15,
      });

      await agent.runCoach(
        "Just finished bench press: 175 x 5 x 3 sets. RPE 7, all sets felt good. Please log this workout."
      );

      await expectWorkoutExists(env);
      await expectExerciseLogged(env, { exercise: "bench", weight: 175 });
    },
    180_000
  );

  it(
    "appends to existing workout when logging additional exercises",
    async () => {
      env = await setupTestEnv({
        existingWorkout: {
          type: "upper",
          exercises: [
            {
              name: "Bench Press",
              sets: [{ reps: 5, weight: 175, rpe: 7 }],
            },
          ],
        },
      });

      const agent = createCoachAgentV2({
        userId: env.userId,
        timezone: "America/New_York",
        model: "claude-haiku-4-5",
        maxTurns: 15,
      });

      await agent.runCoach("OHP 105x5x3 RPE 7");

      const w = await readWorkout(env);
      const names = w.exercises.map((e) => e.name.toLowerCase());
      // Both bench and OHP must be present.
      expect(names.some((n) => n.includes("bench"))).toBe(true);
      expect(names.some((n) => n.includes("ohp") || n.includes("overhead"))).toBe(
        true
      );
    },
    180_000
  );

  it(
    "persists multiple exercises across separate messages",
    async () => {
      env = await setupTestEnv({
        existingWorkout: { type: "upper" },
      });

      const agent = createCoachAgentV2({
        userId: env.userId,
        timezone: "America/New_York",
        model: "claude-haiku-4-5",
        maxTurns: 15,
      });

      await agent.runCoach("bench 175x5x3 RPE 7");
      await agent.runCoach("OHP 105x5x3 RPE 7");

      const w = await readWorkout(env);
      const names = w.exercises.map((e) => e.name.toLowerCase());
      expect(names.some((n) => n.includes("bench"))).toBe(true);
      expect(names.some((n) => n.includes("ohp") || n.includes("overhead"))).toBe(
        true
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
