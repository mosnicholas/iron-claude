import type { TelegramUpdate } from '../types/index.js';
import type { ServiceContainer } from '../services/index.js';
import { handleCommand } from './message.handler.js';
import { handleWorkoutMessage, finalizeWorkout } from './workout-log.handler.js';
import {
  buildMorningPrompt,
  buildWorkoutStartPrompt,
  buildPostWorkoutPrompt,
  SYSTEM_PROMPT,
} from '../prompts/index.js';
import {
  parseTimeString,
  isDoneSignal,
  isSkipSignal,
  parseExerciseLog,
} from '../utils/index.js';
import { analyzeFatigue, identifyPRs } from '../utils/context-builder.js';

export async function handleWebhook(
  update: TelegramUpdate,
  services: ServiceContainer
): Promise<void> {
  const message = update.message;

  if (!message?.text) {
    return;
  }

  const { state, telegram, claude, github, chatId } = services;
  const text = message.text.trim();

  // Verify this is from the authorized user
  if (message.chat.id !== chatId) {
    console.log(`Unauthorized chat ID: ${message.chat.id}`);
    return;
  }

  // Handle commands
  if (text.startsWith('/')) {
    await handleCommand(text, chatId, services);
    return;
  }

  const currentPhase = state.getPhase();

  // Route based on conversation phase
  switch (currentPhase) {
    case 'awaiting-gym-time':
      await handleGymTimeResponse(text, chatId, services);
      break;

    case 'during-workout':
      await handleWorkoutMessage(text, chatId, services);
      break;

    case 'post-workout':
      await handlePostWorkoutResponse(text, chatId, services);
      break;

    default:
      await handleGeneralMessage(text, chatId, services);
  }
}

async function handleGymTimeResponse(
  text: string,
  chatId: number,
  services: ServiceContainer
): Promise<void> {
  const { state, telegram, claude, github } = services;

  // Check for skip signal
  if (isSkipSignal(text)) {
    const profile = await github.getClaudeContext();
    const response = await claude.chat(
      SYSTEM_PROMPT,
      [
        {
          role: 'user',
          content: `Nick says he's skipping today's workout. Respond briefly (1-2 lines). No guilt. Just acknowledge and say we'll adjust.`,
        },
      ]
    );

    await telegram.sendMessage({ chat_id: chatId, text: response });
    state.updatePhase('idle');
    return;
  }

  // Try to parse time
  const parsedTime = parseTimeString(text);

  if (parsedTime) {
    state.scheduleWorkout(text);
    state.updatePhase('pre-workout');

    const profile = await github.getClaudeContext();
    const todayPlan = state.getTodayPlan();

    if (todayPlan) {
      const response = await claude.chat(
        buildWorkoutStartPrompt(profile, todayPlan),
        []
      );
      await telegram.sendMessage({ chat_id: chatId, text: response });
    }

    return;
  }

  // Couldn't parse - use AI to handle
  const profile = await github.getClaudeContext();
  const response = await claude.chat(
    SYSTEM_PROMPT,
    [
      {
        role: 'user',
        content: `Nick responded with: "${text}". This might be a gym time or something else. If it seems like a time, acknowledge it and say you'll check in when he arrives. If it's unclear, ask briefly what time he's heading to the gym. Keep response to 1-2 lines.`,
      },
    ]
  );

  await telegram.sendMessage({ chat_id: chatId, text: response });
}

async function handlePostWorkoutResponse(
  text: string,
  chatId: number,
  services: ServiceContainer
): Promise<void> {
  const { state, telegram, claude } = services;

  // Simple acknowledgment of any follow-up
  const response = await claude.chat(
    SYSTEM_PROMPT,
    [
      {
        role: 'user',
        content: `Nick says: "${text}" (this is after the workout summary was sent). Respond briefly if needed, otherwise just acknowledge. Keep to 1 line.`,
      },
    ]
  );

  await telegram.sendMessage({ chat_id: chatId, text: response });
  state.updatePhase('idle');
}

async function handleGeneralMessage(
  text: string,
  chatId: number,
  services: ServiceContainer
): Promise<void> {
  const { state, telegram, claude, github } = services;

  // Check if this looks like exercise logging (user might be starting workout)
  const parsed = parseExerciseLog(text);
  if (parsed) {
    // User is logging exercises - transition to during-workout
    const todayPlan = state.getTodayPlan();

    if (!todayPlan) {
      // Try to get today's plan
      const weekPlan = await github.getCurrentWeekPlan();
      // For now, create a basic plan structure
      state.setTodayPlan({
        dayType: 'full-body',
        skills: [],
        strength: [],
      });
    }

    state.updatePhase('during-workout');
    state.initWorkoutLog(state.getTodayPlan()?.dayType || 'full-body');
    await handleWorkoutMessage(text, chatId, services);
    return;
  }

  // Check for "done" even in idle state
  if (isDoneSignal(text)) {
    await telegram.sendMessage({
      chat_id: chatId,
      text: "No workout in progress. If you want to log a workout, just start sending your exercises.",
    });
    return;
  }

  // General conversation - use Claude to respond
  const profile = await github.getClaudeContext();
  const response = await claude.chat(
    SYSTEM_PROMPT,
    [
      {
        role: 'user',
        content: `Context: Nick sent this message outside of a structured workout conversation.

Nick's message: "${text}"

User profile:
- Name: ${profile.name}
- Goals: ${profile.goals.primary.join(', ')}
- Experience: ${profile.experience}

Respond appropriately. If he's asking about his plan, give a brief overview. If he's asking a training question, answer it. If it's casual, respond casually. Keep responses short (2-3 lines max).`,
      },
    ]
  );

  await telegram.sendMessage({ chat_id: chatId, text: response });
}
