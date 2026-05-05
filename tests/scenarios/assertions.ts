/**
 * Scenario Test Assertions
 *
 * Helpers that inspect file side effects in the test repo.
 * Assert on deterministic outcomes (file exists, content matches)
 * rather than model text output.
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import type { CoachV2Response as CoachResponse } from "../../src/coach-v2/index.js";

// ============================================================================
// File Existence
// ============================================================================

/** Assert a workout file exists for the given date */
export function expectWorkoutFileExists(repoPath: string, week: string, date: string): void {
  const filePath = join(repoPath, "weeks", week, `${date}.md`);
  expect(existsSync(filePath)).toBe(true);
}

/** Assert a workout file does NOT exist for the given date */
export function expectNoWorkoutFile(repoPath: string, week: string, date: string): void {
  const filePath = join(repoPath, "weeks", week, `${date}.md`);
  expect(existsSync(filePath)).toBe(false);
}

// ============================================================================
// Workout File Content
// ============================================================================

/** Read a workout file and return its content */
export function readWorkoutFile(repoPath: string, week: string, date: string): string {
  const filePath = join(repoPath, "weeks", week, `${date}.md`);
  if (!existsSync(filePath)) {
    throw new Error(`Workout file not found: ${filePath}`);
  }
  return readFileSync(filePath, "utf-8");
}

/** Assert the workout file contains a substring (case-insensitive) */
export function expectWorkoutContains(
  repoPath: string,
  week: string,
  date: string,
  substring: string
): void {
  const content = readWorkoutFile(repoPath, week, date);
  expect(content.toLowerCase()).toContain(substring.toLowerCase());
}

/** Assert the workout frontmatter has a specific status */
export function expectWorkoutStatus(
  repoPath: string,
  week: string,
  date: string,
  status: string
): void {
  const content = readWorkoutFile(repoPath, week, date);
  // Match frontmatter status field
  const statusMatch = content.match(/status:\s*(\w+)/);
  expect(statusMatch).not.toBeNull();
  expect(statusMatch![1]).toBe(status);
}

// ============================================================================
// PRs
// ============================================================================

/** Read prs.yaml content from the test repo */
export function readPRsFile(repoPath: string): string {
  const filePath = join(repoPath, "prs.yaml");
  if (!existsSync(filePath)) return "";
  return readFileSync(filePath, "utf-8");
}

/** Assert prs.yaml contains a specific weight for an exercise */
export function expectPRWeight(repoPath: string, exercise: string, weight: number): void {
  const prs = readPRsFile(repoPath);
  // Simple check: the exercise section should contain the weight
  const exerciseSection = extractYamlSection(prs, exercise);
  expect(exerciseSection).toContain(`weight: ${weight}`);
}

// ============================================================================
// Learnings
// ============================================================================

/** Read learnings.md content from the test repo */
export function readLearningsFile(repoPath: string): string {
  const filePath = join(repoPath, "learnings.md");
  if (!existsSync(filePath)) return "";
  return readFileSync(filePath, "utf-8");
}

/** Assert learnings.md contains a substring */
export function expectLearningsContains(repoPath: string, substring: string): void {
  const content = readLearningsFile(repoPath);
  expect(content.toLowerCase()).toContain(substring.toLowerCase());
}

// ============================================================================
// Plan File
// ============================================================================

/** Read plan.md content from the test repo */
export function readPlanFile(repoPath: string, week: string): string {
  const filePath = join(repoPath, "weeks", week, "plan.md");
  if (!existsSync(filePath)) return "";
  return readFileSync(filePath, "utf-8");
}

// ============================================================================
// Response Assertions
// ============================================================================

/** Assert the response used a specific tool */
export function expectToolUsed(response: CoachResponse, toolName: string): void {
  expect(response.toolsUsed).toContain(toolName);
}

/** Assert the response text mentions something (case-insensitive) */
export function expectResponseMentions(response: CoachResponse, substring: string): void {
  expect(response.message.toLowerCase()).toContain(substring.toLowerCase());
}

// ============================================================================
// File Change Detection
// ============================================================================

/** List all files that changed since the initial commit */
export function getChangedFiles(repoPath: string): string[] {
  const { execSync } = require("child_process");
  const output = execSync("git diff --name-only HEAD", {
    cwd: repoPath,
    encoding: "utf-8",
  });
  // Also check untracked files
  const untracked = execSync("git ls-files --others --exclude-standard", {
    cwd: repoPath,
    encoding: "utf-8",
  });
  const all = [...output.trim().split("\n"), ...untracked.trim().split("\n")].filter(Boolean);
  return [...new Set(all)];
}

/** List all files in a directory */
export function listFiles(repoPath: string, subdir: string): string[] {
  const dir = join(repoPath, subdir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir);
}

// ============================================================================
// Helpers
// ============================================================================

/** Extract a YAML section by key (simple parser for prs.yaml format) */
function extractYamlSection(yaml: string, key: string): string {
  const lines = yaml.split("\n");
  let inSection = false;
  const sectionLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith(`${key}:`) || line.startsWith(`${key} :`)) {
      inSection = true;
      sectionLines.push(line);
      continue;
    }
    if (inSection) {
      if (line.match(/^\S/) && !line.startsWith(" ")) {
        // New top-level key, end of section
        break;
      }
      sectionLines.push(line);
    }
  }

  return sectionLines.join("\n");
}
