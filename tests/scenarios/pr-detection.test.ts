/**
 * Scenario: PR Detection
 *
 * Tests that the agent detects personal records when the user
 * logs a weight that exceeds their existing PR.
 *
 * Fixture setup: PR for bench is 170x5. Plan calls for 175x5.
 * If user sends "bench 175x5", that's a new PR.
 */

import { createCoachAgent } from "../../src/coach/index.js";
import { setupTestRepo, type TestRepo } from "./setup.js";
import { readPRsFile } from "./assertions.js";

const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
const describeWithApi = hasApiKey ? describe : describe.skip;

if (!hasApiKey) {
  it("ANTHROPIC_API_KEY not set — skipping PR detection scenarios", () => {
    console.log("ANTHROPIC_API_KEY not set — skipping scenario tests");
  });
}

describeWithApi("Scenario: PR Detection", () => {
  let repo: TestRepo;

  afterEach(() => {
    repo?.cleanup();
  });

  it(
    "detects and celebrates a new bench press PR",
    async () => {
      repo = setupTestRepo();

      const agent = createCoachAgent({
        model: "claude-haiku-4-5",
        maxTurns: 15,
        repoPath: repo.repoPath,
      });

      // Bench PR is 170x5. Sending 175x5 should trigger PR detection.
      const response = await agent.chat(
        "Just finished bench press: 175 x 5 x 3, all sets. Felt strong today! Please log this workout."
      );

      // Check if prs.yaml was updated with the new weight
      const prs = readPRsFile(repo.repoPath);
      // The agent should have updated bench_press to 175
      // (or at minimum, the response should mention the PR)
      const prUpdated = prs.includes("175");
      const responseMentionsPR =
        response.message.toLowerCase().includes("pr") ||
        response.message.toLowerCase().includes("personal record") ||
        response.message.toLowerCase().includes("record") ||
        response.message.toLowerCase().includes("new best");

      // At least one of these should be true
      expect(prUpdated || responseMentionsPR).toBe(true);
    },
    180_000
  );

  it(
    "does NOT flag a PR when weight is below existing record",
    async () => {
      repo = setupTestRepo();

      const agent = createCoachAgent({
        model: "claude-haiku-4-5",
        maxTurns: 10,
        repoPath: repo.repoPath,
      });

      // Bench PR is 170x5. Sending 155x8 is a volume day, not a PR.
      await agent.chat("bench 155x8x3 RPE 7, volume day");

      // prs.yaml should NOT have been modified
      const prs = readPRsFile(repo.repoPath);
      expect(prs).not.toContain("155");

      // The bench PR should still be 170
      expect(prs).toContain("170");
    },
    180_000
  );
});
