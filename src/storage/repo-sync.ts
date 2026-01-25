/**
 * Repository Sync
 *
 * Manages local cloning and syncing of the fitness-data repository
 * for direct file system access via Claude Agent SDK.
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const DATA_DIR = join(tmpdir(), 'fitness-data');

export interface RepoConfig {
  repoUrl: string;
  token: string;
}

/**
 * Get the local path where the repo is cloned
 */
export function getLocalRepoPath(): string {
  return DATA_DIR;
}

/**
 * Clone or pull the fitness-data repo locally
 */
export async function syncRepo(config: RepoConfig): Promise<string> {
  const { repoUrl, token } = config;

  const authUrl = repoUrl.replace('https://', `https://${token}@`);

  if (existsSync(join(DATA_DIR, '.git'))) {
    execSync('git pull --ff-only', { cwd: DATA_DIR, stdio: 'pipe' });
  } else {
    mkdirSync(DATA_DIR, { recursive: true });
    execSync(`git clone ${authUrl} ${DATA_DIR}`, { stdio: 'pipe' });
  }

  execSync('git config user.email "coach@fitness-bot.local"', { cwd: DATA_DIR });
  execSync('git config user.name "Fitness Coach"', { cwd: DATA_DIR });

  return DATA_DIR;
}

/**
 * Commit and push changes to the repo
 */
export async function pushChanges(message: string): Promise<void> {
  try {
    execSync('git add -A', { cwd: DATA_DIR, stdio: 'pipe' });
    execSync(`git commit -m "${message}"`, { cwd: DATA_DIR, stdio: 'pipe' });
    execSync('git push', { cwd: DATA_DIR, stdio: 'pipe' });
  } catch (error) {
    if (!String(error).includes('nothing to commit')) {
      throw error;
    }
  }
}
