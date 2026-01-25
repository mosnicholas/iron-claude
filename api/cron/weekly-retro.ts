/**
 * Weekly Retrospective Cron Endpoint
 *
 * Schedule: Saturday at 6:00pm (configured in vercel.json as UTC)
 */

import { createApiHandler, validateCronSecret } from '../utils/handler.js';
import { runWeeklyRetro } from '../../src/cron/weekly-retro.js';

export default createApiHandler({
  allowedMethods: ['GET'],
  validateSecret: validateCronSecret,
  errorLabel: 'Weekly retro',
  handler: async () => runWeeklyRetro(),
});
