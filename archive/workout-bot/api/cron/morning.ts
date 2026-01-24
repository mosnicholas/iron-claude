import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleMorningCron } from '../../src/handlers/index.js';
import { createServices } from '../../src/services/index.js';
import { getEnv } from '../../src/config/env.js';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Verify this is a legitimate cron request
  const env = getEnv();

  if (env.CRON_SECRET) {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  // Also accept GET for Vercel crons and POST for manual triggers
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const services = createServices();
    await handleMorningCron(services);

    res.status(200).json({
      ok: true,
      message: 'Morning check-in sent',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Morning cron error:', error);

    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
