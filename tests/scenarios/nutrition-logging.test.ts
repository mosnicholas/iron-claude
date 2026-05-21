/**
 * Scenario: Nutrition Logging
 *
 * Tests that the agent correctly looks up food macros and persists meals
 * to the day's file under ## Nutrition with a frontmatter rollup.
 *
 * Requires ANTHROPIC_API_KEY. The USDA lookup uses DEMO_KEY by default —
 * if the rate-limit hits, the agent should fail closed rather than fabricate.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { createCoachAgentV2 } from "../../src/coach-v2/index.js";
import { setupTestRepo, type TestRepo } from "./setup.js";
import { parseFrontmatter } from "../../src/integrations/storage.js";

const SKIP_REASON = "ANTHROPIC_API_KEY not set — skipping scenario tests";
const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
const describeWithApi = hasApiKey ? describe : describe.skip;

function readDailyFile(repo: TestRepo): string {
  const p = join(repo.repoPath, "weeks", repo.currentWeek, `${repo.today}.md`);
  if (!existsSync(p)) throw new Error(`No daily file at ${p}`);
  return readFileSync(p, "utf-8");
}

describeWithApi("Scenario: Nutrition Logging", () => {
  let repo: TestRepo;

  afterEach(() => {
    repo?.cleanup();
  });

  it(
    "logs a breakfast meal with grounded macros and a daily rollup",
    async () => {
      repo = setupTestRepo();

      const agent = createCoachAgentV2({
        model: "claude-haiku-4-5",
        repoPath: repo.repoPath,
      });

      const response = await agent.runCoach(
        "Just had breakfast: 3 scrambled eggs, one slice of whole wheat toast, and 2 slices of deli ham. Please log it."
      );

      const filePath = join(repo.repoPath, "weeks", repo.currentWeek, `${repo.today}.md`);

      expect({
        fileExists: existsSync(filePath),
        toolsUsed: response.toolsUsed,
        responsePreview: response.message.slice(0, 200),
      }).toEqual(
        expect.objectContaining({ fileExists: true })
      );

      const content = readDailyFile(repo);
      const lower = content.toLowerCase();

      // Section + items present
      expect(lower).toContain("## nutrition");
      expect(lower).toContain("egg");
      expect(lower).toContain("toast");
      expect(lower).toContain("ham");

      // Frontmatter rollup is numeric and non-trivial.
      const { frontmatter } = parseFrontmatter(content);
      expect(typeof frontmatter.protein_g).toBe("number");
      expect(typeof frontmatter.kcal).toBe("number");
      expect(frontmatter.protein_g as number).toBeGreaterThan(0);
      expect(frontmatter.kcal as number).toBeGreaterThan(0);

      // The agent must have hit USDA before logging — otherwise the macros
      // are fabricated.
      expect(response.toolsUsed).toContain("lookup_food");
      expect(response.toolsUsed).toContain("log_meal");
    },
    180_000
  );

  it(
    "accumulates two meals into the same daily rollup",
    async () => {
      repo = setupTestRepo();

      const agent = createCoachAgentV2({
        model: "claude-haiku-4-5",
        repoPath: repo.repoPath,
      });

      await agent.runCoach("Breakfast: 2 scrambled eggs.");
      await agent.runCoach("Lunch: 6 oz grilled chicken breast.");

      const content = readDailyFile(repo);
      const { frontmatter } = parseFrontmatter(content);
      const proteinAfterTwo = frontmatter.protein_g as number;

      // Two meals → ~12g (eggs) + ~50g (chicken) ≈ 60g. Allow a wide band
      // since the model picks USDA matches and may round differently.
      expect(proteinAfterTwo).toBeGreaterThan(20);

      const nutritionSectionHits = (content.match(/^### /gm) || []).length;
      expect(nutritionSectionHits).toBeGreaterThanOrEqual(2);
    },
    240_000
  );
});

if (!hasApiKey) {
  it(SKIP_REASON, () => {
    console.log(SKIP_REASON);
  });
}
