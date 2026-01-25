/**
 * Fly.io Deployment
 *
 * Handles deployment to Fly.io with environment variable configuration.
 */

import { execSync, spawnSync } from "child_process";
import { ui } from "./ui.js";
import type { Credentials } from "./credentials.js";

/**
 * Check if Fly CLI is installed and user is logged in
 */
export function checkFlyCli(): { installed: boolean; loggedIn: boolean } {
  try {
    execSync("fly version", { stdio: "ignore" });
  } catch {
    return { installed: false, loggedIn: false };
  }

  try {
    execSync("fly auth whoami", { stdio: "ignore" });
    return { installed: true, loggedIn: true };
  } catch {
    return { installed: true, loggedIn: false };
  }
}

/**
 * Generate a random string for secrets
 */
function generateSecret(length: number = 32): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Deploy to Fly.io and configure environment variables
 */
export async function deployToFly(
  credentials: Credentials,
  repoName: string
): Promise<string | undefined> {
  ui.step(4, 5, "Deploy");

  const { installed, loggedIn } = checkFlyCli();

  if (!installed) {
    ui.error("Fly CLI not found.");
    ui.info("Install it with: curl -L https://fly.io/install.sh | sh");
    throw new Error("Fly CLI required");
  }

  if (!loggedIn) {
    ui.info("You need to log in to Fly.io first.");
    const loginResult = spawnSync("fly", ["auth", "login"], { stdio: "inherit" });
    if (loginResult.status !== 0) throw new Error("Fly login failed");
  }

  // Generate secrets
  const webhookSecret = generateSecret();
  const cronSecret = generateSecret();

  // Build the app first
  ui.info("Building application...");
  execSync("npm run build", { stdio: "inherit" });

  // App name from fly.toml
  const appName = "workout-coach";

  try {
    // Check if app exists
    execSync(`fly apps list | grep ${appName}`, { stdio: "ignore" });
    ui.info("Updating existing app...");
  } catch {
    // App doesn't exist, create it
    ui.info("Creating new Fly.io app...");
    execSync(`fly apps create ${appName}`, { stdio: "inherit" });
  }

  // Set secrets
  ui.info("Setting secrets...");
  const secrets: Record<string, string> = {
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
    secrets["GEMINI_API_KEY"] = credentials.gemini.apiKey;
  }

  // Build secrets string for fly secrets set command
  const secretsArgs = Object.entries(secrets)
    .map(([k, v]) => `${k}="${v}"`)
    .join(" ");

  try {
    execSync(`fly secrets set ${secretsArgs}`, { stdio: "ignore" });
    ui.info("Secrets configured");
  } catch (error) {
    ui.warn("Some secrets may have failed to set. Continuing with deploy...");
  }

  // Deploy
  ui.info("Deploying to Fly.io...");
  ui.blank();

  const result = spawnSync("fly", ["deploy"], { stdio: "inherit" });

  if (result.status !== 0) {
    throw new Error("Fly deployment failed");
  }

  // Get the URL
  const hostname = `${appName}.fly.dev`;
  ui.blank();
  ui.success(`Deployed: https://${hostname}`);

  // Store the webhook secret for later use
  ui.blank();
  ui.info("Webhook secret for Telegram setup:");
  ui.info(`  ${webhookSecret}`);
  ui.blank();
  ui.info("Cron secret for scheduled tasks:");
  ui.info(`  ${cronSecret}`);

  return `https://${hostname}`;
}

/**
 * Skip deployment and return instructions for manual setup
 */
export function skipDeployment(credentials: Credentials, repoName: string): void {
  ui.step(4, 5, "Deploy");
  ui.info("Skipping automatic deployment.");
  ui.blank();
  ui.info("To deploy manually, set these secrets in Fly.io:");
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
  ui.info("Then deploy with: fly deploy");
}

