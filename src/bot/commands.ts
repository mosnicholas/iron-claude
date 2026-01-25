/**
 * Command Handlers
 *
 * Handles explicit /commands from the Telegram bot.
 */

import { CoachAgent } from '../coach/index.js';
import { TelegramBot } from './telegram.js';
import { createGitHubStorage } from '../storage/github.js';
import { getCurrentWeek } from '../utils/date.js';

export type CommandHandler = (
  agent: CoachAgent,
  bot: TelegramBot,
  args: string
) => Promise<string>;

/**
 * Available commands and their handlers
 */
export const COMMANDS: Record<string, CommandHandler> = {
  start: handleStart,
  help: handleHelp,
  today: handleToday,
  plan: handlePlan,
  done: handleDone,
  tired: handleTired,
  skip: handleSkip,
  prs: handlePRs,
  demo: handleDemo,
  traveling: handleTraveling,
};

/**
 * /start - Initial greeting
 */
async function handleStart(
  _agent: CoachAgent,
  _bot: TelegramBot,
  _args: string
): Promise<string> {
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
async function handleHelp(
  _agent: CoachAgent,
  _bot: TelegramBot,
  _args: string
): Promise<string> {
  return `**Available Commands**

📋 **Planning**
• /plan - Show this week's full plan
• /today - Show today's workout

🏋️ **During Workout**
• /done - Finish current workout session
• /tired - Flag low energy, get modified options
• /skip [what] - Skip today or specific exercise

📊 **Progress**
• /prs - Show personal records and trends
• /demo [exercise] - Find video demonstration

✈️ **Life**
• /traveling [dates] [context] - Log upcoming travel

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
  _args: string
): Promise<string> {
  const response = await agent.chat(
    "Show me today's workout plan. Read the current week's plan and tell me what's scheduled for today. " +
    "If today is a rest day, let me know. If there's no plan, suggest what I should do."
  );
  return response.message;
}

/**
 * /plan - Show this week's plan
 */
async function handlePlan(
  agent: CoachAgent,
  _bot: TelegramBot,
  _args: string
): Promise<string> {
  const week = getCurrentWeek();

  const response = await agent.chat(
    `Show me the full weekly plan for ${week}. Read plans/${week}.md and give me a summary of each day.`
  );
  return response.message;
}

/**
 * /done - Complete current workout
 */
async function handleDone(
  agent: CoachAgent,
  _bot: TelegramBot,
  _args: string
): Promise<string> {
  const response = await agent.chat(
    "I'm done with my workout. Please:\n" +
    "1. Check if there's an in-progress workout branch\n" +
    "2. Summarize what I did\n" +
    "3. Note any PRs\n" +
    "4. Ask for my energy level if I haven't mentioned it\n" +
    "5. Finalize the workout file and merge the branch"
  );
  return response.message;
}

/**
 * /tired - Flag low energy
 */
async function handleTired(
  agent: CoachAgent,
  _bot: TelegramBot,
  _args: string
): Promise<string> {
  const response = await agent.chat(
    "I'm feeling tired/low energy today. Based on today's planned workout, suggest some modified options:\n" +
    "1. A lighter version of the planned workout\n" +
    "2. A shorter alternative\n" +
    "3. A complete swap if appropriate\n" +
    "4. Full rest if that's the best call\n\n" +
    "Be supportive and remember that a modified workout beats skipping entirely."
  );
  return response.message;
}

/**
 * /skip - Skip workout or exercise
 */
async function handleSkip(
  agent: CoachAgent,
  _bot: TelegramBot,
  args: string
): Promise<string> {
  if (!args) {
    const response = await agent.chat(
      "I want to skip today's workout. Acknowledge this without guilt-tripping, " +
      "and suggest alternatives if appropriate (light mobility, walk, etc.). " +
      "Record this in the learnings if it's becoming a pattern."
    );
    return response.message;
  }

  const response = await agent.chat(
    `I want to skip ${args} today. Note this, suggest an alternative exercise if appropriate, ` +
    "and update my workout plan accordingly."
  );
  return response.message;
}

/**
 * /prs - Show personal records
 */
async function handlePRs(
  agent: CoachAgent,
  _bot: TelegramBot,
  _args: string
): Promise<string> {
  const response = await agent.chat(
    "Show me my current personal records. Read prs.yaml and display:\n" +
    "1. Current PRs for main lifts (bench, squat, deadlift, OHP, pull-ups)\n" +
    "2. Recent progress (any PRs in the last few weeks)\n" +
    "3. Estimated 1RMs\n" +
    "Format nicely for Telegram."
  );
  return response.message;
}

/**
 * /demo - Find exercise demonstration
 */
async function handleDemo(
  agent: CoachAgent,
  _bot: TelegramBot,
  args: string
): Promise<string> {
  if (!args) {
    return "Which exercise do you want a demo for? Example: /demo face pull";
  }

  const response = await agent.chat(
    `Find a good video demonstration for the exercise: ${args}. ` +
    "Search for quality instructional content and provide helpful cues."
  );
  return response.message;
}

/**
 * /traveling - Log upcoming travel
 */
async function handleTraveling(
  agent: CoachAgent,
  _bot: TelegramBot,
  args: string
): Promise<string> {
  if (!args) {
    return "When are you traveling and any context? Example: /traveling Jan 25-28 Austin, hotel gym only";
  }

  const response = await agent.chat(
    `I'm traveling: ${args}. Please:\n` +
    "1. Note this in learnings\n" +
    "2. Adjust my expectations for training during this period\n" +
    "3. Suggest travel-friendly workout options if appropriate\n" +
    "4. Consider this when generating next week's plan if it overlaps"
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
  return handler(agent, bot, args);
}
