/**
 * Credential Collection
 *
 * Interactive prompts to collect all required API credentials.
 */

import { input, password, select, confirm } from '@inquirer/prompts';
import { ui } from './ui.js';

export interface Credentials {
  telegram: {
    botToken: string;
    chatId: string;
  };
  anthropic: {
    apiKey: string;
  };
  github: {
    token: string;
  };
  gemini?: {
    apiKey: string;
  };
  timezone: string;
}

/**
 * Collect all required credentials from user
 */
export async function collectCredentials(): Promise<Credentials> {
  ui.step(1, 5, 'Credentials');

  // --- Telegram ---
  ui.info('First, let\'s connect your Telegram bot.');
  ui.info('Create one at https://t.me/botfather');
  ui.blank();

  const botToken = await password({
    message: 'Telegram Bot Token:',
    validate: (v) => {
      if (!v) return 'Token is required';
      if (!v.includes(':')) return 'Invalid token format (should contain ":")';
      return true;
    },
  });

  ui.blank();
  ui.info('To get your Chat ID:');
  ui.info('1. Send any message to your bot on Telegram');
  ui.info('2. Visit the URL below and look for "chat":{"id":XXXXX}');
  ui.info(`   https://api.telegram.org/bot${botToken}/getUpdates`);
  ui.blank();

  const chatId = await input({
    message: 'Your Chat ID:',
    validate: (v) => {
      if (!v) return 'Chat ID is required';
      if (!/^-?\d+$/.test(v)) return 'Chat ID must be a number';
      return true;
    },
  });

  // --- Anthropic ---
  ui.blank();
  ui.info('Now let\'s connect to Claude.');
  ui.info('Get your API key at https://console.anthropic.com');
  ui.blank();

  const anthropicKey = await password({
    message: 'Anthropic API Key:',
    validate: (v) => {
      if (!v) return 'API key is required';
      if (!v.startsWith('sk-ant-')) return 'Should start with "sk-ant-"';
      return true;
    },
  });

  // --- GitHub ---
  ui.blank();
  ui.info('Your fitness data will be stored in a private GitHub repo.');
  ui.info('Create a fine-grained token at https://github.com/settings/tokens?type=beta');
  ui.info('Required permissions: Contents (read/write), Metadata (read)');
  ui.blank();

  const githubToken = await password({
    message: 'GitHub Token:',
    validate: (v) => {
      if (!v) return 'Token is required';
      if (v.length < 20) return 'Token seems too short';
      return true;
    },
  });

  // --- Voice Transcription (optional) ---
  ui.blank();
  const wantVoice = await confirm({
    message: 'Enable voice messages? (requires Gemini API key)',
    default: false,
  });

  let geminiKey: string | undefined;

  if (wantVoice) {
    ui.info('Get your API key at https://aistudio.google.com/apikey');
    ui.info('Gemini has a generous free tier for voice transcription.');
    geminiKey = await password({ message: 'Gemini API Key:' });
  }

  // --- Timezone ---
  ui.blank();
  const timezone = await select({
    message: 'Your timezone:',
    choices: [
      { value: 'America/New_York', name: 'Eastern (NYC, Miami)' },
      { value: 'America/Chicago', name: 'Central (Chicago, Houston)' },
      { value: 'America/Denver', name: 'Mountain (Denver, Phoenix)' },
      { value: 'America/Los_Angeles', name: 'Pacific (LA, Seattle)' },
      { value: 'Europe/London', name: 'London' },
      { value: 'Europe/Paris', name: 'Paris / Berlin / Amsterdam' },
      { value: 'Europe/Moscow', name: 'Moscow' },
      { value: 'Asia/Dubai', name: 'Dubai' },
      { value: 'Asia/Singapore', name: 'Singapore' },
      { value: 'Asia/Tokyo', name: 'Tokyo' },
      { value: 'Australia/Sydney', name: 'Sydney' },
      { value: 'other', name: 'Other...' },
    ],
  });

  let finalTimezone = timezone;
  if (timezone === 'other') {
    finalTimezone = await input({
      message: 'Enter IANA timezone (e.g., Australia/Melbourne):',
      validate: (v) => (v ? true : 'Timezone is required'),
    });
  }

  return {
    telegram: { botToken, chatId },
    anthropic: { apiKey: anthropicKey },
    github: { token: githubToken },
    gemini: geminiKey ? { apiKey: geminiKey } : undefined,
    timezone: finalTimezone,
  };
}
