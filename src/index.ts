/**
 * IronClaude
 *
 * A Claude-powered personal fitness coach over Telegram (and soon web).
 * Data lives in Postgres; identity in Supabase Auth.
 *
 * @module ironclaude
 */

// Core agent
export { CoachAgentV2, createCoachAgentV2 } from "./coach-v2/index.js";
export type { CoachV2Config, CoachV2Response } from "./coach-v2/index.js";

// Storage layer
export { getStorage, DbStorage } from "./storage/db.js";
export type { Storage } from "./storage/storage.js";
export type * from "./storage/types.js";

// Bot
export { TelegramBot, createTelegramBot, createTelegramBotForChat } from "./bot/telegram.js";
export { executeCommand, commandExists, COMMANDS } from "./bot/commands.js";
export { transcribeVoice, isVoiceTranscriptionAvailable } from "./bot/voice.js";

// Cron
export { runDailyReminder } from "./cron/daily-reminder.js";
export { runWeeklyPlan, forceRegeneratePlan } from "./cron/weekly-plan.js";
export { runDailyCompaction } from "./cron/daily-compaction.js";

// Auth
export {
  resolveUserByChannel,
  findOrCreateUserByChannel,
  findOrCreateUserByPhone,
} from "./auth/identity.js";

// Utilities
export * from "./utils/date.js";
export * from "./utils/pr-calculator.js";
export * from "./utils/rpe-analyzer.js";
export * from "./utils/pr-celebrations.js";
export * from "./utils/weight-config.js";
