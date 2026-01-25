/**
 * Coach Agent Tools
 *
 * Tool definitions for the Claude-powered fitness coach.
 * These tools allow the agent to interact with the GitHub data repository.
 */

import type { Tool } from '@anthropic-ai/sdk/resources/messages.js';
import { GitHubStorage } from '../storage/github.js';

/**
 * Tool definitions for the Anthropic API
 */
export const COACH_TOOLS: Tool[] = [
  {
    name: 'read_file',
    description: 'Read a file from the fitness data repository. Use this to access profile, workouts, plans, learnings, and PRs.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to repository root (e.g., "profile.md", "workouts/2025-01-24.md")',
        },
        branch: {
          type: 'string',
          description: 'Branch to read from. Defaults to "main". Use workout branch name when reading in-progress workouts.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write or update a file in the repository. Creates a commit immediately. Use for logging workouts, updating profile, recording learnings.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to repository root',
        },
        content: {
          type: 'string',
          description: 'Full file content to write',
        },
        message: {
          type: 'string',
          description: 'Commit message describing the change',
        },
        branch: {
          type: 'string',
          description: 'Branch to write to. Defaults to "main". Use workout branch for in-progress workouts.',
        },
      },
      required: ['path', 'content', 'message'],
    },
  },
  {
    name: 'create_branch',
    description: 'Create a new branch from main. Use when starting a new workout session.',
    input_schema: {
      type: 'object' as const,
      properties: {
        branch_name: {
          type: 'string',
          description: 'Name for the new branch (e.g., "workout/2025-01-24-push")',
        },
      },
      required: ['branch_name'],
    },
  },
  {
    name: 'merge_branch',
    description: 'Merge a branch into main. Use when completing a workout session.',
    input_schema: {
      type: 'object' as const,
      properties: {
        branch_name: {
          type: 'string',
          description: 'Name of the branch to merge',
        },
        delete_after: {
          type: 'boolean',
          description: 'Whether to delete the branch after merging. Defaults to false.',
        },
      },
      required: ['branch_name'],
    },
  },
  {
    name: 'list_files',
    description: 'List files in a directory of the repository.',
    input_schema: {
      type: 'object' as const,
      properties: {
        directory: {
          type: 'string',
          description: 'Directory path (e.g., "workouts", "plans")',
        },
        branch: {
          type: 'string',
          description: 'Branch to list from. Defaults to "main".',
        },
      },
      required: ['directory'],
    },
  },
  {
    name: 'move_file',
    description: 'Move or rename a file. Use when finalizing a workout (renaming in-progress.md to dated file).',
    input_schema: {
      type: 'object' as const,
      properties: {
        from_path: {
          type: 'string',
          description: 'Current file path',
        },
        to_path: {
          type: 'string',
          description: 'New file path',
        },
        message: {
          type: 'string',
          description: 'Commit message',
        },
        branch: {
          type: 'string',
          description: 'Branch to operate on. Defaults to "main".',
        },
      },
      required: ['from_path', 'to_path', 'message'],
    },
  },
  {
    name: 'web_search',
    description: 'Search the web for information. Use for finding exercise demos, gym schedules, fitness information.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'web_fetch',
    description: 'Fetch content from a URL. Use to get details from a specific page like gym schedules.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'URL to fetch',
        },
      },
      required: ['url'],
    },
  },
];

/**
 * Tool execution handler
 */
export interface ToolExecutionResult {
  success: boolean;
  result?: string;
  error?: string;
}

export class ToolExecutor {
  private storage: GitHubStorage;

  constructor(storage: GitHubStorage) {
    this.storage = storage;
  }

