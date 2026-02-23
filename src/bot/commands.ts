/**
 * Command Handlers
 *
 * Only /help and /restart remain as explicit commands.
 * All other capabilities are handled by the agent via natural language.
 */

import { CoachAgent, StreamingCallbacks } from "../coach/index.js";
import { TelegramBot } from "./telegram.js";

type CommandHandler = (
  agent: CoachAgent,
  bot: TelegramBot,
  args: string,
  callbacks?: StreamingCallbacks
) => Promise<string>;

/**
 * Available commands — only infrastructure commands, not coaching capabilities.
 */
export const COMMANDS: Record<string, CommandHandler> = {
  help: handleHelp,
  restart: handleRestart,
};

const HELP_TEXT = `**How to Use IronClaude**

Just talk to me naturally! Here's what I can help with:

📋 **Planning & Schedule**
• "What's my workout today?"
• "Show me this week's plan"
• "Swap bench for incline this week"
• "Plan my week"

🏋️ **During a Workout**
• "bench 175x5" — log exercises in any format
• "bar with 25s each side" — I do plate math
• "that felt heavy" — I'll note it for next time
• "what's next?" — I'll check the plan
• "I'm done" — wrap up the session

📊 **Progress & History**
• "What are my PRs?"
• "How's my bench progressing?"
• "Give me a summary of my last few weeks"

🎥 **Exercise Info**
• "Show me how to do a face pull"
• "What muscles does this machine work?"

⏰ **Reminders**
• "Remind me at 5pm for the workout"

💬 **General**
• Ask me anything about training, form, recovery
• Tell me how you're feeling — I'll adjust the plan

No slash commands needed — just talk to me!`;

/**
 * /help - Show help text
 */
async function handleHelp(_agent: CoachAgent, _bot: TelegramBot, _args: string): Promise<string> {
  return HELP_TEXT;
}

/**
 * /restart - Restart the server
 */
async function handleRestart(_agent: CoachAgent, bot: TelegramBot, _args: string): Promise<string> {
  await bot.sendPlainMessage("Restarting server... Be back in a moment!");

  // Small delay to ensure the message is sent before exit
  setTimeout(() => {
    console.log("[Commands] Server restart requested via /restart command");
    process.exit(0);
  }, 500);

  return "";
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
    // Unknown commands pass through to the agent as natural language
    return "";
  }

  // All remaining commands are fast (help, restart) - return directly
  return handler(agent, bot, args);
}
