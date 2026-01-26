/**
 * Command Handlers
 *
 * Handles explicit /commands from the Telegram bot.
 */

import { CoachAgent, StreamingCallbacks } from "../coach/index.js";
import { TelegramBot, ThrottledMessageEditor } from "./telegram.js";
import { createGitHubStorage } from "../storage/github.js";
import { getCurrentWeek } from "../utils/date.js";

export type CommandHandler = (
  agent: CoachAgent,
  bot: TelegramBot,
  args: string,
  callbacks?: StreamingCallbacks
) => Promise<string>;

/**
 * Available commands and their handlers
 */
export const COMMANDS: Record<string, CommandHandler> = {
  start: handleStart,
  help: handleHelp,
  today: handleToday,
  plan: handlePlan,
  "plan-full": handlePlanFull,
  done: handleDone,
  prs: handlePRs,
  demo: handleDemo,
  me: handleMe,
  summary: handleSummary,
};

/**
 * /start - Initial greeting
 */
async function handleStart(_agent: CoachAgent, _bot: TelegramBot, _args: string): Promise<string> {
  const storage = createGitHubStorage();
  const profile = await storage.readProfile();

  if (!profile) {
    return `Hey! I'm your fitness coach. Let's get started with a quick setup.

I'll ask you a few questions to understand your goals, schedule, and preferences. This should take about 10 minutes.

Ready? What should I call you?`;
  }

  return `Welcome back! I'm here to help you stay on track.

Quick commands:
• /today - See today's workout
• /plan - View this week's plan
• /done - Finish your current workout
• /prs - Check your personal records

Or just text me what you're doing — "bench 175x5" and I'll log it.

Let's get after it! 💪`;
}

/**
 * /help - Show available commands
 */
async function handleHelp(_agent: CoachAgent, _bot: TelegramBot, _args: string): Promise<string> {
  return `**Available Commands**

📋 **Planning**
• /plan - Show this week's plan (summary)
• /plan-full - Show full plan with all exercises
• /today - Show today's workout

🏋️ **During Workout**
• /done - Finish current workout session

📊 **Progress**
• /prs - Show personal records and trends
• /me - Quick facts about your profile
• /summary - Your fitness journey overview
• /demo [exercise] - Find video demonstration

💬 **Or just chat naturally:**
• "bench 175x5" - Log an exercise
• "that felt heavy" - Add a note
• "what's next?" - Get next exercise

Questions? Just ask!`;
}

/**
 * /today - Show today's planned workout
 */
async function handleToday(
  agent: CoachAgent,
  _bot: TelegramBot,
  _args: string,
  callbacks?: StreamingCallbacks
): Promise<string> {
  const response = await agent.chat(
    "Show me today's workout plan. Read the current week's plan and tell me what's scheduled for today. " +
      "If today is a rest day, let me know. If there's no plan, suggest what I should do.",
    callbacks
  );
  return response.message;
}

/**
 * /plan - Show this week's plan
 */
async function handlePlan(
  agent: CoachAgent,
  _bot: TelegramBot,
  _args: string,
  callbacks?: StreamingCallbacks
): Promise<string> {
  const week = getCurrentWeek();

  const response = await agent.chat(
    `Show me the full weekly plan for ${week}. Read plans/${week}.md and give me a summary of each day.`,
    callbacks
  );
  return response.message;
}

/**
 * /plan-full - Show this week's plan with all exercise details
 */
async function handlePlanFull(
  agent: CoachAgent,
  _bot: TelegramBot,
  _args: string,
  callbacks?: StreamingCallbacks
): Promise<string> {
  const week = getCurrentWeek();

  const response = await agent.chat(
    `Show me the complete weekly plan for ${week}. Read plans/${week}.md and display the FULL plan with every single exercise, sets, reps, and weights for each day. Do not summarize - show all details exactly as written in the plan file.`,
    callbacks
  );
  return response.message;
}

/**
 * /done - Complete current workout
 */
async function handleDone(
  agent: CoachAgent,
  _bot: TelegramBot,
  _args: string,
  callbacks?: StreamingCallbacks
): Promise<string> {
  const response = await agent.chat(
    "I'm done with my workout. Please:\n" +
      "1. Check if there's an in-progress workout branch\n" +
      "2. Summarize what I did\n" +
      "3. Note any PRs\n" +
      "4. Ask for my energy level if I haven't mentioned it\n" +
      "5. Finalize the workout file and merge the branch",
    callbacks
  );
  return response.message;
}

/**
 * /prs - Show personal records
 */
