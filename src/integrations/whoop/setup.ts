/**
 * Whoop Integration Setup
 *
 * Interactive CLI wizard for setting up Whoop integration.
 * Can be run standalone or as part of the main setup.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { input, password, confirm } from "@inquirer/prompts";

// ─────────────────────────────────────────────────────────────────────────────
// UI Helpers (inline to avoid circular deps with scripts/)
// ─────────────────────────────────────────────────────────────────────────────

import pc from "picocolors";
import { createSpinner } from "nanospinner";

const ui = {
  header: (text: string): void => {
    console.log();
    console.log(pc.bold(pc.cyan(`  🏋️  ${text}`)));
    console.log(pc.dim("  " + "━".repeat(50)));
    console.log();
  },
  success: (text: string): void => console.log(pc.green(`  ✓ ${text}`)),
  error: (text: string): void => console.log(pc.red(`  ✗ ${text}`)),
  info: (text: string): void => console.log(pc.dim(`  ${text}`)),
  warn: (text: string): void => console.log(pc.yellow(`  ⚠ ${text}`)),
  spinner: (text: string) => createSpinner(text).start(),
  bold: (text: string): string => pc.bold(text),
  blank: (): void => console.log(),
  divider: (): void => {
    console.log();
    console.log(pc.dim("━".repeat(54)));
    console.log();
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Environment File Helpers
// ─────────────────────────────────────────────────────────────────────────────

const ENV_FILE = ".env";

function loadEnvFile(): Map<string, string> {
  const env = new Map<string, string>();
  if (!existsSync(ENV_FILE)) return env;

  const content = readFileSync(ENV_FILE, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex);
    let value = trimmed.slice(eqIndex + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env.set(key, value);
  }
  return env;
}

function saveToEnv(key: string, value: string): void {
  const env = loadEnvFile();
  env.set(key, value);

  const lines: string[] = [];
  // Preserve any existing header comments
  if (existsSync(ENV_FILE)) {
    const content = readFileSync(ENV_FILE, "utf-8");
    for (const line of content.split("\n")) {
      if (line.startsWith("#")) {
        lines.push(line);
      } else {
        break;
      }
    }
  }
  if (lines.length === 0) {
    lines.push("# IronClaude Configuration");
  }
  lines.push("");

  for (const [k, v] of env) {
    const needsQuotes = /[\s#]/.test(v);
    lines.push(`${k}=${needsQuotes ? `"${v}"` : v}`);
  }
  writeFileSync(ENV_FILE, lines.join("\n") + "\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// OAuth Helpers (imported dynamically to avoid issues)
// ─────────────────────────────────────────────────────────────────────────────

async function getAuthorizationUrl(clientId: string, redirectUri: string): Promise<string> {
  const scopes = ["read:recovery", "read:sleep", "read:workout", "read:profile"];
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
  });
  return `https://api.prod.whoop.com/oauth/oauth2/auth?${params.toString()}`;
}

async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string
): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> {
  const response = await fetch("https://api.prod.whoop.com/oauth/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

async function verifyTokens(accessToken: string): Promise<string> {
  const response = await fetch("https://api.prod.whoop.com/developer/v2/user/profile/basic", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error("Invalid token");
  }

  const data = (await response.json()) as { first_name: string; last_name: string };
  return `${data.first_name} ${data.last_name}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup Flow
// ─────────────────────────────────────────────────────────────────────────────

export interface WhoopSetupResult {
  success: boolean;
  configured: boolean;
  error?: string;
}

/**
 * Check if Whoop is already configured.
 */
export function isWhoopConfigured(): boolean {
  const env = loadEnvFile();
  return !!(
    env.get("WHOOP_CLIENT_ID") &&
    env.get("WHOOP_CLIENT_SECRET") &&
    env.get("WHOOP_ACCESS_TOKEN") &&
    env.get("WHOOP_REFRESH_TOKEN")
  );
}

/**
 * Run the Whoop setup wizard.
 *
 * @param deployUrl - The deployed app URL (for OAuth redirect)
 */
