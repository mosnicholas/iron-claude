/**
 * IronClaude Bot - Thin Telegram I/O Layer
 *
 * This bot is intentionally simple:
 * - Receives workout logs via Telegram
 * - Appends them to markdown files
 * - Sends morning reminders from plan.md
 *
 * All AI/coaching logic lives in Claude Code skills, not here.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleLogMessage, parseWorkoutEntry } from './log-receiver.js';
import { getWeekNumber, getDayKey, getDayName } from './utils.js';

/**
 * Convert markdown tables to Telegram-friendly list format
 *
 * Before: | Exercise | Target | Weight | Notes |
 *         | OHP | 4x5-6 | 120 | Log RPE |
 *
 * After:  • OHP: 4x5-6 @ 120 — Log RPE
 */
function convertTablesToList(text: string): string {
  const lines = text.split('\n');
  const output: string[] = [];
  let inTable = false;
  let headers: string[] = [];

  for (const line of lines) {
    // Detect table row (starts and ends with |)
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const cells = line.split('|').slice(1, -1).map(c => c.trim());

      // Skip separator rows (|---|---|)
      if (cells.every(c => /^[-:]+$/.test(c))) {
        continue;
      }

      // First row = headers
      if (!inTable) {
        headers = cells;
        inTable = true;
        continue;
      }

      // Data row - format as list item
      // Assumes columns: Exercise, Target, Weight, Notes (or similar)
      const exercise = cells[0] || '';
      const target = cells[1] || '';
      const weight = cells[2] || '';
      const notes = cells[3] || '';

      let item = `• ${exercise}`;
      if (target) item += `: ${target}`;
      if (weight && weight !== '-' && !weight.includes('TBD')) item += ` @ ${weight}`;
      if (notes) item += ` — ${notes}`;

      output.push(item);
    } else {
      // Not a table row - end table mode if we were in one
      if (inTable) {
        inTable = false;
        headers = [];
      }
      output.push(line);
    }
  }

  return output.join('\n');
}

/**
 * Convert standard markdown to Telegram-friendly format
 */
function formatForTelegram(text: string): string {
  let result = text;

  // Convert markdown tables to list format (before other transformations)
  result = convertTablesToList(result);

  // Convert ## headers to bold
  result = result.replace(/^##\s+(.+)$/gm, '*$1*');

  // Convert ### headers to bold
  result = result.replace(/^###\s+(.+)$/gm, '*$1*');

  // Convert **bold** to *bold* (Telegram style)
  result = result.replace(/\*\*(.+?)\*\*/g, '*$1*');

  // Keep - bullet points as-is (they display fine)

  // Remove any remaining # headers
  result = result.replace(/^#+\s+/gm, '');

  // Clean up multiple blank lines
  result = result.replace(/\n{3,}/g, '\n\n');

  // Escape special Telegram MarkdownV2 characters in non-formatted text
  // But be careful not to escape our * for bold
  // For simplicity, we'll use basic Markdown mode which is more forgiving

  return result.trim();
}

/**
 * Fetch today's workout plan from GitHub
 */
async function fetchTodaysPlan(
  repo: string,
  token?: string
): Promise<string | null> {
  const week = getWeekNumber();
  const dayName = getDayName();
  const path = `weeks/${week}/plan.md`;

  const url = `https://api.github.com/repos/${repo}/contents/${path}`;
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3.raw',
    'User-Agent': 'IronClaude-Bot',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) return null;

    const content = await response.text();

    // Extract today's section from the plan
    const dayPattern = new RegExp(
      `## ${dayName}[\\s\\S]*?(?=\\n## \\w|$)`,
      'i'
    );
    const match = content.match(dayPattern);

    if (!match) {
      // Check if it's a rest day
      if (content.toLowerCase().includes(`${dayName.toLowerCase()}`) &&
          content.toLowerCase().includes('rest')) {
        return `**${dayName}** - Rest day. Recover well.`;
      }
      return null;
    }

    // Clean up and format for Telegram
    let todaySection = formatForTelegram(match[0]);

    // Limit length for Telegram
    if (todaySection.length > 2000) {
      todaySection = todaySection.slice(0, 2000) + '\n...';
    }

    return todaySection;
  } catch (error) {
    console.error('GitHub fetch error:', error);
    return null;
  }
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      first_name: string;
    };
    chat: {
      id: number;
      type: string;
    };
    date: number;
    text?: string;
  };
}

