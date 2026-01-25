#!/usr/bin/env tsx
/**
 * Set Webhook Script
 *
 * Configures the Telegram webhook URL.
 */

const TELEGRAM_API_BASE = 'https://api.telegram.org';

async function main() {
  const webhookUrl = process.argv[2];

  if (!webhookUrl) {
    console.log('Usage: pnpm set-webhook <webhook-url>');
    console.log('');
    console.log('Example: pnpm set-webhook https://your-app.vercel.app/api/webhook');
    process.exit(1);
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error('Error: TELEGRAM_BOT_TOKEN environment variable is required');
    console.log('');
    console.log('Set it in your .env.local file or export it:');
    console.log('  export TELEGRAM_BOT_TOKEN=your_token_here');
    process.exit(1);
  }

  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  console.log('Setting webhook...');
  console.log(`URL: ${webhookUrl}`);
  if (webhookSecret) {
    console.log('Secret: configured');
  }

  const body: Record<string, unknown> = {
    url: webhookUrl,
    allowed_updates: ['message'],
    drop_pending_updates: true,
  };

  if (webhookSecret) {
    body.secret_token = webhookSecret;
  }

  const response = await fetch(
    `${TELEGRAM_API_BASE}/bot${botToken}/setWebhook`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  const data = await response.json();

  if (data.ok) {
    console.log('');
    console.log('✅ Webhook configured successfully!');
    console.log('');
    console.log('Your bot is now listening for messages at:');
    console.log(`  ${webhookUrl}`);
    console.log('');
    console.log('Try sending a message to your bot on Telegram!');
  } else {
    console.error('');
    console.error('❌ Failed to set webhook:');
    console.error(data.description);
    process.exit(1);
  }
}

// Also provide a helper to delete webhook
async function deleteWebhook() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error('Error: TELEGRAM_BOT_TOKEN environment variable is required');
    process.exit(1);
  }

  console.log('Deleting webhook...');

  const response = await fetch(
    `${TELEGRAM_API_BASE}/bot${botToken}/deleteWebhook`,
    { method: 'POST' }
  );

  const data = await response.json();

  if (data.ok) {
    console.log('✅ Webhook deleted');
  } else {
    console.error('❌ Failed to delete webhook:', data.description);
  }
}

// Check if --delete flag was passed
if (process.argv.includes('--delete')) {
  deleteWebhook().catch(console.error);
} else {
  main().catch(console.error);
}
