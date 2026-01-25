/**
 * Vercel Deployment
 *
 * Handles deployment to Vercel with environment variable configuration.
 */

import { execSync, spawnSync } from 'child_process';
import { ui } from './ui.js';
import type { Credentials } from './credentials.js';

/**
 * Check if Vercel CLI is installed and user is logged in
 */
export function checkVercelCli(): { installed: boolean; loggedIn: boolean } {
  try {
    execSync('vercel --version', { stdio: 'ignore' });
  } catch {
    return { installed: false, loggedIn: false };
  }

  try {
    // Check if logged in by running whoami
    execSync('vercel whoami', { stdio: 'ignore' });
    return { installed: true, loggedIn: true };
  } catch {
    return { installed: true, loggedIn: false };
  }
}

/**
 * Generate a random string for secrets
 */
function generateSecret(length: number = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Deploy to Vercel and configure environment variables
 */
export async function deployToVercel(
  credentials: Credentials,
  repoName: string
): Promise<string> {
  ui.step(4, 5, 'Deploy');

  // Check Vercel CLI
  const { installed, loggedIn } = checkVercelCli();

  if (!installed) {
    ui.error('Vercel CLI not found.');
    ui.info('Install it with: npm i -g vercel');
    throw new Error('Vercel CLI required');
  }

  if (!loggedIn) {
    ui.info('You need to log in to Vercel first.');
    ui.info('Run: vercel login');
    ui.blank();

    // Try to run vercel login interactively
    const loginResult = spawnSync('vercel', ['login'], {
      stdio: 'inherit',
      shell: true,
    });

    if (loginResult.status !== 0) {
      throw new Error('Vercel login failed');
    }
  }

  // Generate secrets
  const webhookSecret = generateSecret();
  const cronSecret = generateSecret();

  // Build environment variables
  const envVars: Record<string, string> = {
    TELEGRAM_BOT_TOKEN: credentials.telegram.botToken,
    TELEGRAM_CHAT_ID: credentials.telegram.chatId,
    TELEGRAM_WEBHOOK_SECRET: webhookSecret,
    ANTHROPIC_API_KEY: credentials.anthropic.apiKey,
    GITHUB_TOKEN: credentials.github.token,
    DATA_REPO: repoName,
    TIMEZONE: credentials.timezone,
    CRON_SECRET: cronSecret,
  };

  if (credentials.gemini?.apiKey) {
    envVars.GEMINI_API_KEY = credentials.gemini.apiKey;
  }

  // Link project if not already linked
  const linkSpinner = ui.spinner('Linking project to Vercel...');
  try {
    execSync('vercel link --yes', { stdio: 'ignore' });
    linkSpinner.success({ text: 'Project linked' });
  } catch {
    linkSpinner.error({ text: 'Failed to link project' });
    throw new Error('Failed to link Vercel project');
  }

  // Set environment variables
  const envSpinner = ui.spinner('Configuring environment variables...');
  try {
    for (const [key, value] of Object.entries(envVars)) {
      // Remove existing env var if it exists (ignore errors)
      try {
        execSync(`vercel env rm ${key} production --yes`, { stdio: 'ignore' });
      } catch {
        // Ignore - var might not exist
      }

      // Add new env var using echo to pipe the value
      execSync(`echo "${value}" | vercel env add ${key} production`, {
        stdio: 'ignore',
        shell: '/bin/bash',
      });
    }
    envSpinner.success({ text: 'Environment configured' });
  } catch (error) {
    envSpinner.error({ text: 'Failed to configure environment' });
    throw error;
  }

  // Deploy
  const deploySpinner = ui.spinner('Deploying to Vercel (this may take a minute)...');
  try {
    const deployOutput = execSync('vercel --prod --yes', {
      encoding: 'utf-8',
      timeout: 300000, // 5 minute timeout
    });

    // Extract URL from output
    const urlMatch = deployOutput.match(/https:\/\/[^\s]+\.vercel\.app/);
    const deployUrl = urlMatch?.[0];

    if (!deployUrl) {
      // Try to get the URL from vercel inspect
      const inspectOutput = execSync('vercel ls --prod', { encoding: 'utf-8' });
      const inspectMatch = inspectOutput.match(/https:\/\/[^\s]+\.vercel\.app/);
      if (inspectMatch) {
        deploySpinner.success({ text: `Deployed: ${inspectMatch[0]}` });
        return inspectMatch[0];
      }
      throw new Error('Could not determine deployment URL');
    }

    deploySpinner.success({ text: `Deployed: ${deployUrl}` });
    return deployUrl;
  } catch (error) {
    deploySpinner.error({ text: 'Deployment failed' });
    throw error;
  }
}

/**
 * Skip deployment and return instructions for manual setup
 */
export function skipDeployment(credentials: Credentials, repoName: string): void {
  ui.step(4, 5, 'Deploy');
  ui.info('Skipping automatic deployment.');
  ui.blank();
  ui.info('To deploy manually, add these environment variables to your host:');
  ui.blank();

  const envVars = [
    `TELEGRAM_BOT_TOKEN=${credentials.telegram.botToken}`,
    `TELEGRAM_CHAT_ID=${credentials.telegram.chatId}`,
    `TELEGRAM_WEBHOOK_SECRET=<generate-a-secret>`,
    `ANTHROPIC_API_KEY=${credentials.anthropic.apiKey}`,
    `GITHUB_TOKEN=${credentials.github.token}`,
    `DATA_REPO=${repoName}`,
    `TIMEZONE=${credentials.timezone}`,
    `CRON_SECRET=<generate-a-secret>`,
  ];

  if (credentials.gemini?.apiKey) {
    envVars.push(`GEMINI_API_KEY=${credentials.gemini.apiKey}`);
  }

  for (const envVar of envVars) {
    console.log(`    ${envVar}`);
  }

  ui.blank();
  ui.info('Then deploy with: vercel --prod');
}
