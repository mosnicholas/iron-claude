import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleWebhook } from '../src/handlers/index.js';
import { createServices } from '../src/services/index.js';
import type { TelegramUpdate } from '../src/types/index.js';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Only accept POST requests
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const update = req.body as TelegramUpdate;

    // Validate the update has required fields
    if (!update || typeof update.update_id !== 'number') {
      res.status(400).json({ error: 'Invalid update format' });
      return;
    }

    const services = createServices();
    await handleWebhook(update, services);

    // Always return 200 to Telegram to prevent retries
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);

    // Still return 200 to prevent Telegram from retrying
    // Log the error for debugging
    res.status(200).json({
      ok: true,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
