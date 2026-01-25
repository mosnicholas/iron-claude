/**
 * Daily Reminder Cron Endpoint
 *
 * Schedule: Daily at 6:00am (configured in vercel.json as UTC)
 */

import { createApiHandler, validateCronSecret } from '../utils/handler.js';
import { runDailyReminder } from '../../src/cron/daily-reminder.js';

export default createApiHandler({
  allowedMethods: ['GET'],
  validateSecret: validateCronSecret,
  errorLabel: 'Daily reminder',
  handler: async () => runDailyReminder(),
});