  async execute(
    toolName: string,
    toolInput: Record<string, unknown>
  ): Promise<ToolExecutionResult> {
    try {
      switch (toolName) {
        case 'read_file':
          return this.readFile(toolInput);
        case 'write_file':
          return this.writeFile(toolInput);
        case 'create_branch':
          return this.createBranch(toolInput);
        case 'merge_branch':
          return this.mergeBranch(toolInput);
        case 'list_files':
          return this.listFiles(toolInput);
        case 'move_file':
          return this.moveFile(toolInput);
        case 'web_search':
          return this.webSearch(toolInput);
        case 'web_fetch':
          return this.webFetch(toolInput);
        default:
          return { success: false, error: `Unknown tool: ${toolName}` };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  private async readFile(input: Record<string, unknown>): Promise<ToolExecutionResult> {
    const path = input.path as string;
    const branch = (input.branch as string) || 'main';

    const content = await this.storage.readFile(path, branch);

    if (content === null) {
      return { success: false, error: `File not found: ${path}` };
    }

    return { success: true, result: content };
  }

  private async writeFile(input: Record<string, unknown>): Promise<ToolExecutionResult> {
    const path = input.path as string;
    const content = input.content as string;
    const message = input.message as string;
    const branch = (input.branch as string) || 'main';

    const result = await this.storage.writeFile(path, content, message, branch);

    return {
      success: true,
      result: `File written successfully. Commit: ${result.sha.slice(0, 7)}`,
    };
  }

  private async createBranch(input: Record<string, unknown>): Promise<ToolExecutionResult> {
    const branchName = input.branch_name as string;

    await this.storage.createBranch(branchName);

    return { success: true, result: `Branch created: ${branchName}` };
  }

  private async mergeBranch(input: Record<string, unknown>): Promise<ToolExecutionResult> {
    const branchName = input.branch_name as string;
    const deleteAfter = (input.delete_after as boolean) || false;

    const result = await this.storage.mergeBranch(branchName, deleteAfter);

    return {
      success: true,
      result: `Branch merged. Commit: ${result.sha.slice(0, 7)}${deleteAfter ? '. Branch deleted.' : ''}`,
    };
  }

  private async listFiles(input: Record<string, unknown>): Promise<ToolExecutionResult> {
    const directory = input.directory as string;
    const branch = (input.branch as string) || 'main';

    const files = await this.storage.listFiles(directory, branch);

    if (files.length === 0) {
      return { success: true, result: 'No files found in directory.' };
    }

    return { success: true, result: files.join('\n') };
  }

  private async moveFile(input: Record<string, unknown>): Promise<ToolExecutionResult> {
    const fromPath = input.from_path as string;
    const toPath = input.to_path as string;
    const message = input.message as string;
    const branch = (input.branch as string) || 'main';

    await this.storage.moveFile(fromPath, toPath, message, branch);

    return { success: true, result: `File moved from ${fromPath} to ${toPath}` };
  }

  private async webSearch(input: Record<string, unknown>): Promise<ToolExecutionResult> {
    const query = input.query as string;

    // Use a simple search API or return placeholder
    // In production, integrate with a search provider
    try {
      const response = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`
      );
      const data = await response.json();

      if (data.AbstractText) {
        return { success: true, result: data.AbstractText };
      }

      if (data.RelatedTopics && data.RelatedTopics.length > 0) {
        const results = data.RelatedTopics.slice(0, 5)
          .filter((t: { Text?: string }) => t.Text)
          .map((t: { Text: string }) => t.Text)
          .join('\n\n');
        return { success: true, result: results || 'No results found.' };
      }

      return { success: true, result: 'No results found for this query.' };
    } catch {
      return {
        success: false,
        error: 'Web search is currently unavailable. Please try again later.',
      };
    }
  }

  private async webFetch(input: Record<string, unknown>): Promise<ToolExecutionResult> {
    const url = input.url as string;

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'FitnessCoach/1.0',
        },
      });

      if (!response.ok) {
        return { success: false, error: `Failed to fetch: ${response.status}` };
      }

      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('application/json')) {
        const json = await response.json();
        return { success: true, result: JSON.stringify(json, null, 2) };
      }

      const text = await response.text();

      // Truncate very long responses
      const maxLength = 10000;
      if (text.length > maxLength) {
        return {
          success: true,
          result: text.slice(0, maxLength) + '\n\n[Content truncated...]',
        };
      }

      return { success: true, result: text };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: `Failed to fetch URL: ${message}` };
    }
  }
}
