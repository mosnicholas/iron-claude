/**
 * Vercel Coach Agent
 *
 * A simpler coach agent for Vercel serverless that uses:
 * - Anthropic API directly (not Claude Agent SDK)
 * - GitHub API for file storage (not git clone)
 *
 * This works in serverless environments where git isn't available.
 */

import Anthropic from "@anthropic-ai/sdk";
import { createGitHubStorage } from "../storage/github.js";

export interface VercelCoachConfig {
  model?: string;
  timezone?: string;
}

export interface VercelCoachResponse {
  message: string;
}

const DEFAULT_MODEL = "claude-sonnet-4-20250514";

/**
 * Build context from GitHub storage
 */
async function buildContext(): Promise<string> {
  const storage = createGitHubStorage();
  const parts: string[] = [];

  // Read profile
  try {
    const profile = await storage.readFile("profile.md");
    if (profile) {
      parts.push("## User Profile\n\n" + profile);
    }
  } catch {
    // Profile may not exist yet
  }

  // Read recent workouts (last 7 days)
  try {
    const files = await storage.listFiles("workouts");
    const recentFiles = files.slice(-7); // Last 7 files
    for (const file of recentFiles) {
      try {
        const content = await storage.readFile(`workouts/${file}`);
        if (content) {
          parts.push(`## Workout: ${file}\n\n${content}`);
        }
      } catch {
        // Skip files that can't be read
      }
    }
  } catch {
    // Workouts directory may not exist yet
  }

  // Read current week's plan
  try {
    const now = new Date();
    const weekNum = getISOWeek(now);
    const year = now.getFullYear();
    const planPath = `plans/${year}-W${weekNum.toString().padStart(2, "0")}.md`;
    const plan = await storage.readFile(planPath);
    if (plan) {
      parts.push("## Current Week's Plan\n\n" + plan);
    }
  } catch {
    // Plan may not exist yet
  }

  return parts.join("\n\n---\n\n");
}

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * Chat with the coach
 */
export async function chat(
  userMessage: string,
  config: VercelCoachConfig = {}
): Promise<VercelCoachResponse> {
  const model = config.model || DEFAULT_MODEL;
  const timezone = config.timezone || process.env.TIMEZONE || "America/New_York";

  const anthropic = new Anthropic();
  const context = await buildContext();

  const systemPrompt = `You are a friendly and knowledgeable fitness coach. You help users with their workout planning, form advice, and motivation.

Current timezone: ${timezone}
Current date: ${new Date().toLocaleDateString("en-US", { timeZone: timezone, weekday: "long", year: "numeric", month: "long", day: "numeric" })}

${context ? `## User's Fitness Data\n\n${context}` : "No fitness data available yet. The user may need to complete onboarding."}

## Guidelines

- Be encouraging but honest
- Give specific, actionable advice
- Reference the user's profile and recent workouts when relevant
- Keep responses concise for Telegram (2-3 paragraphs max)
- Use emojis sparingly for friendliness`;

  const response = await anthropic.messages.create({
    model,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const textContent = response.content.find((c) => c.type === "text");
  const message = textContent?.type === "text" ? textContent.text : "Sorry, I couldn't generate a response.";

  return { message };
}

/**
 * Create a coach instance for compatibility with existing code
 */
export function createVercelCoachAgent(config?: VercelCoachConfig) {
  return {
    async chat(userMessage: string): Promise<VercelCoachResponse> {
      return chat(userMessage, config);
    },
    async runTask(taskPrompt: string): Promise<VercelCoachResponse> {
      return chat(taskPrompt, config);
    },
  };
}
