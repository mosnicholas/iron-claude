#!/usr/bin/env tsx
/**
 * Unified Setup Command
 *
 * A beautiful, unified setup wizard that combines structured CLI prompts
 * with AI-powered onboarding. One command to go from zero to deployed bot.
 *
 * Usage: npm run setup
 */

import { confirm } from '@inquirer/prompts';
import { ui } from './lib/ui.js';
import { collectCredentials } from './lib/credentials.js';
import { createGitHubRepo, verifyGitHubToken } from './lib/github.js';
import { runOnboardingConversation } from './lib/onboarding.js';
import { deployToVercel, checkVercelCli, skipDeployment } from './lib/deploy.js';
import { setWebhook } from './lib/webhook.js';

async function main() {
  ui.header('IronClaude Setup');

  console.log('  Let\'s get you set up. This will:');
  console.log('  • Collect your API credentials');
  console.log('  • Create a private GitHub repo for your data');
  console.log('  • Set up your fitness profile (AI conversation)');
  console.log('  • Deploy to Vercel');
  console.log('  • Connect your Telegram bot');
  ui.blank();

  try {
    // ──────────────────────────────────────────────────────────────────────
    // Step 1: Collect and verify credentials (saved to .env as we go)
    // ──────────────────────────────────────────────────────────────────────
    const credentials = await collectCredentials();

    // ──────────────────────────────────────────────────────────────────────
    // Step 2: Create GitHub repo
    // ──────────────────────────────────────────────────────────────────────
    ui.step(2, 5, 'GitHub');

    const repoSpinner = ui.spinner('Creating fitness-data repository...');
    let repoName: string;
    try {
      repoName = await createGitHubRepo(credentials.github.token);
      repoSpinner.success({ text: `Repository created: ${repoName}` });
    } catch (error) {
      if (error instanceof Error && error.message.includes('already exists')) {
        repoSpinner.success({ text: 'Repository already exists, using existing' });
        // Get username and assume repo name
        const username = await verifyGitHubToken(credentials.github.token);
        repoName = `${username}/fitness-data`;
      } else {
        repoSpinner.error({ text: 'Failed to create repository' });
        throw error;
      }
    }

    // ──────────────────────────────────────────────────────────────────────
    // Step 3: Onboarding conversation
    // ──────────────────────────────────────────────────────────────────────
    // Set env vars so CoachAgent can connect
    process.env.ANTHROPIC_API_KEY = credentials.anthropic.apiKey;
    process.env.GITHUB_TOKEN = credentials.github.token;
    process.env.DATA_REPO = repoName;
    process.env.TIMEZONE = credentials.timezone;

    await runOnboardingConversation();

    // ──────────────────────────────────────────────────────────────────────
    // Step 4: Deploy to Vercel
    // ──────────────────────────────────────────────────────────────────────
    const { installed } = checkVercelCli();

    let deployUrl: string | undefined;

    if (installed) {
      const shouldDeploy = await confirm({
        message: 'Deploy to Vercel now?',
        default: true,
      });

      if (shouldDeploy) {
        deployUrl = await deployToVercel(credentials, repoName);
      } else {
        skipDeployment(credentials, repoName);
      }
    } else {
      ui.step(4, 5, 'Deploy');
      ui.warn('Vercel CLI not found. Install with: npm i -g vercel');
      skipDeployment(credentials, repoName);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Step 5: Set webhook
    // ──────────────────────────────────────────────────────────────────────
    if (deployUrl) {
      ui.step(5, 5, 'Connect Bot');

      const webhookSpinner = ui.spinner('Setting Telegram webhook...');
      try {
        const webhookUrl = `${deployUrl}/api/webhook`;
        await setWebhook(credentials.telegram.botToken, webhookUrl);
        webhookSpinner.success({ text: 'Webhook configured' });
      } catch (error) {
        webhookSpinner.error({ text: 'Failed to set webhook' });
        throw error;
      }
    } else {
      ui.step(5, 5, 'Connect Bot');
      ui.info('Skipped - deploy first, then run:');
      ui.info('  npm run set-webhook <your-deploy-url>/api/webhook');
    }

    // ──────────────────────────────────────────────────────────────────────
    // Done!
    // ──────────────────────────────────────────────────────────────────────
    ui.divider();

    if (deployUrl) {
      console.log(`  🎉 ${ui.bold('Setup complete!')}`);
      ui.blank();
      console.log('  Your bot is live! Send a message to your bot on Telegram.');
      ui.blank();
      ui.info(`Deployment: ${deployUrl}`);
      ui.info(`Data repo:  https://github.com/${repoName}`);
    } else {
      console.log(`  ✅ ${ui.bold('Setup partially complete!')}`);
      ui.blank();
      console.log('  Next steps:');
      console.log('  1. Deploy your app (vercel --prod)');
      console.log('  2. Set the webhook (npm run set-webhook <url>/api/webhook)');
      console.log('  3. Message your bot on Telegram!');
      ui.blank();
      ui.info(`Data repo: https://github.com/${repoName}`);
    }

    ui.blank();
  } catch (error) {
    ui.blank();
    ui.error(error instanceof Error ? error.message : 'Setup failed');
    ui.blank();
    ui.info('If you need help, check the README or open an issue.');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
