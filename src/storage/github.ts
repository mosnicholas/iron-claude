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
   * Read a file and return both content and SHA (for optimistic locking)
   */
  async readFileWithSha(
    path: string,
    branch = "main"
  ): Promise<{ content: string; sha: string } | null> {
    try {
      const endpoint = `/repos/${this.owner}/${this.repo}/contents/${path}?ref=${branch}`;
      const data = await this.request<GitHubFileContent>(endpoint);

      const content =
        data.encoding === "base64"
          ? Buffer.from(data.content, "base64").toString("utf-8")
          : data.content;

      return { content, sha: data.sha };
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

    return this.writeFileWithSha(path, content, message, sha, branch);
  }

  /**
   * Write a file with an explicit SHA for optimistic locking.
   * Pass sha=undefined for new files, or a known SHA to prevent concurrent overwrites.
   * Throws on SHA mismatch (409 conflict).
   */
  async writeFileWithSha(
    path: string,
    content: string,
    message: string,
    sha?: string,
    branch = "main"
  ): Promise<GitHubCommitResponse> {
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
  // Generic State Helpers
  // ============================================================================

  private async getState<T>(path: string, fallback: T): Promise<T> {
    const content = await this.readFile(path);
    if (!content) return fallback;
    try {
      return JSON.parse(content);
    } catch {
      return fallback;
    }
  }

  private async setState<T>(path: string, state: T, message: string): Promise<void> {
    await this.writeFile(path, JSON.stringify(state, null, 2), message);
  }

  private async clearState(path: string, message: string): Promise<void> {
    try {
      await this.deleteFile(path, message);
    } catch {
      // File might not exist, that's fine
    }
  }

  // ============================================================================
  // Planning State
  // ============================================================================

  async savePlanningState(week: string): Promise<void> {
    await this.setState(
      "state/planning-pending.json",
      { week, askedAt: new Date().toISOString() },
      `Start planning for ${week}`
    );
  }

  async getPlanningState(): Promise<{ week: string; askedAt: string } | null> {
    return this.getState("state/planning-pending.json", null);
  }

  async clearPlanningState(): Promise<void> {
    await this.clearState("state/planning-pending.json", "Plan finalized");
  }

  // ============================================================================
  // Gym Time State
  // ============================================================================

  async saveGymTimePendingState(date: string): Promise<void> {
    await this.setState(
      "state/gym-time-pending.json",
      { date, askedAt: new Date().toISOString() },
      `Ask gym time for ${date}`
    );
  }

  async getGymTimePendingState(): Promise<{ date: string; askedAt: string } | null> {
    return this.getState("state/gym-time-pending.json", null);
  }

  async clearGymTimePendingState(): Promise<void> {
    await this.clearState("state/gym-time-pending.json", "Gym time set");
  }

  // ============================================================================
  // Reminders
  // ============================================================================

  async getReminders(): Promise<Reminder[]> {
    return this.getState("state/reminders.json", []);
  }

  async addReminder(reminder: Omit<Reminder, "id" | "createdAt">): Promise<Reminder> {
    const reminders = await this.getReminders();
    const newReminder: Reminder = {
      ...reminder,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    reminders.push(newReminder);
    await this.setState(
      "state/reminders.json",
      reminders,
      `Add reminder for ${reminder.triggerDate} ${reminder.triggerHour}:00`
    );
    return newReminder;
  }

  async deleteReminder(id: string): Promise<void> {
    const reminders = await this.getReminders();
    const filtered = reminders.filter((r) => r.id !== id);
    if (filtered.length === reminders.length) return;

    if (filtered.length === 0) {
      await this.clearState("state/reminders.json", "Clear empty reminders");
    } else {
      await this.setState("state/reminders.json", filtered, `Remove processed reminder ${id}`);
    }
  }

  async updateReminder(id: string, updates: Partial<Pick<Reminder, "triggerDate">>): Promise<void> {
    const reminders = await this.getReminders();
    const index = reminders.findIndex((r) => r.id === id);
    if (index === -1) return;

    reminders[index] = { ...reminders[index], ...updates };
    await this.setState(
      "state/reminders.json",
      reminders,
      `Advance recurring reminder ${id} to ${updates.triggerDate}`
    );
  }

  async getDueReminders(date: string, hour: number): Promise<Reminder[]> {
    const reminders = await this.getReminders();
    return reminders.filter((r) => r.triggerDate === date && r.triggerHour === hour);
  }
}

/**
 * Reminder for follow-up messages
 */
export interface Reminder {
  id: string;
  triggerDate: string; // YYYY-MM-DD
  triggerHour: number; // 0-23 in configured timezone
  message: string; // The reminder message to send
  context?: string; // Additional context about why this reminder exists
  createdAt: string; // ISO timestamp
  recurringDays?: number; // Repeat every N days (e.g., 1 = daily, 7 = weekly)
  recurringUntil?: string; // Stop recurring after this date (YYYY-MM-DD, inclusive)
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
