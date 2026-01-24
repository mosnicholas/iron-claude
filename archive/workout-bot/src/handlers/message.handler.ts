import type { ServiceContainer } from '../services/index.js';
import { formatDayPlan, formatWeekPlanMarkdown } from '../utils/markdown.js';
import { getDayKey, getDayName } from '../utils/date.js';
import { SYSTEM_PROMPT } from '../prompts/index.js';

export async function handleCommand(
  command: string,
  chatId: number,
  services: ServiceContainer
): Promise<void> {
  const cmd = command.toLowerCase().split(' ')[0];

  switch (cmd) {
    case '/start':
      await handleStartCommand(chatId, services);
      break;

    case '/plan':
      await handlePlanCommand(chatId, services);
      break;

    case '/week':
      await handleWeekCommand(chatId, services);
      break;

    case '/done':
      await handleDoneCommand(chatId, services);
      break;

    case '/skip':
      await handleSkipCommand(chatId, services);
      break;

    case '/status':
      await handleStatusCommand(chatId, services);
      break;

    case '/help':
      await handleHelpCommand(chatId, services);
      break;

    default:
      await services.telegram.sendMessage({
        chat_id: chatId,
        text: `Unknown command: ${cmd}\n\nUse /help to see available commands.`,
      });
  }
}

async function handleStartCommand(
  chatId: number,
  services: ServiceContainer
): Promise<void> {
  const { telegram, github } = services;

  try {
    const profile = await github.getClaudeContext();

    await telegram.sendMessage({
      chat_id: chatId,
      text: `Hey ${profile.name}! Bot is connected and ready.\n\n` +
        `Goals: ${profile.goals.primary.join(', ')}\n` +
        `Program week: ${profile.currentStatus.programWeek}\n\n` +
        `I'll send morning check-ins on training days. You can also:\n` +
        `- Send /plan to see today's workout\n` +
        `- Send /week to see the weekly plan\n` +
        `- Just start logging exercises anytime`,
      parse_mode: 'Markdown',
    });
  } catch (error) {
    await telegram.sendMessage({
      chat_id: chatId,
      text: 'Bot is connected! Note: Could not load profile from CLAUDE.md - make sure the GitHub repo is configured correctly.',
    });
  }
}

async function handlePlanCommand(
  chatId: number,
  services: ServiceContainer
): Promise<void> {
  const { telegram, github, state } = services;

  try {
    const weekPlan = await github.getCurrentWeekPlan();

    if (!weekPlan) {
      await telegram.sendMessage({
        chat_id: chatId,
        text: "No plan found for this week. The Sunday planning cron will generate one, or you can ask me to create one.",
      });
      return;
    }

    const todayKey = getDayKey();
    const todayPlan = weekPlan.days[todayKey];

    if (!todayPlan) {
      await telegram.sendMessage({
        chat_id: chatId,
        text: `Today (${getDayName()}) is a rest day. Enjoy the recovery!`,
      });
      return;
    }

    state.setTodayPlan(todayPlan);

    await telegram.sendMessage({
      chat_id: chatId,
      text: `**Today's Plan (${getDayName()})**\n\n${formatDayPlan(todayPlan)}`,
      parse_mode: 'Markdown',
    });
  } catch (error) {
    console.error('Error fetching plan:', error);
    await telegram.sendMessage({
      chat_id: chatId,
      text: 'Error loading the plan. Check the GitHub connection.',
    });
  }
}

async function handleWeekCommand(
  chatId: number,
  services: ServiceContainer
): Promise<void> {
  const { telegram, github } = services;

  try {
    const weekPlan = await github.getCurrentWeekPlan();

    if (!weekPlan) {
      await telegram.sendMessage({
        chat_id: chatId,
        text: "No plan found for this week yet.",
      });
      return;
    }

    // Send a condensed version for Telegram
    let summary = `**Week ${weekPlan.weekNumber}**\n\n`;

    if (weekPlan.focus.length > 0) {
      summary += `Focus: ${weekPlan.focus.join(', ')}\n\n`;
    }

    const dayOrder = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

    for (const day of dayOrder) {
      const plan = weekPlan.days[day];
      if (plan) {
        const exerciseCount = plan.skills.length + plan.strength.length;
        summary += `**${day.charAt(0).toUpperCase() + day.slice(1)}**: ${plan.dayType} (${exerciseCount} exercises)\n`;
      } else {
        summary += `**${day.charAt(0).toUpperCase() + day.slice(1)}**: Rest\n`;
      }
    }

    await telegram.sendMessage({
      chat_id: chatId,
      text: summary,
      parse_mode: 'Markdown',
    });
  } catch (error) {
    console.error('Error fetching week plan:', error);
    await telegram.sendMessage({
      chat_id: chatId,
      text: 'Error loading the week plan.',
    });
  }
}

async function handleDoneCommand(
  chatId: number,
  services: ServiceContainer
): Promise<void> {
  const { state, telegram } = services;

  if (state.getPhase() !== 'during-workout') {
    await telegram.sendMessage({
      chat_id: chatId,
      text: "No workout in progress. Start logging exercises to begin a workout.",
    });
    return;
  }

  // Import dynamically to avoid circular dependency
  const { finalizeWorkout } = await import('./workout-log.handler.js');
  await finalizeWorkout(chatId, services);
}

async function handleSkipCommand(
  chatId: number,
  services: ServiceContainer
): Promise<void> {
  const { state, telegram, claude, github } = services;

  const profile = await github.getClaudeContext();
  const response = await claude.chat(
    SYSTEM_PROMPT,
    [
      {
        role: 'user',
        content: `Nick is skipping today's workout. Acknowledge briefly (1-2 lines). No guilt trip.`,
      },
    ]
  );

  await telegram.sendMessage({ chat_id: chatId, text: response });
  state.updatePhase('idle');
  state.reset();
}

async function handleStatusCommand(
  chatId: number,
  services: ServiceContainer
): Promise<void> {
  const { state, telegram, github } = services;

  try {
    const profile = await github.getClaudeContext();
    const currentState = state.getState();

    await telegram.sendMessage({
      chat_id: chatId,
      text: `**Status**\n\n` +
        `Phase: ${currentState.phase}\n` +
        `Program week: ${profile.currentStatus.programWeek}\n` +
        `Today's plan loaded: ${currentState.todayPlan ? 'Yes' : 'No'}\n` +
        `Exercises logged: ${(currentState.currentWorkoutLog.strength?.length || 0) + (currentState.currentWorkoutLog.skills?.length || 0)}`,
      parse_mode: 'Markdown',
    });
  } catch (error) {
    await telegram.sendMessage({
      chat_id: chatId,
      text: `Phase: ${services.state.getPhase()}\nError loading full status.`,
    });
  }
}

async function handleHelpCommand(
  chatId: number,
  services: ServiceContainer
): Promise<void> {
  const { telegram } = services;

  await telegram.sendMessage({
    chat_id: chatId,
    text: `**Available Commands**\n\n` +
      `/start - Initialize and confirm connection\n` +
      `/plan - Show today's workout plan\n` +
      `/week - Show this week's plan summary\n` +
      `/done - Finish current workout\n` +
      `/skip - Skip today's workout\n` +
      `/status - Show current state\n` +
      `/help - Show this help message\n\n` +
      `**Logging Format**\n` +
      `\`OHP 115: 6, 5, 5 @8\` - Standard lift\n` +
      `\`Dips +25: 8, 7\` - Bodyweight + added\n` +
      `\`Hollow: 35s, 30s\` - Timed holds`,
    parse_mode: 'Markdown',
  });
}
