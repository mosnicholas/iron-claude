/**
 * Fitness Coach
 *
 * A Claude-powered personal fitness coach that lives in Telegram,
 * stores everything as markdown in Git, and learns your patterns over time.
 *
 * @module fitness-coach
 */

// Core exports
export { CoachAgent, createCoachAgent, processMessage } from './coach/index.js';
export type { CoachConfig, CoachResponse } from './coach/index.js';

// Storage
export { GitHubStorage, createGitHubStorage } from './storage/github.js';
export type * from './storage/types.js';

// Bot
export { TelegramBot, createTelegramBot } from './bot/telegram.js';
export { executeCommand, commandExists, COMMANDS } from './bot/commands.js';
export { transcribeVoice, isVoiceTranscriptionAvailable } from './bot/voice.js';

// Cron
export { runDailyReminder } from './cron/daily-reminder.js';
export { runWeeklyRetro } from './cron/weekly-retro.js';
export { runWeeklyPlan, forceRegeneratePlan } from './cron/weekly-plan.js';

// Utilities
export * from './utils/date.js';
export * from './utils/pr-calculator.js';
