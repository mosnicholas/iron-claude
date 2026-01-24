import type {
  GitHubFileContent,
  GitHubDirectoryItem,
  GitHubCreateFileResponse,
  WorkoutLog,
  WeekPlan,
  UserProfile,
} from '../types/index.js';
import { getWeekNumber, formatDateForFilename } from '../utils/date.js';
import { parseClaudeMd } from '../utils/parser.js';
import { formatWorkoutLogMarkdown } from '../utils/markdown.js';

export class GitHubService {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(
    private readonly token: string,
    private readonly owner: string,
    private readonly repo: string
  ) {
    this.baseUrl = `https://api.github.com/repos/${owner}/${repo}`;
    this.headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    };
  }

  async getFile(path: string): Promise<string | null> {
    try {
      const response = await fetch(`${this.baseUrl}/contents/${path}`, {
        headers: this.headers,
      });

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
      }

      const data = (await response.json()) as GitHubFileContent;
      return Buffer.from(data.content, 'base64').toString('utf-8');
    } catch (error) {
      if (error instanceof Error && error.message.includes('404')) {
        return null;
      }
      throw error;
    }
  }

  async getFileSha(path: string): Promise<string | null> {
    try {
      const response = await fetch(`${this.baseUrl}/contents/${path}`, {
        headers: this.headers,
      });

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
      }

      const data = (await response.json()) as GitHubFileContent;
      return data.sha;
    } catch {
      return null;
    }
  }

  async listDirectory(path: string): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/contents/${path}`, {
        headers: this.headers,
      });

      if (response.status === 404) {
        return [];
      }

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
      }

      const data = (await response.json()) as GitHubDirectoryItem[];
      return data.map((item) => item.name);
    } catch {
      return [];
    }
  }

  async createFile(
    path: string,
    content: string,
    message: string
  ): Promise<void> {
    const response = await fetch(`${this.baseUrl}/contents/${path}`, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify({
        message,
        content: Buffer.from(content).toString('base64'),
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to create file: ${JSON.stringify(error)}`);
    }
  }

  async updateFile(
    path: string,
    content: string,
    message: string
  ): Promise<void> {
    const sha = await this.getFileSha(path);

    const response = await fetch(`${this.baseUrl}/contents/${path}`, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify({
        message,
        content: Buffer.from(content).toString('base64'),
        sha,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to update file: ${JSON.stringify(error)}`);
    }
  }

  async createOrUpdateFile(
    path: string,
    content: string,
    message: string
  ): Promise<GitHubCreateFileResponse> {
    const sha = await this.getFileSha(path);

    const body: Record<string, string> = {
      message,
      content: Buffer.from(content).toString('base64'),
    };

    if (sha) {
      body.sha = sha;
    }

    const response = await fetch(`${this.baseUrl}/contents/${path}`, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to create/update file: ${JSON.stringify(error)}`);
    }

    return response.json() as Promise<GitHubCreateFileResponse>;
  }

  async getClaudeContext(): Promise<UserProfile> {
    const content = await this.getFile('CLAUDE.md');
    if (!content) {
      throw new Error('CLAUDE.md not found in repository');
    }
    return parseClaudeMd(content);
  }

  async getCurrentWeekPlan(): Promise<WeekPlan | null> {
    const weekNumber = getWeekNumber();
    const planPath = `weeks/${weekNumber}/plan.md`;
    const content = await this.getFile(planPath);

    if (!content) {
      return null;
    }

    // Parse the plan markdown into WeekPlan structure
    return this.parseWeekPlan(content, weekNumber);
  }

  async getRecentLogs(weeksBack: number): Promise<WorkoutLog[]> {
    const logs: WorkoutLog[] = [];
    const currentWeek = getWeekNumber();

    for (let i = 0; i <= weeksBack; i++) {
      const weekNumber = this.getWeekNumberOffset(currentWeek, -i);
      const weekDir = `weeks/${weekNumber}`;
      const files = await this.listDirectory(weekDir);

      for (const file of files) {
        if (file !== 'plan.md' && file.endsWith('.md')) {
          const content = await this.getFile(`${weekDir}/${file}`);
          if (content) {
            const log = this.parseWorkoutLog(content);
            if (log) {
              logs.push(log);
            }
          }
        }
      }
    }

    return logs.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }

  async commitWorkoutLog(log: WorkoutLog): Promise<void> {
    const weekNumber = getWeekNumber(new Date(log.date));
    const filename = formatDateForFilename(new Date(log.date));
    const path = `weeks/${weekNumber}/${filename}.md`;

    const content = formatWorkoutLogMarkdown(log);
    const message = `Log workout: ${log.dayType} - ${log.date}`;

    await this.createOrUpdateFile(path, content, message);
  }

  async commitWeekPlan(planMarkdown: string, weekNumber: string): Promise<void> {
    const path = `weeks/${weekNumber}/plan.md`;
    const message = `Add week plan: ${weekNumber}`;

    await this.createOrUpdateFile(path, planMarkdown, message);
  }

  private parseWeekPlan(content: string, weekNumber: string): WeekPlan {
    // Basic parsing - in production you'd want more robust parsing
    const plan: WeekPlan = {
      weekNumber,
      startDate: '',
      endDate: '',
      focus: [],
      days: {},
      deloadStatus: {
        weeksInBlock: 1,
        needsDeload: false,
      },
    };

    // Extract focus areas
    const focusMatch = content.match(/## Focus\n([\s\S]*?)(?=##|$)/);
    if (focusMatch) {
      plan.focus = focusMatch[1]
        .split('\n')
        .filter((line) => line.startsWith('-'))
        .map((line) => line.replace(/^-\s*/, '').trim());
    }

    return plan;
  }

  private parseWorkoutLog(content: string): WorkoutLog | null {
    // Basic parsing - extract key fields from markdown
    try {
      const dateMatch = content.match(/Date:\s*(\d{4}-\d{2}-\d{2})/);
      const dayTypeMatch = content.match(
        /Type:\s*(upper-push|lower|conditioning|upper-pull|full-body|rest)/i
      );
      const energyMatch = content.match(/Energy:\s*(\d+)/);
      const sleepMatch = content.match(/Sleep:\s*(\d+(?:\.\d+)?)/);

      if (!dateMatch) return null;

      return {
        date: dateMatch[1],
        dayType: (dayTypeMatch?.[1]?.toLowerCase() || 'full-body') as WorkoutLog['dayType'],
        energy: parseInt(energyMatch?.[1] || '7', 10),
        sleepHours: parseFloat(sleepMatch?.[1] || '7'),
        skills: [],
        strength: [],
        notes: [],
      };
    } catch {
      return null;
    }
  }

  private getWeekNumberOffset(currentWeek: string, offset: number): string {
    const [year, week] = currentWeek.split('-W').map(Number);
    let newWeek = week + offset;
    let newYear = year;

    if (newWeek < 1) {
      newYear--;
      newWeek = 52 + newWeek;
    } else if (newWeek > 52) {
      newYear++;
      newWeek = newWeek - 52;
    }

    return `${newYear}-W${String(newWeek).padStart(2, '0')}`;
  }
}
