/**
 * Command Handlers
 *
 * Handles explicit /commands from the Telegram bot.
 * Most interactions should happen via natural language — commands are for
 * specialized workflows that need explicit triggers.
 */

import { CoachAgent, StreamingCallbacks } from "../coach/index.js";
import { TelegramBot, ThrottledMessageEditor, splitOnMessageBreaks } from "./telegram.js";
import { getDateInfoTZAware } from "../utils/date.js";

type CommandHandler = (
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
  done: handleDone,
  demo: handleDemo,
  restart: handleRestart,
};

/**
 * /start - Initial greeting
 */
async function handleStart(_agent: CoachAgent, _bot: TelegramBot, _args: string): Promise<string> {
  return `Welcome! I'm your fitness coach. 💪

Just talk to me naturally — here are some things you can say:

• **"bench 175x5"** — I'll log it
• **"what's my workout today?"** — I'll pull up today's plan
• **"show me my PRs"** — current personal records
• **"I'm done"** — wrap up the session
• **"how's my training going?"** — progress overview

Type /help for more ideas, or just start chatting!`;
}

const HELP_TEXT = `**How to Use IronClaude**

Just talk to me naturally! Here's what I can help with:

📋 **Planning & Schedule**
• "What's my workout today?"
• "Show me this week's plan"
• "Move today's workout to tomorrow"
• "Plan my week"

🏋️ **During a Workout**
• "bench 175x5" — log exercises in any format
• "that felt heavy" — I'll add a note
• "what's next?" — I'll check the plan
• "I'm done" or /done — wrap up the session

📊 **Progress & History**
• "What are my PRs?"
• "How's my training going?"
• "Give me a summary of my last few weeks"

⏰ **Reminders**
• "Remind me at 5pm for the workout"

🎥 **Demos**
• /demo face pull — find a video demo

💬 **General**
• Ask me anything about training, form, recovery
• Tell me how you're feeling — I'll adjust the plan`;

/**
 * /help - Show help text
 */
async function handleHelp(_agent: CoachAgent, _bot: TelegramBot, _args: string): Promise<string> {
  return HELP_TEXT;
}

/**
 * /done - Complete current workout
 * Note: Today's workout and PRs are pre-loaded in the system context
 */
async function handleDone(
  agent: CoachAgent,
  _bot: TelegramBot,
  _args: string,
  callbacks?: StreamingCallbacks
): Promise<string> {
  const dateInfo = getDateInfoTZAware();

  const response = await agent.chat(
    `I'm done with my workout. Today is ${dateInfo.date}. ` +
      "Today's workout log is already in your context. Please:\n" +
      "1. Summarize what I did\n" +
      "2. Check for any new PRs against prs.yaml (also in your context) and update if needed\n" +
      "3. Ask for my energy level if I haven't mentioned it\n" +
      "4. Update the workout file with the summary and set status: completed\n" +
      "5. Commit and push the changes to main\n" +
      "6. Check the weekly plan for today's cool-down section. If there is a cool-down, " +
      "add it at the END of your response after a line containing only `---`. " +
      "Format it as a clear cool-down routine the athlete can follow (exercises, duration, etc). " +
      "Start that section with a header like 'Cool-Down'. " +
      "If there is no cool-down in the plan, don't add the --- or any cool-down section.",
    callbacks
  );

  return response.message;
}

/**
 * /demo - Find exercise demonstration
 * Uses web search to find quality video demonstrations
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
      "Use web search to find quality instructional content from reputable sources " +
      "(like Jeff Nippard, AthleanX, Renaissance Periodization, etc). " +
      "Provide the video link and key technique cues.",
    callbacks,
    { additionalTools: ["WebSearch"] }
  );
  return response.message;
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

// Commands that benefit from loading indicator (they call agent.chat which is slow)
const SLOW_COMMANDS = ["done", "demo"];

const LOADING_MESSAGES: Record<string, string> = {
  done: "✨ _Wrapping up your workout..._",
  demo: "✨ _Finding a demo..._",
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
    return `I don't recognize /${command}. Type /help to see what I can do, or just ask me naturally!`;
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

      // Split on --- markers for multi-message responses
      const chunks = splitOnMessageBreaks(result);
      await editor.finalize(chunks[0]);

      // Send remaining chunks as separate messages
      for (let i = 1; i < chunks.length; i++) {
        await new Promise((resolve) => setTimeout(resolve, 200)); // Small delay
        await bot.sendMessageSafe(chunks[i]);
      }

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
