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
export type {
  TelegramUpdate,
  TelegramMessage,
  TelegramVoice,
  TelegramPhotoSize,
} from "./storage/types.js";

// Bot
export { TelegramBot, createTelegramBot, createTelegramBotForChat } from "./bot/telegram.js";
export { executeCommand, commandExists, COMMANDS } from "./bot/commands.js";
export { transcribeVoice, isVoiceTranscriptionAvailable } from "./bot/voice.js";

// Cron — the per-user processors are wired to pg-boss in src/jobs/.
// Exporting just the manual-replan entry point that the bot still calls.
export { forceRegeneratePlan } from "./cron/weekly-plan.js";

// Jobs
export { getBoss } from "./jobs/queue.js";
export { registerJobHandlers, registerJobSchedules } from "./jobs/handlers.js";

// Auth
export {
  resolveUserByChannel,
  findOrCreateUserByChannel,
  findOrCreateUserByPhone,
} from "./auth/identity.js";

// Utilities
export * from "./utils/date.js";
export { calculate1RM } from "./utils/pr-calculator.js";
export * from "./utils/weight-config.js";