export async function setupWhoop(deployUrl?: string): Promise<WhoopSetupResult> {
  ui.header("Whoop Integration Setup");

  // Check if already configured
  if (isWhoopConfigured()) {
    ui.success("Whoop is already configured!");
    ui.blank();

    const reconfigure = await confirm({
      message: "Do you want to reconfigure Whoop?",
      default: false,
    });

    if (!reconfigure) {
      return { success: true, configured: true };
    }
  }

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // Step 1: Create Whoop Developer App
    // ─────────────────────────────────────────────────────────────────────────
    ui.blank();
    console.log(pc.bold("  Step 1: Create a Whoop Developer App"));
    ui.blank();
    ui.info("You need to create an app in the Whoop Developer Dashboard.");
    ui.blank();
    console.log("  1. Go to " + pc.cyan("https://developer.whoop.com"));
    console.log("  2. Sign in with your Whoop account");
    console.log("  3. Click " + pc.bold('"Create App"') + " in the dashboard");
    console.log("  4. Fill in the app details:");
    console.log("     - Name: IronClaude (or any name you prefer)");
    console.log("     - Description: Personal fitness coaching bot");

    // Determine redirect URI
    let redirectUri: string;
    if (deployUrl) {
      redirectUri = `${deployUrl}/api/integrations/whoop/callback`;
      console.log("     - Redirect URI: " + pc.cyan(redirectUri));
    } else {
      ui.blank();
      ui.info("Enter your deployed app URL (e.g., https://workout-coach.fly.dev)");
      const appUrl = await input({
        message: "App URL:",
        validate: (v) => {
          if (!v) return "URL is required";
          if (!v.startsWith("http")) return "Must be a valid URL";
          return true;
        },
      });
      redirectUri = `${appUrl.replace(/\/$/, "")}/api/integrations/whoop/callback`;
      console.log("     - Redirect URI: " + pc.cyan(redirectUri));
    }

    ui.blank();
    console.log("  5. Select these scopes:");
    console.log("     " + pc.dim("☑ read:recovery"));
    console.log("     " + pc.dim("☑ read:sleep"));
    console.log("     " + pc.dim("☑ read:workout"));
    console.log("     " + pc.dim("☑ read:profile"));
    ui.blank();

    await confirm({ message: "Press Enter when you've created the app..." });

    // ─────────────────────────────────────────────────────────────────────────
    // Step 2: Collect OAuth Credentials
    // ─────────────────────────────────────────────────────────────────────────
    ui.blank();
    console.log(pc.bold("  Step 2: Enter your Whoop App Credentials"));
    ui.blank();
    ui.info("Copy these from your app settings in the Whoop Developer Dashboard.");
    ui.blank();

    const clientId = await input({
      message: "Client ID:",
      validate: (v) => (v ? true : "Client ID is required"),
    });

    const clientSecret = await password({
      message: "Client Secret:",
      validate: (v) => (v ? true : "Client Secret is required"),
    });

    // Save credentials immediately
    saveToEnv("WHOOP_CLIENT_ID", clientId);
    saveToEnv("WHOOP_CLIENT_SECRET", clientSecret);
    ui.success("Credentials saved to .env");

    // ─────────────────────────────────────────────────────────────────────────
    // Step 3: OAuth Authorization
    // ─────────────────────────────────────────────────────────────────────────
    ui.blank();
    console.log(pc.bold("  Step 3: Authorize Your Whoop Account"));
    ui.blank();
    ui.info("Now you need to authorize IronClaude to access your Whoop data.");
    ui.blank();

    const authUrl = await getAuthorizationUrl(clientId, redirectUri);
    console.log("  Open this URL in your browser:");
    ui.blank();
    console.log("  " + pc.cyan(authUrl));
    ui.blank();
    ui.info("After authorizing, you'll be redirected to a URL containing a code.");
    ui.info("The URL will look like: " + redirectUri + "?code=XXXXXX");
    ui.blank();

    const authCode = await input({
      message: "Paste the authorization code from the URL:",
      validate: (v) => (v ? true : "Authorization code is required"),
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Step 4: Exchange Code for Tokens
    // ─────────────────────────────────────────────────────────────────────────
    const tokenSpinner = ui.spinner("Exchanging authorization code for tokens...");

    try {
      const tokens = await exchangeCodeForTokens(authCode, redirectUri, clientId, clientSecret);

      // Verify the tokens work
      const userName = await verifyTokens(tokens.accessToken);

      tokenSpinner.success({ text: `Connected to Whoop account: ${userName}` });

      // Save tokens
      saveToEnv("WHOOP_ACCESS_TOKEN", tokens.accessToken);
      saveToEnv("WHOOP_REFRESH_TOKEN", tokens.refreshToken);
      saveToEnv("WHOOP_TOKEN_EXPIRES", String(tokens.expiresAt));

      ui.success("Tokens saved to .env");
    } catch (error) {
      tokenSpinner.error({ text: "Failed to exchange authorization code" });
      throw error;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 5: Webhook Setup Instructions
    // ─────────────────────────────────────────────────────────────────────────
    ui.blank();
    console.log(pc.bold("  Step 4: Configure Webhooks (Optional but Recommended)"));
    ui.blank();
    ui.info("Webhooks let Whoop notify IronClaude when new data is available.");
    ui.info("This means your sleep and recovery data updates automatically!");
    ui.blank();
    console.log("  In the Whoop Developer Dashboard:");
    console.log("  1. Go to your app's Webhook settings");
    console.log("  2. Add a webhook URL:");
    console.log("     " + pc.cyan(`${redirectUri.replace("/callback", "/webhook")}`));
    console.log("  3. Select events to subscribe to:");
    console.log("     " + pc.dim("☑ sleep.updated"));
    console.log("     " + pc.dim("☑ recovery.updated"));
    console.log("     " + pc.dim("☑ workout.updated"));
    ui.blank();

    const webhookSetup = await confirm({
      message: "Have you configured webhooks?",
      default: false,
    });

    if (webhookSetup) {
      ui.success("Webhooks configured!");
    } else {
      ui.info("You can set up webhooks later. Data will still sync on schedule.");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Done!
    // ─────────────────────────────────────────────────────────────────────────
    ui.divider();
    console.log(`  ${pc.green("✓")} ${ui.bold("Whoop integration complete!")}`);
    ui.blank();
    ui.info("Your sleep, recovery, and workout data will now be available to the coach.");
    ui.info("After deploying, your morning recovery score will appear in daily reminders!");
    ui.blank();

    return { success: true, configured: true };
  } catch (error) {
    ui.blank();
    ui.error(error instanceof Error ? error.message : "Setup failed");
    ui.blank();
    ui.info("You can try again later with: npm run setup:whoop");
    return {
      success: false,
      configured: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Run setup as standalone script.
 */
export async function runStandaloneSetup(): Promise<void> {
  const result = await setupWhoop();
  process.exit(result.success ? 0 : 1);
}
