/**
 * Repository Sync
 *
 * Manages local cloning and syncing of the fitness-data repository.
 * Clones to /tmp on each deploy; subsequent syncs reset to origin/main.
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

export function getLocalRepoPath(): string {
  if (!cachedDataDir) {
    throw new Error("Repo not synced yet. Call syncRepo first.");
  }
  return cachedDataDir;
}

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

export async function syncRepo(config: RepoConfig): Promise<string> {
  const { repoUrl, token } = config;
  const authUrl = repoUrl.replace("https://", `https://${token}@`);

  cachedDataDir = REPO_DIR;

  if (existsSync(join(REPO_DIR, ".git"))) {
    // Repo exists - check if we need to update
    git(["remote", "set-url", "origin", authUrl], REPO_DIR);

    // Discard any local uncommitted changes before switching branches
    git(["reset", "--hard", "HEAD"], REPO_DIR);
    git(["clean", "-fd"], REPO_DIR);

    // Ensure we're on main branch before syncing
    // (local repo may be on a workout branch from a previous session)
    git(["checkout", "main"], REPO_DIR);

    // Fetch latest from remote
    git(["fetch", "origin", "main"], REPO_DIR);

    // Reset to match remote - this handles diverged branches
    // The remote (GitHub) is the source of truth for fitness-data
    git(["reset", "--hard", "origin/main"], REPO_DIR);
  } else {
    // Fresh clone
    mkdirSync(REPO_DIR, { recursive: true });
    git(["clone", authUrl, REPO_DIR]);
  }

  // Fetch all remote branches so agent can see existing workout branches
  git(["fetch", "--all"], REPO_DIR);

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
