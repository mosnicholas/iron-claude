/**
 * GitHub Storage Layer
 *
 * All data operations go through this module.
 * GitHub is the database - every change is a commit.
 */

import type { GitHubFileContent, GitHubCommitResponse, GitHubBranch } from "./types.js";

const GITHUB_API_BASE = "https://api.github.com";

interface GitHubConfig {
  token: string;
  repo: string; // format: "owner/repo"
}

export class GitHubStorage {
  private config: GitHubConfig;
  private owner: string;
  private repo: string;

  constructor(config: GitHubConfig) {
    this.config = config;
    const [owner, repo] = config.repo.split("/");
    if (!owner || !repo) {
      throw new Error('Invalid repo format. Expected "owner/repo"');
    }
    this.owner = owner;
    this.repo = repo;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${GITHUB_API_BASE}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`GitHub API error: ${response.status} - ${errorBody}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  // ============================================================================
  // File Operations
  // ============================================================================

  /**
   * Read a file from the repository
   */
  async readFile(path: string, branch = "main"): Promise<string | null> {
    try {
      const endpoint = `/repos/${this.owner}/${this.repo}/contents/${path}?ref=${branch}`;
      const data = await this.request<GitHubFileContent>(endpoint);

      if (data.encoding === "base64") {
        return Buffer.from(data.content, "base64").toString("utf-8");
      }
      return data.content;
    } catch (error) {
      if (error instanceof Error && error.message.includes("404")) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Write or update a file
   */
  async writeFile(
    path: string,
    content: string,
    message: string,
    branch = "main"
  ): Promise<GitHubCommitResponse> {
    // First, try to get the existing file to get its SHA
    let sha: string | undefined;
    try {
      const endpoint = `/repos/${this.owner}/${this.repo}/contents/${path}?ref=${branch}`;
      const existing = await this.request<GitHubFileContent>(endpoint);
      sha = existing.sha;
    } catch {
      // File doesn't exist, that's fine
    }

    const endpoint = `/repos/${this.owner}/${this.repo}/contents/${path}`;
    const body: Record<string, unknown> = {
      message,
      content: Buffer.from(content).toString("base64"),
      branch,
    };

    if (sha) {
      body.sha = sha;
    }

    return this.request<GitHubCommitResponse>(endpoint, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  /**
   * Delete a file
   */
  async deleteFile(path: string, message: string, branch = "main"): Promise<void> {
    const endpoint = `/repos/${this.owner}/${this.repo}/contents/${path}?ref=${branch}`;
    const existing = await this.request<GitHubFileContent>(endpoint);

    await this.request(`/repos/${this.owner}/${this.repo}/contents/${path}`, {
      method: "DELETE",
      body: JSON.stringify({
        message,
        sha: existing.sha,
        branch,
      }),
    });
  }

  /**
   * Move/rename a file
   */
  async moveFile(
    fromPath: string,
    toPath: string,
    message: string,
    branch = "main"
  ): Promise<GitHubCommitResponse> {
    const content = await this.readFile(fromPath, branch);
    if (content === null) {
      throw new Error(`File not found: ${fromPath}`);
    }

    // Write to new location
    const result = await this.writeFile(toPath, content, message, branch);

    // Delete old file
    await this.deleteFile(fromPath, `Delete ${fromPath} (moved to ${toPath})`, branch);

    return result;
  }

  /**
   * List files in a directory
   */
  async listFiles(directory: string, branch = "main"): Promise<string[]> {
    try {
      const endpoint = `/repos/${this.owner}/${this.repo}/contents/${directory}?ref=${branch}`;
      const data = await this.request<Array<{ path: string; type: string }>>(endpoint);

      return data.filter((item) => item.type === "file").map((item) => item.path);
    } catch (error) {
      if (error instanceof Error && error.message.includes("404")) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Check if a file exists
   */
  async fileExists(path: string, branch = "main"): Promise<boolean> {
    try {
      const endpoint = `/repos/${this.owner}/${this.repo}/contents/${path}?ref=${branch}`;
      await this.request(endpoint);
      return true;
    } catch {
      return false;
    }
  }

  // ============================================================================
  // Branch Operations
  // ============================================================================

  /**
   * Create a new branch from main
   */
  async createBranch(branchName: string): Promise<void> {
    // Get the SHA of main branch
    const mainRef = await this.request<{ object: { sha: string } }>(
      `/repos/${this.owner}/${this.repo}/git/ref/heads/main`
    );

    // Create new branch
    await this.request(`/repos/${this.owner}/${this.repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: mainRef.object.sha,
      }),
    });
  }

  /**
   * Delete a branch
   */
  async deleteBranch(branchName: string): Promise<void> {
    await this.request(`/repos/${this.owner}/${this.repo}/git/refs/heads/${branchName}`, {
      method: "DELETE",
    });
  }

  /**
   * Get branch info
   */
  async getBranch(branchName: string): Promise<GitHubBranch | null> {
    try {
      return await this.request<GitHubBranch>(
        `/repos/${this.owner}/${this.repo}/branches/${branchName}`
      );
    } catch {
      return null;
    }
  }

  /**
   * List all branches matching a pattern
   */
  async listBranches(prefix?: string): Promise<string[]> {
    const branches = await this.request<GitHubBranch[]>(
      `/repos/${this.owner}/${this.repo}/branches?per_page=100`
    );

    const branchNames = branches.map((b) => b.name);

    if (prefix) {
      return branchNames.filter((name) => name.startsWith(prefix));
    }

    return branchNames;
  }

  /**
   * Merge a branch into main
   */
  async mergeBranch(
    branchName: string,
    deleteAfter = false
  ): Promise<{ sha: string; merged: boolean }> {
    const result = await this.request<{ sha: string; merged: boolean }>(
      `/repos/${this.owner}/${this.repo}/merges`,
      {
        method: "POST",
        body: JSON.stringify({
          base: "main",
          head: branchName,
          commit_message: `Merge ${branchName} into main`,
        }),
      }
    );

    if (deleteAfter && result.merged) {
      await this.deleteBranch(branchName);
    }

    return result;
  }

  // ============================================================================
  // Workout Branch Helpers
  // ============================================================================

  /**
   * Create a workout branch for today's session
   */
  async createWorkoutBranch(date: string, workoutType: string): Promise<string> {
    const branchName = `workout/${date}-${workoutType.toLowerCase().replace(/\s+/g, "-")}`;
    await this.createBranch(branchName);
    return branchName;
  }

  /**
   * Find any in-progress workout branch
   */
  async findInProgressWorkout(): Promise<string | null> {
    const workoutBranches = await this.listBranches("workout/");

    // Check each branch for in-progress.md in the week folder
    for (const branch of workoutBranches) {
      // Branch name format: workout/2026-01-27-push
      const parts = branch.split("/")[1]?.split("-");
      if (parts && parts.length >= 3) {
        const dateStr = `${parts[0]}-${parts[1]}-${parts[2]}`;
        const week = this.getWeekFromDate(dateStr);
        const hasInProgress = await this.fileExists(`weeks/${week}/in-progress.md`, branch);
        if (hasInProgress) {
          return branch;
        }
      }
    }

    return null;
  }

  /**
   * Get week string (YYYY-WXX) from a date string (YYYY-MM-DD)
   */
  private getWeekFromDate(dateStr: string): string {
    const date = new Date(dateStr + "T12:00:00");
    const year = date.getFullYear();
    const firstDayOfYear = new Date(year, 0, 1);
    const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
    const weekNum = Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
    return `${year}-W${weekNum.toString().padStart(2, "0")}`;
  }

  /**
   * Complete a workout - finalize and merge
   */
  async completeWorkout(branch: string, finalDate: string, week: string): Promise<void> {
    // Rename in-progress.md to the final date
    await this.moveFile(
      `weeks/${week}/in-progress.md`,
      `weeks/${week}/${finalDate}.md`,
      "Finalize workout file",
      branch
    );

    // Merge to main
    await this.mergeBranch(branch, true);
  }

  // ============================================================================
  // Convenience Methods for Common Files
  // ============================================================================

  async readProfile(): Promise<string | null> {
    return this.readFile("profile.md");
  }

  async readLearnings(): Promise<string | null> {
    return this.readFile("learnings.md");
  }

  async readPRs(): Promise<string | null> {
    return this.readFile("prs.yaml");
  }

  async readE1RMHistory(): Promise<string | null> {
    return this.readFile("analytics/e1rm-history.yaml");
  }

  async writeE1RMHistory(content: string, message: string): Promise<void> {
    await this.writeFile("analytics/e1rm-history.yaml", content, message);
  }

  async readWeeklyPlan(week: string): Promise<string | null> {
    return this.readFile(`weeks/${week}/plan.md`);
  }

  async readWeeklyRetro(week: string): Promise<string | null> {
    return this.readFile(`weeks/${week}/retro.md`);
  }

  async listWeekWorkouts(week: string): Promise<string[]> {
    return this.listFiles(`weeks/${week}`).then((files) =>
      files.filter((f) => !f.endsWith("plan.md") && !f.endsWith("retro.md"))
    );
  }

  async listWeeks(): Promise<string[]> {
    try {
      const endpoint = `/repos/${this.owner}/${this.repo}/contents/weeks?ref=main`;
      const data = await this.request<Array<{ name: string; type: string }>>(endpoint);
      return data.filter((item) => item.type === "dir").map((item) => item.name);
    } catch (error) {
      if (error instanceof Error && error.message.includes("404")) {
        return [];
      }
      throw error;
    }
  }

  // ============================================================================
  // Planning State Management
  // ============================================================================

  /**
   * Save planning-pending state (cron asks questions, waiting for response)
   */
  async savePlanningState(week: string): Promise<void> {
    const state = {
      week,
      askedAt: new Date().toISOString(),
    };
    await this.writeFile(
      "state/planning-pending.json",
      JSON.stringify(state, null, 2),
      `Start planning for ${week}`
    );
  }

  /**
   * Get pending planning state (if any)
   */
  async getPlanningState(): Promise<{ week: string; askedAt: string } | null> {
    const content = await this.readFile("state/planning-pending.json");
    if (!content) return null;
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Clear planning state (after plan is generated)
   */
  async clearPlanningState(): Promise<void> {
    try {
      await this.deleteFile("state/planning-pending.json", "Plan finalized");
    } catch {
      // File might not exist, that's fine
    }
  }
}

/**
 * Create a GitHubStorage instance from environment variables
 */
export function createGitHubStorage(): GitHubStorage {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.DATA_REPO;

  if (!token || !repo) {
    throw new Error("Missing GITHUB_TOKEN or DATA_REPO environment variables");
  }

  return new GitHubStorage({ token, repo });
}
