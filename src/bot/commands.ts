/**
 * Command Handlers
 *
 * Handles explicit /commands from the Telegram bot.
 */

import { CoachAgent, StreamingCallbacks } from "../coach/index.js";
import { TelegramBot, ThrottledMessageEditor } from "./telegram.js";
import { createGitHubStorage } from "../storage/github.js";
import { getCurrentWeek, getDateInfoTZAware, formatISOWeek } from "../utils/date.js";

/**
 * Finalize a workout by merging the branch to main and cleaning up.
 * This is called after the /done command to always finalize.
 *
 * Returns true if a workout was finalized, false if no in-progress workout was found.
 */
async function finalizeWorkout(): Promise<boolean> {
  const storage = createGitHubStorage();

  // Find the in-progress workout branch
  const branch = await storage.findInProgressWorkout();

  if (!branch) {
    console.log("[finalizeWorkout] No in-progress workout found");
    return false;
  }

  console.log(`[finalizeWorkout] Found workout branch: ${branch}`);

  // Extract date from branch name: workout/YYYY-MM-DD-type -> YYYY-MM-DD
  const branchParts = branch.split("/")[1]?.split("-");
  if (!branchParts || branchParts.length < 3) {
    console.error(`[finalizeWorkout] Invalid branch name format: ${branch}`);
    return false;
  }

  const dateStr = `${branchParts[0]}-${branchParts[1]}-${branchParts[2]}`;
  // Create a Date from the dateStr (add T12:00:00 to avoid timezone issues)
  const workoutDate = new Date(dateStr + "T12:00:00");
  const week = formatISOWeek(workoutDate);

  console.log(`[finalizeWorkout] Completing workout: date=${dateStr}, week=${week}`);

  try {
    await storage.completeWorkout(branch, dateStr, week);
    console.log(`[finalizeWorkout] Successfully merged ${branch} to main and cleaned up`);
    return true;
  } catch (error) {
    console.error(`[finalizeWorkout] Error completing workout:`, error);
    return false;
  }
}

/**
 * Check if the agent has marked the workout as complete, and if so, finalize it.
 * This is called after natural language messages to detect when the agent
 * has processed a workout completion signal.
 *
 * The agent sets "status: completed" in the workout file frontmatter when done.
 */
export async function finalizeWorkoutIfComplete(): Promise<boolean> {
  const storage = createGitHubStorage();

  // Find the in-progress workout branch
  const branch = await storage.findInProgressWorkout();

  if (!branch) {
    // No workout in progress, nothing to finalize
    return false;
  }

  // Check if the agent has marked this workout as complete
  const isComplete = await storage.isWorkoutMarkedComplete(branch);

  if (!isComplete) {
    // Workout still in progress, don't finalize yet
    return false;
  }

  console.log(`[finalizeWorkoutIfComplete] Workout marked complete, finalizing...`);
  return finalizeWorkout();
}

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
  const dateInfo = getDateInfoTZAware();

  console.log(
    `[/today] Day: ${dateInfo.dayOfWeek}, Date: ${dateInfo.date}, Week: ${dateInfo.isoWeek}`
  );

  const response = await agent.chat(
    `Show me today's workout plan. Today is ${dateInfo.dayOfWeek}. ` +
      "Read the current week's plan and tell me what's scheduled for this day. " +
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
 * /fullplan - Show this week's plan with all exercise details
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
      "5. Update the workout file with the summary and mark it complete",
    callbacks
  );

  // After the agent has processed the done command, finalize by merging to main
  const finalized = await finalizeWorkout();
  if (finalized) {
    console.log("[handleDone] Workout finalized and merged to main");
  }

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
