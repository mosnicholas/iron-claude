/**
 * Test Repo Setup
 *
 * Creates an isolated temp directory with fixture data and git init.
 * The CoachAgent sees a real git repo with realistic data — it just
 * didn't come from GitHub.
 */

import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { getCurrentWeek, getToday } from "../../src/utils/date.js";
import { PROFILE, PRS_YAML, LEARNINGS, buildWeeklyPlan } from "./fixtures.js";

export interface TestRepoOptions {
  /** Override profile.md content */
  profile?: string;
  /** Override prs.yaml content */
  prs?: string;
  /** Override learnings.md content */
  learnings?: string;
  /** Override weekly plan content */
  plan?: string;
  /** Pre-seed an existing workout file for today */
  existingWorkout?: string;
  /** Pre-seed session state */
  sessionState?: Record<string, unknown>;
  /** Skip creating a weekly plan */
  noPlan?: boolean;
}

export interface TestRepo {
  /** Absolute path to the test repo */
  repoPath: string;
  /** Current ISO week string (e.g., "2026-W08") */
  currentWeek: string;
  /** Today's date string (e.g., "2026-02-22") */
  today: string;
  /** Clean up the temp directory */
  cleanup: () => void;
}

/**
 * Create an isolated test repo with fixture data.
 *
 * Sets up:
 * - git init with a valid initial commit
 * - profile.md, prs.yaml, learnings.md
 * - weeks/{currentWeek}/plan.md
 * - Optionally: today's workout file, session state
 */
export function setupTestRepo(options: TestRepoOptions = {}): TestRepo {
  const repoPath = mkdtempSync(join(tmpdir(), "iron-claude-test-"));
  const currentWeek = getCurrentWeek();
  const today = getToday();

  // Initialize git
  execSync("git init", { cwd: repoPath, stdio: "pipe" });
  execSync('git config user.email "test@iron-claude.dev"', { cwd: repoPath, stdio: "pipe" });
  execSync('git config user.name "IronClaude Test"', { cwd: repoPath, stdio: "pipe" });

  // Write base fixture files
  writeFileSync(join(repoPath, "profile.md"), options.profile || PROFILE);
  writeFileSync(join(repoPath, "prs.yaml"), options.prs || PRS_YAML);
  writeFileSync(join(repoPath, "learnings.md"), options.learnings || LEARNINGS);

  // Create week directory and plan
  const weekDir = join(repoPath, "weeks", currentWeek);
  mkdirSync(weekDir, { recursive: true });

  if (!options.noPlan) {
    const planContent = options.plan || buildWeeklyPlan(currentWeek);
    writeFileSync(join(weekDir, "plan.md"), planContent);
  }

  // Optional: pre-seed today's workout
  if (options.existingWorkout) {
    writeFileSync(join(weekDir, `${today}.md`), options.existingWorkout);
  }

  // Optional: pre-seed session state
  if (options.sessionState) {
    const stateDir = join(repoPath, "state");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "session.json"), JSON.stringify(options.sessionState, null, 2));
  }

  // Create initial commit so git is in a valid state
  execSync("git add -A", { cwd: repoPath, stdio: "pipe" });
  execSync('git commit -m "Initial test fixtures"', { cwd: repoPath, stdio: "pipe" });

  return {
    repoPath,
    currentWeek,
    today,
    cleanup: () => {
      try {
        rmSync(repoPath, { recursive: true, force: true });
      } catch {
        // Best effort cleanup
      }
    },
  };
}
