// Main entry point for the workout bot
// This file re-exports the main components for use in API routes

export { createServices, resetServices } from './services/index.js';
export type { ServiceContainer } from './services/index.js';

export { handleWebhook } from './handlers/webhook.handler.js';
export {
  handleMorningCron,
  handleSundayCron,
  triggerMorningCheckIn,
  triggerWeeklyPlanning,
} from './handlers/cron.handler.js';

export { getEnv, isDevelopment, isProduction } from './config/env.js';

// Re-export types for convenience
export * from './types/index.js';

// Re-export utilities
export * from './utils/index.js';

// Re-export prompts
export * from './prompts/index.js';

// Version info
export const VERSION = '1.0.0';
export const NAME = 'workout-bot';
