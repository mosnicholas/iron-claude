/**
 * Repository Sync
 *
 * Manages local cloning and syncing of the fitness-data repository.
 * Clones to /tmp on each deploy. For existing repos, attempts a non-destructive
 * sync but preserves local work - the agent can handle conflicts via Bash.
 */

import { spawnSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";

export interface RepoConfig {
  repoUrl: string;
  token: string;
}

const DATA_DIR = "/tmp";
const REPO_DIR = join(DATA_DIR, "fitness-data");

let cachedDataDir: string | null = null;

interface GitResult {
  success: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Run git command, throwing on failure
 */
function git(args: string[], cwd?: string): string {
  const result = spawnSync("git", args, {
    cwd,
    stdio: "pipe",
    encoding: "utf-8",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`git ${args[0]} failed: ${result.stderr || ""}`);
  }

  return result.stdout || "";
}

/**
 * Run git command without throwing - returns result for caller to handle
 */
function gitSafe(args: string[], cwd?: string): GitResult {
  const result = spawnSync("git", args, {
    cwd,
    stdio: "pipe",
    encoding: "utf-8",
  });

  if (result.error) {
    return { success: false, stdout: "", stderr: result.error.message };
  }

  return {
    success: result.status === 0,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

export async function syncRepo(config: RepoConfig): Promise<string> {
  const { repoUrl, token } = config;
  const authUrl = repoUrl.replace("https://", `https://${token}@`);

  cachedDataDir = REPO_DIR;

  if (existsSync(join(REPO_DIR, ".git"))) {
    // Repo exists - update credentials and try non-destructive sync
    git(["remote", "set-url", "origin", authUrl], REPO_DIR);

    // Fetch latest from remote (non-destructive)
    const fetchResult = gitSafe(["fetch", "origin"], REPO_DIR);
    if (!fetchResult.success) {
      console.warn("[repo-sync] fetch failed, continuing anyway:", fetchResult.stderr);
    }

    // Try fast-forward merge if we're on main with a clean working tree
    // If this fails, the agent can handle it - it has Bash access to git
    const branchResult = gitSafe(["rev-parse", "--abbrev-ref", "HEAD"], REPO_DIR);
    const currentBranch = branchResult.stdout.trim();

    if (currentBranch === "main") {
      const mergeResult = gitSafe(["merge", "--ff-only", "origin/main"], REPO_DIR);
      if (!mergeResult.success) {
        // Not a fatal error - agent can observe and handle via git commands
        console.warn(
          "[repo-sync] fast-forward merge failed (agent can resolve):",
          mergeResult.stderr.trim()
        );
      }
    } else {
      console.log(
        `[repo-sync] on branch '${currentBranch}', skipping auto-merge (agent can sync if needed)`
      );
    }
  } else {
    // Fresh clone
    mkdirSync(REPO_DIR, { recursive: true });
    git(["clone", authUrl, REPO_DIR]);
  }

  // Fetch all remote branches so agent can see existing workout branches
  gitSafe(["fetch", "--all"], REPO_DIR);

  // Configure git identity (customizable via env vars)
  const gitEmail = process.env.GIT_COMMIT_EMAIL || "coach@fitness-bot.local";
  const gitName = process.env.GIT_COMMIT_NAME || "Fitness Coach";
  git(["config", "user.email", gitEmail], REPO_DIR);
  git(["config", "user.name", gitName], REPO_DIR);

  return REPO_DIR;
}

export async function pushChanges(message: string): Promise<void> {
  if (!cachedDataDir) {
    throw new Error("Repo not synced yet. Call syncRepo first.");
  }

  git(["add", "-A"], cachedDataDir);

  const statusResult = spawnSync("git", ["status", "--porcelain"], {
    cwd: cachedDataDir,
    stdio: "pipe",
    encoding: "utf-8",
  });

  if (!statusResult.stdout || statusResult.stdout.trim() === "") {
    return;
  }

  git(["commit", "-m", message], cachedDataDir);

  // Get current branch name to handle new branches that need upstream set
  const currentBranch = git(["rev-parse", "--abbrev-ref", "HEAD"], cachedDataDir).trim();

  // Use -u to set upstream, which works for both new and existing branches
  git(["push", "-u", "origin", currentBranch], cachedDataDir);
}
