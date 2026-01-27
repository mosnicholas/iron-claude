/**
 * Command Handlers
 *
 * Handles explicit /commands from the Telegram bot.
 */

import { CoachAgent, StreamingCallbacks } from "../coach/index.js";
import { TelegramBot, ThrottledMessageEditor } from "./telegram.js";
import { createGitHubStorage } from "../storage/github.js";
import { getCurrentWeek } from "../utils/date.js";
import {
  parseFatigueSignals,
  createInitialFatigueSignals,
  markDeloadWeek,
  dismissDeloadWarning,
  serializeFatigueSignals,
} from "../utils/fatigue-analyzer.js";

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
  fatigue: handleFatigue,
  deload: handleDeload,
  dismissfatigue: handleDismissFatigue,
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

🔋 **Recovery**
• /fatigue - Check your fatigue score and signals
• /deload - Mark this week as a deload week
• /dismissfatigue - Dismiss current fatigue warning

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
 * /fatigue - Show current fatigue score and signals
 */
async function handleFatigue(
  _agent: CoachAgent,
  _bot: TelegramBot,
  _args: string
): Promise<string> {
  const storage = createGitHubStorage();

  try {
    const fatigueYaml = await storage.readFatigueSignals();

    if (!fatigueYaml) {
      return `**Fatigue Status**

No fatigue data recorded yet. Fatigue signals will be tracked as you log workouts with RPE data.

The system monitors:
• RPE creep (same weight feeling harder)
• Missed reps (not hitting planned counts)
• Weeks since last deload

Once you have enough workout data, you'll see your fatigue score here.`;
    }

    const fatigueData = parseFatigueSignals(fatigueYaml) || createInitialFatigueSignals();

    // Build the status message
    const scoreEmoji =
      fatigueData.currentScore >= 7 ? "🔴" : fatigueData.currentScore >= 5 ? "🟡" : "🟢";

    let message = `**Fatigue Status** ${scoreEmoji}

**Score:** ${fatigueData.currentScore}/10
**Weeks since deload:** ${fatigueData.weeksSinceDeload}
`;

    // Add last deload info
    if (fatigueData.lastDeload) {
      message += `**Last deload:** ${fatigueData.lastDeload.week}\n`;
    } else {
      message += `**Last deload:** None recorded\n`;
    }

    message += `\n`;

    // Add active signals
    if (fatigueData.signals.length > 0) {
      message += `**Active Signals:**\n`;
      for (const signal of fatigueData.signals) {
        const severityIcon =
          signal.severity === "high" ? "🔴" : signal.severity === "medium" ? "🟡" : "🟢";
        message += `${severityIcon} ${signal.description}\n`;
      }
    } else {
      message += `**Active Signals:** None - you're recovering well!\n`;
    }

    // Add recommendation if score is high
    if (fatigueData.currentScore >= 7) {
      message += `\n⚠️ **Recommendation:** Consider a deload week. Use /deload to mark this week as recovery.`;
    }

    return message;
  } catch (error) {
    console.error("[Commands] Error reading fatigue signals:", error);
    return "Error reading fatigue data. Please try again.";
  }
}

/**
 * /deload - Mark the current week as a deload week
 */
async function handleDeload(_agent: CoachAgent, _bot: TelegramBot, args: string): Promise<string> {
  const storage = createGitHubStorage();
  const currentWeek = getCurrentWeek();

  try {
    // Check if already a deload week
    const isAlreadyDeload = await storage.isDeloadWeek(currentWeek);
    if (isAlreadyDeload) {
      return `Week ${currentWeek} is already marked as a deload week. Rest up! 🧘`;
    }

    // Mark the week as deload
    await storage.markDeloadWeek(currentWeek, args || "User requested");

    // Update fatigue signals
    const fatigueYaml = await storage.readFatigueSignals();
    let fatigueData = fatigueYaml
      ? parseFatigueSignals(fatigueYaml) || createInitialFatigueSignals()
      : createInitialFatigueSignals();

    fatigueData = markDeloadWeek(fatigueData, currentWeek, "manual", args || undefined);
    await storage.writeFatigueSignals(serializeFatigueSignals(fatigueData));

    return `✅ **Deload Week Marked**

Week ${currentWeek} is now marked as a deload week.

**What this means:**
• Volume reduced by 40-50%
• Focus on technique and recovery
• Extra mobility/stretching
• Fatigue score has been adjusted

Take it easy and let your body recover. You'll come back stronger! 💪`;
  } catch (error) {
    console.error("[Commands] Error marking deload:", error);
    return "Error marking deload week. Please try again.";
  }
}

/**
 * /dismissfatigue - Dismiss the current fatigue warning
 */
async function handleDismissFatigue(
  _agent: CoachAgent,
  _bot: TelegramBot,
  args: string
): Promise<string> {
  const storage = createGitHubStorage();

  try {
    const fatigueYaml = await storage.readFatigueSignals();

    if (!fatigueYaml) {
      return "No fatigue warnings to dismiss.";
    }

    let fatigueData = parseFatigueSignals(fatigueYaml) || createInitialFatigueSignals();

    if (fatigueData.currentScore < 7) {
      return "Your fatigue score is currently below the warning threshold. No warning to dismiss.";
    }

    fatigueData = dismissDeloadWarning(fatigueData, args || undefined);
    await storage.writeFatigueSignals(serializeFatigueSignals(fatigueData));

    return `✅ **Warning Dismissed**

I've noted that you want to continue training as normal despite elevated fatigue (${fatigueData.currentScore}/10).

Listen to your body and consider taking it easier if:
• Lifts start feeling unusually heavy
• Sleep quality decreases
• Motivation drops significantly

Stay safe! 💪`;
  } catch (error) {
    console.error("[Commands] Error dismissing fatigue:", error);
    return "Error dismissing warning. Please try again.";
  }
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

// Commands that benefit from loading indicator (they make API calls or use agent)
const SLOW_COMMANDS = [
  "prs",
  "plan",
  "fullplan",
  "today",
  "done",
  "demo",
  "me",
  "summary",
  "fatigue",
  "deload",
  "dismissfatigue",
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
  fatigue: "✨ _Checking fatigue signals..._",
  deload: "✨ _Marking deload week..._",
  dismissfatigue: "✨ _Dismissing warning..._",
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
