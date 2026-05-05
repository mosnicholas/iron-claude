/**
 * Atomic write + commit + push helper used by every write tool.
 *
 * Reliability features:
 *   - One filesystem write, one commit, one push per tool call.
 *   - Push retries with exponential backoff on transient network errors.
 *   - Returns the commit hash so the observability layer can record it.
 */

import { spawnSync } from "child_process";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";

const PUSH_RETRY_DELAYS_MS = [1000, 2000, 4000];

interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function run(args: string[], cwd: string): RunResult {
  const r = spawnSync("git", args, { cwd, stdio: "pipe", encoding: "utf-8" });
  if (r.error) return { ok: false, stdout: "", stderr: r.error.message };
  return {
    ok: r.status === 0,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

export interface CommitOptions {
  /** Skip pushing to remote — used by tests against local-only repos. */
  noPush?: boolean;
}

export interface CommitResult {
  commit: string;
  pushed: boolean;
  /** Set when nothing was actually staged (file content identical to HEAD). */
  noop?: boolean;
}

/**
 * Write a file (creating parents as needed), stage it, commit, and push.
 * Path must be relative to repoPath.
 */
export async function writeAndCommit(
  repoPath: string,
  relativePath: string,
  content: string,
  message: string,
  opts: CommitOptions = {}
): Promise<CommitResult> {
  const fullPath = `${repoPath}/${relativePath}`;
  if (!existsSync(dirname(fullPath))) {
    mkdirSync(dirname(fullPath), { recursive: true });
  }
  writeFileSync(fullPath, content, "utf-8");

  const add = run(["add", "--", relativePath], repoPath);
  if (!add.ok) throw new Error(`git add failed: ${add.stderr}`);

  // Did the staged change actually differ?
  const diff = run(["diff", "--cached", "--quiet"], repoPath);
  if (diff.ok) {
    // Exit code 0 = no staged differences. Tool result was a no-op.
    const head = run(["rev-parse", "HEAD"], repoPath);
    return { commit: head.stdout.trim(), pushed: false, noop: true };
  }

  const commit = run(["commit", "-m", message], repoPath);
  if (!commit.ok) throw new Error(`git commit failed: ${commit.stderr}`);

  const head = run(["rev-parse", "HEAD"], repoPath);
  const sha = head.stdout.trim();

  if (opts.noPush) {
    return { commit: sha, pushed: false };
  }

  // Skip push when there's no remote (test repos, local-only setups).
  const remote = run(["remote"], repoPath);
  if (!remote.ok || !remote.stdout.trim()) {
    return { commit: sha, pushed: false };
  }

  const branch = run(["rev-parse", "--abbrev-ref", "HEAD"], repoPath).stdout.trim();
  let pushed = false;
  let lastErr = "";
  for (let attempt = 0; attempt <= PUSH_RETRY_DELAYS_MS.length; attempt++) {
    const push = run(["push", "-u", "origin", branch], repoPath);
    if (push.ok) {
      pushed = true;
      break;
    }
    lastErr = push.stderr;
    if (attempt < PUSH_RETRY_DELAYS_MS.length) {
      await sleep(PUSH_RETRY_DELAYS_MS[attempt]);
    }
  }
  if (!pushed) {
    // The commit landed locally — surface the push failure so the model can
    // tell the user, but don't undo the commit. The next successful tool call
    // will push it as a side effect.
    console.error(`[git] push failed after retries: ${lastErr}`);
  }
  return { commit: sha, pushed };
}
