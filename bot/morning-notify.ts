/**
 * Morning Notification - Send daily workout reminder
 *
 * This is a cron endpoint that:
 * 1. Reads today's workout from plan.md
 * 2. Sends a brief summary to Telegram
 *
 * No AI processing - just reads markdown and sends text.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { promises as fs } from 'fs';
import { getWeekNumber, getDayName, getDayKey, isWeekend } from './utils.js';

const TELEGRAM_API = 'https://api.telegram.org/bot';

interface TodayPlan {
  dayType: string;
  exercises: string[];
  focus?: string;
}

/**
 * Parse today's workout from plan.md
 */
async function getTodayPlan(repoPath: string): Promise<TodayPlan | null> {
  const week = getWeekNumber();
  const planPath = `${repoPath}/weeks/${week}/plan.md`;
  const dayName = getDayName();

  try {
    const content = await fs.readFile(planPath, 'utf-8');

    // Find today's section (e.g., "## Monday" or "## Monday - Upper Push")
    const dayPattern = new RegExp(
      `## ${dayName}[^#]*`,
      'i'
    );
    const dayMatch = content.match(dayPattern);

    if (!dayMatch) {
      return null;
    }

    const daySection = dayMatch[0];

    // Extract day type from header (e.g., "Monday - Upper Push" -> "Upper Push")
    const headerMatch = daySection.match(/## \w+(?:\s*-\s*(.+))?/);
    const dayType = headerMatch?.[1]?.trim() || 'Training';

    // Extract exercises (lines starting with "- **" or "- " followed by exercise name)
    const exercises: string[] = [];
    const exercisePattern = /- \*?\*?([^*\n:]+)\*?\*?(?::|$)/g;
    let match;
    while ((match = exercisePattern.exec(daySection)) !== null) {
      const exercise = match[1].trim();
      if (exercise && !exercise.toLowerCase().startsWith('note')) {
        exercises.push(exercise);
      }
    }

    // Extract focus if present
    const focusMatch = daySection.match(/(?:focus|priority)[:\s]*(.+)/i);
    const focus = focusMatch?.[1]?.trim();

    return {
      dayType,
      exercises: exercises.slice(0, 6), // Limit to top 6 exercises
      focus,
    };
  } catch {
    return null;
  }
}

/**
 * Build morning message
 */
function buildMorningMessage(
  dayName: string,
  plan: TodayPlan | null
): string {
  if (!plan) {
    if (isWeekend()) {
      return `${dayName} - Rest day. Enjoy your recovery.`;
    }
    return `${dayName}. No plan found for today. Run \`claude /plan-week\` to generate one.`;
  }

  const lines: string[] = [];

  // Header
  lines.push(`**${dayName} - ${plan.dayType}**`);
  lines.push('');

  // Focus if present
  if (plan.focus) {
    lines.push(`Focus: ${plan.focus}`);
    lines.push('');
  }

  // Exercise summary
  if (plan.exercises.length > 0) {
    lines.push(plan.exercises.join(', '));
  }

  lines.push('');
  lines.push('What time are you hitting the gym?');

  return lines.join('\n');
}

async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string
): Promise<void> {
  await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
    }),
  });
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Accept GET (Vercel cron) and POST (manual trigger)
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Verify cron secret if configured
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${cronSecret}`) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const repoPath = process.env.REPO_PATH || '.';

  if (!botToken || !chatId) {
    res.status(500).json({ error: 'Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID' });
    return;
  }

  try {
    const dayName = getDayName();
    const plan = await getTodayPlan(repoPath);
    const message = buildMorningMessage(dayName, plan);

    await sendTelegramMessage(botToken, chatId, message);

    res.status(200).json({
      ok: true,
      message: 'Morning notification sent',
      dayName,
      hasPlan: plan !== null,
    });
  } catch (error) {
    console.error('Morning notification error:', error);
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