async function handlePRs(
  agent: CoachAgent,
  _bot: TelegramBot,
  _args: string,
  callbacks?: StreamingCallbacks
): Promise<string> {
  const response = await agent.chat(
    "Show me my current personal records. Read prs.yaml and display:\n" +
      "1. Current PRs for main lifts (bench, squat, deadlift, OHP, pull-ups)\n" +
      "2. Recent progress (any PRs in the last few weeks)\n" +
      "3. Estimated 1RMs",
    callbacks
  );
  return response.message;
}

/**
 * /demo - Find exercise demonstration
 */
async function handleDemo(
  agent: CoachAgent,
  _bot: TelegramBot,
  args: string,
  callbacks?: StreamingCallbacks
): Promise<string> {
  if (!args) {
    return "Which exercise do you want a demo for? Example: /demo face pull";
  }

  const response = await agent.chat(
    `Find a good video demonstration for the exercise: ${args}. ` +
      "Search for quality instructional content and provide helpful cues.",
    callbacks
  );
  return response.message;
}

/**
 * /me - Factual profile summary
 */
async function handleMe(
  agent: CoachAgent,
  _bot: TelegramBot,
  _args: string,
  callbacks?: StreamingCallbacks
): Promise<string> {
  const response = await agent.chat(
    "Give me a quick summary about myself. Read profile.md and prs.yaml, then tell me:\n" +
      "1. My basic info (name, training schedule, goals)\n" +
      "2. My current PRs for main lifts\n" +
      "3. Any limitations or preferences you know about\n" +
      "4. My gym/equipment setup",
    callbacks
  );
  return response.message;
}

/**
 * /summary - AI-driven journey overview
 */
async function handleSummary(
  agent: CoachAgent,
  _bot: TelegramBot,
  _args: string,
  callbacks?: StreamingCallbacks
): Promise<string> {
  const response = await agent.chat(
    "Give me a broad view of where I am in my fitness journey. Read profile.md, learnings.md, prs.yaml, " +
      "recent workouts, and recent retrospectives. Then tell me:\n" +
      "1. Where I am relative to my stated goals\n" +
      "2. How my training has been going lately (trends, consistency)\n" +
      "3. What's working well and what could improve\n" +
      "4. Compare what I said I'd do vs what I actually did",
    callbacks
  );
  return response.message;
}

/**
 * Handle an unknown command
 */
export function handleUnknownCommand(command: string): string {
  return `I don't recognize the command /${command}. Try /help to see available commands.`;
}

/**
 * Check if a command exists
 */
export function commandExists(command: string): boolean {
  return command in COMMANDS;
}

// Commands that benefit from loading indicator (they call agent.chat which is slow)
const SLOW_COMMANDS = ["prs", "plan", "plan-full", "today", "done", "demo", "me", "summary"];

const LOADING_MESSAGES: Record<string, string> = {
  prs: "✨ _Looking up your PRs..._",
  plan: "✨ _Loading your plan..._",
  "plan-full": "✨ _Loading full plan details..._",
  today: "✨ _Checking today's workout..._",
  done: "✨ _Wrapping up your workout..._",
  demo: "✨ _Finding a demo..._",
  me: "✨ _Pulling up your profile..._",
  summary: "✨ _Reviewing your journey..._",
};

/**
 * Execute a command
 */
export async function executeCommand(
  command: string,
  args: string,
  agent: CoachAgent,
  bot: TelegramBot
): Promise<string> {
  const handler = COMMANDS[command];
  if (!handler) {
    return handleUnknownCommand(command);
  }

  // For slow commands, send a status message with real-time progress updates
  if (SLOW_COMMANDS.includes(command)) {
    console.log(`[Commands] Starting slow command: /${command}`);
    const messageId = await bot.sendMessage(
      LOADING_MESSAGES[command] || "✨ _Working on it..._",
      "MarkdownV2"
    );

    if (!messageId) {
      console.log(`[Commands] No messageId, using fallback`);
      // Fallback if we couldn't get the message ID
      try {
        const result = await handler(agent, bot, args);
        await bot.sendMessageSafe(result);
        return "";
      } catch (error) {
        console.error(`[Commands] Fallback error:`, error);
        await bot.sendPlainMessage("Something went wrong. Please try again.");
        return "";
      }
    }

    const editor = new ThrottledMessageEditor(bot, messageId);

    try {
      console.log(`[Commands] Calling handler for /${command}`);
      const result = await handler(agent, bot, args, {
        onStatus: (status) => {
          console.log(`[Commands] Status update: ${status}`);
          editor.update(status);
        },
      });
      console.log(`[Commands] Handler completed, finalizing`);
      await editor.finalize(result);
      return ""; // Empty string signals webhook not to send another message
    } catch (error) {
      console.error(`[Commands] Handler error:`, error);
      await editor.finalize("Something went wrong. Please try again.");
      return "";
    }
  }

  // Fast commands (start, help) - return directly
  return handler(agent, bot, args);
}
