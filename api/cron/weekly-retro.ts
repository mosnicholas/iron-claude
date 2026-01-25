/**
 * Weekly Retrospective Cron Endpoint
 *
 * Schedule: Saturday at 6:00pm (configured in vercel.json as UTC)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { runWeeklyRetro } from '../../src/cron/weekly-retro.js';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Only accept GET requests (Vercel cron uses GET)
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Verify cron secret if configured
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${cronSecret}`) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  try {
    const result = await runWeeklyRetro();

    if (result.success) {
      res.status(200).json({
        ok: true,
        week: result.week,
        message: result.message,
      });
    } else {
      res.status(500).json({
        ok: false,
        error: result.error,
      });
    }
  } catch (error) {
    console.error('Weekly retro error:', error);
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
