/**
 * Command Handlers
 *
 * Only /help, /restart, /reauth remain as explicit commands.
 * All other capabilities are handled by the agent via natural language.
 */

import { CoachAgentV2 } from "../coach-v2/index.js";
import { TelegramBot } from "./telegram.js";
import { getIntegration } from "../integrations/registry.js";

type CommandHandler = (agent: CoachAgentV2, bot: TelegramBot, args: string) => Promise<string>;

/**
 * Available commands — only infrastructure commands, not coaching capabilities.
 */
export const COMMANDS: Record<string, CommandHandler> = {
  help: handleHelp,
  restart: handleRestart,
  reauth: handleReauth,
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

🛠️ **Diagnostics**
• \`/debug why didn't the AM reminder fire yesterday?\` — read-only system inspection

💬 **General**
• Ask me anything about training, form, recovery
• Tell me how you're feeling — I'll adjust the plan`;

async function handleHelp(_agent: CoachAgentV2, _bot: TelegramBot, _args: string): Promise<string> {
  return HELP_TEXT;
}

/**
 * /reauth - Generate a Whoop OAuth re-authorization link.
 */
async function handleReauth(
  _agent: CoachAgentV2,
  _bot: TelegramBot,
  args: string
): Promise<string> {
  const device = args.trim().toLowerCase() || "whoop";
  const integration = getIntegration(device);

  if (!integration) {
    return `Unknown integration: ${device}`;
  }

  if (!integration.isConfigured()) {
    return `${device} is not configured. Set client credentials first.`;
  }

  const appUrl = process.env.APP_URL || "https://workout-coach.fly.dev";
  const redirectUri = `${appUrl}/api/integrations/${device}/callback`;
  const authUrl = integration.getAuthUrl(redirectUri);

  return `Click the link below to re-authorize ${integration.name}:\n\n${authUrl}`;
}

async function handleRestart(
  _agent: CoachAgentV2,
  bot: TelegramBot,
  _args: string
): Promise<string> {
  await bot.sendPlainMessage("Restarting server... Be back in a moment!");

  // Small delay to ensure the message is sent before exit
  setTimeout(() => {
    console.log("[Commands] Server restart requested via /restart command");
    process.exit(0);
  }, 500);

  return "";
}

export function commandExists(command: string): boolean {
  return command in COMMANDS;
}

export async function executeCommand(
  command: string,
  args: string,
  agent: CoachAgentV2,
  bot: TelegramBot
): Promise<string> {
  const handler = COMMANDS[command];
  if (!handler) {
    return "";
  }
  return handler(agent, bot, args);
}
