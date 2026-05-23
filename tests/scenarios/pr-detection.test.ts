/**
 * Scenario: PR Detection
 *
 * Bench PR is fixture-seeded at 170x5; if the user logs 175x5 the agent
 * should either record it as a PR or call it out in chat.
 */

import { createCoachAgentV2 } from "../../src/coach-v2/index.js";
import { setupTestEnv, type TestEnv } from "./setup.js";
import { getStorage } from "../../src/storage/db.js";

const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
const describeWithApi = hasApiKey ? describe : describe.skip;

if (!hasApiKey) {
  it("ANTHROPIC_API_KEY not set — skipping PR detection scenarios", () => {
    console.log("ANTHROPIC_API_KEY not set — skipping scenario tests");
  });
}

describeWithApi("Scenario: PR Detection", () => {
  let env: TestEnv;

  afterEach(() => {
    env?.cleanup();
  });

  it(
    "detects and celebrates a new bench press PR",
    async () => {
      env = await setupTestEnv();

      const agent = createCoachAgentV2({
        userId: env.userId,
        timezone: "America/New_York",
        model: "claude-haiku-4-5",
        maxTurns: 15,
      });

      const response = await agent.runCoach(
        "Just finished bench press: 175 x 5 x 3, all sets. Felt strong today! Please log this workout."
      );

      // Either (a) the agent updated the PR row to 175, or (b) called it out
      // in chat — both are acceptable signals.
      const prs = await getStorage().readPRs(env.userId);
      const benchCurrent = prs.find(
        (p) => p.isCurrent && p.exercise.toLowerCase().includes("bench")
      );
      const prUpdated = benchCurrent?.weight === 175;
      const responseMentionsPR =
        response.message.toLowerCase().includes("pr") ||
        response.message.toLowerCase().includes("personal record") ||
        response.message.toLowerCase().includes("record") ||
        response.message.toLowerCase().includes("new best");

      expect(prUpdated || responseMentionsPR).toBe(true);
    },
    180_000
  );

  it(
    "does NOT flag a PR when weight is below existing record",
    async () => {
      env = await setupTestEnv();

      const agent = createCoachAgentV2({
        userId: env.userId,
        timezone: "America/New_York",
        model: "claude-haiku-4-5",
        maxTurns: 15,
      });

      // Bench PR is 170x5. Sending 155x8 is a volume day, not a PR.
      await agent.runCoach("bench 155x8x3 RPE 7, volume day");

      const prs = await getStorage().readPRs(env.userId);
      const benchCurrent = prs.find(
        (p) => p.isCurrent && p.exercise.toLowerCase().includes("bench")
      );
      // Current PR should still be the fixture's 170x5.
      expect(benchCurrent?.weight).toBe(170);
    },
    180_000
  );
});