interface TelegramResponse {
  chat_id: number;
  text: string;
  parse_mode?: 'Markdown' | 'HTML';
}

const TELEGRAM_API = 'https://api.telegram.org/bot';

async function sendTelegramMessage(
  botToken: string,
  response: TelegramResponse
): Promise<void> {
  await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(response),
  });
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Only accept POST for webhooks
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const allowedChatId = process.env.TELEGRAM_CHAT_ID;
  const repoPath = process.env.REPO_PATH || '.';

  if (!botToken) {
    res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN not configured' });
    return;
  }

  try {
    const update: TelegramUpdate = req.body;

    // Ignore non-message updates
    if (!update.message?.text) {
      res.status(200).json({ ok: true });
      return;
    }

    const { chat, text } = update.message;

    // Security: Only respond to allowed chat ID
    // TEMPORARILY DISABLED FOR DEBUGGING
    // if (allowedChatId && chat.id.toString() !== allowedChatId) {
    //   console.log(`Ignored message from unauthorized chat: ${chat.id}`);
    //   res.status(200).json({ ok: true });
    //   return;
    // }

    // Handle commands
    if (text.startsWith('/')) {
      const command = text.split(' ')[0].toLowerCase();

      switch (command) {
        case '/start':
          await sendTelegramMessage(botToken, {
            chat_id: chat.id,
            text: 'IronClaude ready. Send workout logs in format:\n\n`OHP 115: 6, 5, 5 @8`\n\nOr use Claude Code for planning:\n`claude /plan-week`',
            parse_mode: 'Markdown',
          });
          break;

        case '/today':
          const githubRepo = process.env.GITHUB_REPO;
          const githubToken = process.env.GITHUB_TOKEN;

          if (!githubRepo) {
            const week = getWeekNumber();
            await sendTelegramMessage(botToken, {
              chat_id: chat.id,
              text: `Set GITHUB_REPO env var to enable /today.\n\nFor now: \`claude "what's today's workout?"\``,
              parse_mode: 'Markdown',
            });
            break;
          }

          const todayPlan = await fetchTodaysPlan(githubRepo, githubToken);

          if (todayPlan) {
            await sendTelegramMessage(botToken, {
              chat_id: chat.id,
              text: todayPlan,
              parse_mode: 'Markdown',
            });
          } else {
            await sendTelegramMessage(botToken, {
              chat_id: chat.id,
              text: `No plan found for today. Run \`claude /plan-week\` and push to GitHub.`,
              parse_mode: 'Markdown',
            });
          }
          break;

        case '/help':
          await sendTelegramMessage(botToken, {
            chat_id: chat.id,
            text: `*IronClaude Commands*\n\n` +
              `/start - Initialize bot\n` +
              `/today - Get today's workout\n` +
              `/help - Show this message\n\n` +
              `*Log Format*\n` +
              `\`Exercise Weight: reps @RPE\`\n\n` +
              `Examples:\n` +
              `\`OHP 115: 6, 5, 5 @8\`\n` +
              `\`Dips +25: 8, 7, 7\`\n` +
              `\`Handstand: 30s, 25s, 30s\`\n\n` +
              `*Claude Code Commands*\n` +
              `\`claude /plan-week\` - Generate weekly plan\n` +
              `\`claude /analyze\` - Analyze progress`,
            parse_mode: 'Markdown',
          });
          break;

        default:
          await sendTelegramMessage(botToken, {
            chat_id: chat.id,
            text: 'Unknown command. Send /help for available commands.',
          });
      }

      res.status(200).json({ ok: true });
      return;
    }

    // Try to parse as workout log
    const parsed = parseWorkoutEntry(text);

    if (parsed) {
      // Append to today's log file
      const week = getWeekNumber();
      const day = getDayKey();
      const logPath = `${repoPath}/weeks/${week}/${day}.md`;

      await handleLogMessage(logPath, text, parsed);

      await sendTelegramMessage(botToken, {
        chat_id: chat.id,
        text: `Logged: **${parsed.exercise}** ${parsed.weight ? parsed.weight + ' ' : ''}${parsed.display}`,
        parse_mode: 'Markdown',
      });
    } else {
      // Not a recognized format - just acknowledge
      // User might be sending notes or other messages
      await sendTelegramMessage(botToken, {
        chat_id: chat.id,
        text: 'Got it. (Use format `Exercise Weight: reps` for workout logs)',
        parse_mode: 'Markdown',
      });
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
