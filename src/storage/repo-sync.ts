/**
 * Repository Sync
 *
 * Manages local cloning and syncing of the fitness-data repository
 * for direct file system access via Claude Agent SDK.
 */

import { spawnSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createHash } from "crypto";

export interface RepoConfig {
  repoUrl: string;
  token: string;
}

/**
 * Generate a unique directory name for a repo to avoid conflicts
 * in serverless environments where /tmp is shared.
 */
function getRepoDirName(repoUrl: string): string {
  const hash = createHash("sha256").update(repoUrl).digest("hex").slice(0, 12);
  return `fitness-data-${hash}`;
}

let cachedDataDir: string | null = null;

/**
 * Get the local path where the repo is cloned
 */
export function getLocalRepoPath(): string {
  if (!cachedDataDir) {
    throw new Error("Repo not synced yet. Call syncRepo first.");
  }
  return cachedDataDir;
}

/**
 * Run a git command safely using spawnSync (no shell interpolation)
 */
function git(args: string[], cwd?: string): void {
  const result = spawnSync("git", args, {
    cwd,
    stdio: "pipe",
    encoding: "utf-8",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = result.stderr || "";
    throw new Error(`git ${args[0]} failed: ${stderr}`);
  }
}

/**
 * Clone or pull the fitness-data repo locally
 */
export async function syncRepo(config: RepoConfig): Promise<string> {
  const { repoUrl, token } = config;

  const authUrl = repoUrl.replace("https://", `https://${token}@`);
  const dataDir = join(tmpdir(), getRepoDirName(repoUrl));
  cachedDataDir = dataDir;

  if (existsSync(join(dataDir, ".git"))) {
    git(["pull", "--ff-only"], dataDir);
  } else {
    mkdirSync(dataDir, { recursive: true });
    git(["clone", authUrl, dataDir]);
  }

  git(["config", "user.email", "coach@fitness-bot.local"], dataDir);
  git(["config", "user.name", "Fitness Coach"], dataDir);

  return dataDir;
}

/**
 * Commit and push changes to the repo
 */
export async function pushChanges(message: string): Promise<void> {
  if (!cachedDataDir) {
    throw new Error("Repo not synced yet. Call syncRepo first.");
  }

  try {
    git(["add", "-A"], cachedDataDir);
    git(["commit", "-m", message], cachedDataDir);
    git(["push"], cachedDataDir);
  } catch (error) {
    // "nothing to commit" is not a real error
    if (!String(error).includes("nothing to commit")) {
      throw error;
    }
  }
}
