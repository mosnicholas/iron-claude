/**
 * Command Handlers
 *
 * Handles explicit /commands from the Telegram bot.
 */

import { CoachAgent, StreamingCallbacks } from "../coach/index.js";
import { TelegramBot, ThrottledMessageEditor } from "./telegram.js";
import { createGitHubStorage } from "../storage/github.js";
import { getCurrentWeek, getDateInfoTZAware } from "../utils/date.js";

/**
 * Split message on --- markers for multi-message responses
 * Trims whitespace and filters empty chunks
 */
function splitOnMessageBreaks(text: string): string[] {
  return text
    .split(/\n---\n/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);
}

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
  today: handleToday,
  plan: handlePlan,
  fullplan: handlePlanFull,
  done: handleDone,
  prs: handlePRs,
  demo: handleDemo,
  me: handleMe,
  summary: handleSummary,
  funfacts: handleFunFacts,
  restart: handleRestart,
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

Or just text me what you're doing — "bench 175x5" and I'll log it. Let's get after it! 💪`;
}

const HELP_TEXT = `**Available Commands**

📋 **Planning**
• /plan - Show this week's plan (summary)
• /fullplan - Show full plan with all exercises
• /today - Show today's workout

🏋️ **During Workout**
• /done - Finish current workout session

📊 **Progress**
• /prs - Show personal records and trends
• /me - Quick facts about your profile
• /summary - Your fitness journey overview
• /demo [exercise] - Find video demonstration
• /funfacts - Get fun fitness facts

💬 **Or just chat naturally:**
• "bench 175x5" - Log an exercise
• "that felt heavy" - Add a note
• "what's next?" - Get next exercise

Questions? Just ask!`;

/**
 * /help - Show available commands
 */
async function handleHelp(_agent: CoachAgent, _bot: TelegramBot, _args: string): Promise<string> {
  return HELP_TEXT;
}

/**
 * /today - Show today's planned workout
 * Note: The weekly plan is pre-loaded in the system context
 */
async function handleToday(
  agent: CoachAgent,
  _bot: TelegramBot,
  _args: string,
  callbacks?: StreamingCallbacks
): Promise<string> {
  const dateInfo = getDateInfoTZAware();

  console.log(
    `[/today] Day: ${dateInfo.dayOfWeek}, Date: ${dateInfo.date}, Week: ${dateInfo.isoWeek}`
  );

  const response = await agent.chat(
    `Show me today's workout. Use the weekly plan already in your context to find what's scheduled for ${dateInfo.dayOfWeek}.\n\n` +
      "Give me TWO sections:\n\n" +
      "**PART 1 — High-Level Overview:**\n" +
      "- Workout type, focus, and estimated duration\n" +
      "- Main lifts with sets/reps/weights highlighted\n" +
      "- Any skill work or special focus areas\n" +
      "- Key coaching notes from the plan\n\n" +
      "**PART 2 — Full Exercise-by-Exercise Breakdown:**\n" +
      "List EVERY exercise in order, including:\n" +
      "- **Warm-up**: Specify what to do (e.g. cardio, band work, ramp-up sets). If the plan doesn't specify a warm-up, include a sensible default warm-up for the day's main lifts.\n" +
      "- **Main lifts**: Exercise name, sets x reps @ weight, rest periods\n" +
      "- **Accessories**: Exercise name, sets x reps @ weight, any superset notes\n" +
      "- **Skill work**: Exercise name, sets x reps/duration\n" +
      "- **Cool-down**: If specified in the plan\n\n" +
      "This should be my step-by-step guide — I should be able to walk into the gym and follow it exercise by exercise.\n\n" +
      "If today is a rest day, let me know. If there's no plan, suggest what I should do.",
    callbacks
  );
  return response.message;
}

/**
 * /plan - Show this week's plan
 * Note: The weekly plan is pre-loaded in the system context
 */
async function handlePlan(
  agent: CoachAgent,
  _bot: TelegramBot,
  _args: string,
  callbacks?: StreamingCallbacks
): Promise<string> {
  const week = getCurrentWeek();

  const response = await agent.chat(
    `Give me a summary of the weekly plan for ${week}. The plan is already in your context - summarize each day briefly.`,
    callbacks
  );
  return response.message;
}

/**
 * /fullplan - Show this week's plan with all exercise details
 * Note: The weekly plan is pre-loaded in the system context
 */
async function handlePlanFull(
  agent: CoachAgent,
  _bot: TelegramBot,
  _args: string,
  callbacks?: StreamingCallbacks
): Promise<string> {
  const week = getCurrentWeek();

  const response = await agent.chat(
    `Show me the complete weekly plan for ${week}. The plan is already in your context - display the FULL plan with every exercise, sets, reps, and weights for each day. Do not summarize - show all details.`,
    callbacks
  );
  return response.message;
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
 * /prs - Show personal records
 * Note: PRs are pre-loaded in the system context
 */
async function handlePRs(
  agent: CoachAgent,
  _bot: TelegramBot,
  _args: string,
  callbacks?: StreamingCallbacks
): Promise<string> {
  const response = await agent.chat(
    "Show me my current personal records. The PRs are already in your context. Display:\n" +
      "1. Current PRs for main lifts (bench, squat, deadlift, OHP, pull-ups)\n" +
      "2. Recent progress (any PRs in the last few weeks)\n" +
      "3. Estimated 1RMs",
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
      "4. My equipment setup",
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
 * /funfacts - Share interesting fitness facts personalized to the user
 */
async function handleFunFacts(
  agent: CoachAgent,
  _bot: TelegramBot,
  _args: string,
  callbacks?: StreamingCallbacks
): Promise<string> {
  const response = await agent.chat(
    "Share some fun and interesting fitness facts! First read profile.md and prs.yaml to understand my training, " +
      "then give me 2-3 fun facts that are relevant to my workout style. Include:\n" +
      "1. A surprising science fact about strength training or muscle growth\n" +
      "2. A fun fact related to one of my main lifts or exercises\n" +
      "3. An interesting historical or cultural fact about fitness\n\n" +
      "Make it engaging and tie it back to my training when possible. Keep it concise for Telegram.",
    callbacks
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
 * Handle an unknown command
 */
function handleUnknownCommand(command: string): string {
  return `I don't recognize the command /${command}. Here's what I can do:\n\n${HELP_TEXT}`;
}

/**
 * Check if a command exists
 */
export function commandExists(command: string): boolean {
  return command in COMMANDS;
}

// Commands that benefit from loading indicator (they call agent.chat which is slow)
const SLOW_COMMANDS = [
  "prs",
  "plan",
  "fullplan",
  "today",
  "done",
  "demo",
  "me",
  "summary",
  "funfacts",
];

const LOADING_MESSAGES: Record<string, string> = {
  prs: "✨ _Looking up your PRs..._",
  plan: "✨ _Loading your plan..._",
  fullplan: "✨ _Loading full plan details..._",
  today: "✨ _Checking today's workout..._",
  done: "✨ _Wrapping up your workout..._",
  demo: "✨ _Finding a demo..._",
  me: "✨ _Pulling up your profile..._",
  summary: "✨ _Reviewing your journey..._",
  funfacts: "✨ _Finding fun facts..._",
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
