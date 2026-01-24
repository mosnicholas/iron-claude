import type { ServiceContainer } from '../services/index.js';
import type { ExerciseLog, WorkoutLog } from '../types/index.js';
import { parseExerciseLog, isDoneSignal } from '../utils/parser.js';
import { buildWorkoutPrompt, buildPostWorkoutPrompt } from '../prompts/index.js';
import { identifyPRs } from '../utils/context-builder.js';

export async function handleWorkoutMessage(
  text: string,
  chatId: number,
  services: ServiceContainer
): Promise<void> {
  const { state, telegram, claude, github } = services;

  // Check for "done" signal
  if (isDoneSignal(text)) {
    await finalizeWorkout(chatId, services);
    return;
  }

  // Try to parse as exercise log
  const parsed = parseExerciseLog(text);

  if (parsed) {
    state.addToWorkoutLog(parsed);
    state.addToBuffer(text);
  }

  // Get AI response
  const todayPlan = state.getTodayPlan();
  const currentLog = state.getCurrentWorkoutLog();
  const loggedSoFar = currentLog.strength || [];
  const profile = await github.getClaudeContext();

  if (!todayPlan) {
    // No plan loaded, just acknowledge
    await telegram.sendMessage({
      chat_id: chatId,
      text: parsed
        ? `Got it: **${parsed.name}**. Keep going or send "done" when finished.`
        : `Logged. Send more exercises or "done" when finished.`,
      parse_mode: 'Markdown',
    });
    return;
  }

  const response = await claude.chat(
    buildWorkoutPrompt(profile, todayPlan, loggedSoFar, text),
    [{ role: 'user', content: text }]
  );

  await telegram.sendMessage({
    chat_id: chatId,
    text: response,
    parse_mode: 'Markdown',
  });
}

export async function finalizeWorkout(
  chatId: number,
  services: ServiceContainer
): Promise<void> {
  const { state, telegram, claude, github } = services;

  const completedLog = state.getCompletedWorkoutLog();

  if (!completedLog) {
    await telegram.sendMessage({
      chat_id: chatId,
      text: "No exercises logged. Start by sending exercises like: `OHP 115: 6, 5, 5`",
      parse_mode: 'Markdown',
    });
    state.updatePhase('idle');
    return;
  }

  const todayPlan = state.getTodayPlan();
  const profile = await github.getClaudeContext();

  // Try to commit to GitHub
  try {
    await github.commitWorkoutLog(completedLog);
  } catch (error) {
    console.error('Failed to commit workout log:', error);
    // Continue anyway - we'll still give feedback
  }

  // Get recent logs for PR detection
  let prs: string[] = [];
  try {
    const recentLogs = await github.getRecentLogs(4);
    prs = identifyPRs(completedLog, recentLogs);
  } catch {
    // Ignore PR detection errors
  }

  // Generate post-workout analysis
  if (todayPlan) {
    const response = await claude.chat(
      buildPostWorkoutPrompt(profile, completedLog, todayPlan, prs),
      []
    );

    await telegram.sendMessage({
      chat_id: chatId,
      text: response,
      parse_mode: 'Markdown',
    });
  } else {
    // No plan, give generic feedback
    const totalSets =
      completedLog.skills.reduce((sum, ex) => sum + ex.sets.length, 0) +
      completedLog.strength.reduce((sum, ex) => sum + ex.sets.length, 0);

    await telegram.sendMessage({
      chat_id: chatId,
      text: `Workout logged! ${totalSets} total sets recorded.${prs.length > 0 ? ` PRs today: ${prs.join(', ')}` : ''}`,
      parse_mode: 'Markdown',
    });
  }

  state.updatePhase('post-workout');

  // Reset after a brief delay to allow for follow-up
  setTimeout(() => {
    if (state.getPhase() === 'post-workout') {
      state.updatePhase('idle');
      state.reset();
    }
  }, 60000); // Reset after 1 minute
}

export async function handleWorkoutMetadata(
  text: string,
  chatId: number,
  services: ServiceContainer
): Promise<void> {
  const { state, telegram } = services;

  // Try to parse energy/sleep from text
  const energyMatch = text.match(/energy[:\s]*(\d+)/i);
  const sleepMatch = text.match(/sleep[:\s]*(\d+(?:\.\d+)?)/i);

  if (energyMatch || sleepMatch) {
    const energy = energyMatch ? parseInt(energyMatch[1], 10) : 7;
    const sleep = sleepMatch ? parseFloat(sleepMatch[1]) : 7;

    state.setWorkoutMetadata(energy, sleep);

    await telegram.sendMessage({
      chat_id: chatId,
      text: `Got it - Energy: ${energy}/10, Sleep: ${sleep}h`,
    });
  }
}
