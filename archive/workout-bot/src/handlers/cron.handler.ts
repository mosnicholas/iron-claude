import type { ServiceContainer } from '../services/index.js';
import {
  buildMorningPrompt,
  buildRestDayPrompt,
  buildPlanningPrompt,
  parsePlanningResponse,
} from '../prompts/index.js';
import { getDayKey, isWeekday, getNextWeekNumber } from '../utils/date.js';
import {
  analyzeFatigue,
  buildFullContext,
  analyzeBehavioralPatterns,
} from '../utils/context-builder.js';

export async function handleMorningCron(
  services: ServiceContainer
): Promise<void> {
  const { telegram, claude, github, state, chatId } = services;

  try {
    const profile = await github.getClaudeContext();
    const weekPlan = await github.getCurrentWeekPlan();

    // Check if today is a training day
    const todayKey = getDayKey();
    const todayPlan = weekPlan?.days[todayKey];

    if (!todayPlan) {
      // Rest day
      const response = await claude.chat(buildRestDayPrompt(profile), []);
      await telegram.sendMessage({
        chat_id: chatId,
        text: response,
        parse_mode: 'Markdown',
      });
      return;
    }

    // Training day - get fatigue signals
    const recentLogs = await github.getRecentLogs(1);
    const fatigueSignals = analyzeFatigue(recentLogs);

    const response = await claude.chat(
      buildMorningPrompt(profile, todayPlan, fatigueSignals),
      []
    );

    await telegram.sendMessage({
      chat_id: chatId,
      text: response,
      parse_mode: 'Markdown',
    });

    // Update state
    state.updatePhase('awaiting-gym-time');
    state.setTodayPlan(todayPlan);
  } catch (error) {
    console.error('Morning cron error:', error);

    // Send a fallback message
    await telegram.sendMessage({
      chat_id: chatId,
      text: "Morning! Couldn't load today's plan - check the repo. Send /plan when you're ready.",
    });
  }
}

export async function handleSundayCron(
  services: ServiceContainer
): Promise<void> {
  const { telegram, claude, github, state, chatId } = services;

  try {
    // Get full context
    const context = await buildFullContext(github);

    // Get last week's plan
    const lastWeekPlan = await github.getCurrentWeekPlan();

    // Get more logs for behavioral analysis (4 weeks)
    const extendedLogs = await github.getRecentLogs(4);

    // Analyze behavioral patterns
    const behavioralPatterns = analyzeBehavioralPatterns(
      extendedLogs,
      context.profile,
      4
    );

    // Analyze fatigue signals
    const fatigueSignals = analyzeFatigue(context.recentLogs);

    // Generate new plan with behavioral data
    const response = await claude.chat(
      buildPlanningPrompt(
        context.profile,
        context.recentLogs,
        lastWeekPlan,
        context.exerciseRotation,
        behavioralPatterns,
        fatigueSignals
      ),
      [],
      { maxTokens: 4096 }
    );

    // Parse the response
    const { planMarkdown, telegramSummary } = parsePlanningResponse(response);

    // Commit new week's plan to GitHub
    const nextWeekNumber = getNextWeekNumber();
    await github.commitWeekPlan(planMarkdown, nextWeekNumber);

    // Update profile with new program week
    // (In a more robust system, we'd update CLAUDE.md here)

    // Send summary to Telegram
    await telegram.sendMessage({
      chat_id: chatId,
      text: telegramSummary,
      parse_mode: 'Markdown',
    });

    state.updatePhase('weekly-planning');
  } catch (error) {
    console.error('Sunday cron error:', error);

    await telegram.sendMessage({
      chat_id: chatId,
      text: "Couldn't generate next week's plan. I'll need to look into this.",
    });
  }
}

export async function triggerMorningCheckIn(
  services: ServiceContainer
): Promise<void> {
  await handleMorningCron(services);
}

export async function triggerWeeklyPlanning(
  services: ServiceContainer
): Promise<void> {
  await handleSundayCron(services);
}
