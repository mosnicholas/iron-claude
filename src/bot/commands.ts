/**
 * Command Handlers
 *
 * Only /help, /restart, /reauth remain as explicit commands.
 * All other capabilities are handled by the agent via natural language.
 */

import { CoachAgentV2 } from "../coach-v2/index.js";
import { TelegramBot } from "./telegram.js";
import { getIntegration } from "../integrations/registry.js";
import { inspectStoredTokens, isWhoopOAuthConfigured } from "../integrations/whoop/oauth.js";

export interface CommandContext {
  userId: string;
  agent: CoachAgentV2;
  bot: TelegramBot;
  args: string;
}

type CommandHandler = (ctx: CommandContext) => Promise<string>;

/**
 * Available commands — only infrastructure commands, not coaching capabilities.
 */
export const COMMANDS: Record<string, CommandHandler> = {
  help: handleHelp,
  restart: handleRestart,
  reauth: handleReauth,
  whoopstatus: handleWhoopStatus,
};

const HELP_TEXT = `**How to Use IronClaude**

Just talk to me naturally! Here's what I can help with:

📋 **Planning & Schedule**
• "What's my workout today?"
• "Show me this week's plan"
• "Swap bench for incline this week"
• "Plan my week"

🏋️ **During a Workout**
• "bench 175x5" — log exercises in any format
• "bar with 25s each side" — I do plate math
• "that felt heavy" — I'll note it for next time
• "what's next?" — I'll check the plan
• "I'm done" — wrap up the session

📊 **Progress & History**
• "What are my PRs?"
• "How's my bench progressing?"
• "Give me a summary of my last few weeks"

🎥 **Exercise Info**
• "Show me how to do a face pull"
• "What muscles does this machine work?"

⏰ **Reminders**
• "Remind me at 5pm for the workout"

🛠️ **Diagnostics**
• \`/debug why didn't the AM reminder fire yesterday?\` — read-only system inspection
• \`/whoopstatus\` — check the on-disk state of the Whoop token file

💬 **General**
• Ask me anything about training, form, recovery
• Tell me how you're feeling — I'll adjust the plan`;

async function handleHelp(_ctx: CommandContext): Promise<string> {
  return HELP_TEXT;
}

/**
 * /reauth - Generate a Whoop OAuth re-authorization link.
 */
async function handleReauth(ctx: CommandContext): Promise<string> {
  const device = ctx.args.trim().toLowerCase() || "whoop";
  const integration = getIntegration(device);

  if (!integration) {
    return `Unknown integration: ${device}`;
  }

  if (!integration.isConfigured()) {
    return `${device} is not configured. Set client credentials first.`;
  }

  const appUrl = process.env.APP_URL || "https://workout-coach.fly.dev";
  const redirectUri = `${appUrl}/api/integrations/${device}/callback`;
  const authUrl = integration.getAuthUrl(redirectUri);

  return `Click the link below to re-authorize ${integration.name}:\n\n${authUrl}`;
}

/**
 * /whoopstatus - Report the on-disk state of the Whoop token file.
 *
 * Diagnostic for "Whoop tokens not configured" errors: surfaces whether
 * /reauth actually persisted both access and refresh tokens.
 */
async function handleWhoopStatus(ctx: CommandContext): Promise<string> {
  const lines: string[] = ["Whoop integration status:"];

  const credsConfigured = isWhoopOAuthConfigured();
  lines.push(`${credsConfigured ? "✓" : "✗"} Client credentials configured`);
  if (!credsConfigured) {
    lines.push("Set WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET, then /reauth.");
    return lines.join("\n");
  }

  let inspection;
  try {
    inspection = await inspectStoredTokens(ctx.userId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lines.push(`✗ Failed to read tokens row: ${message}`);
    return lines.join("\n");
  }

  if (!inspection.fileExists) {
    lines.push("✗ No Whoop tokens row in the database");
    lines.push("Run /reauth to authorize Whoop.");
    return lines.join("\n");
  }
  lines.push("✓ Whoop tokens row exists in database");

  if (!inspection.parseable) {
    lines.push("✗ Token row is malformed");
    lines.push("Run /reauth to overwrite.");
    return lines.join("\n");
  }

  lines.push(`${inspection.hasAccessToken ? "✓" : "✗"} Access token present`);
  lines.push(`${inspection.hasRefreshToken ? "✓" : "✗"} Refresh token present`);

  if (inspection.expiresAt !== undefined) {
    const now = Date.now();
    const deltaMs = inspection.expiresAt - now;
    const deltaMin = Math.round(deltaMs / 60000);
    if (deltaMs > 0) {
      lines.push(`Access token expires in ${deltaMin} min`);
    } else {
      lines.push(`Access token expired ${Math.abs(deltaMin)} min ago`);
    }
  }

  if (inspection.updatedAt) {
    lines.push(`Last updated: ${inspection.updatedAt}`);
  }

  if (!inspection.hasRefreshToken) {
    lines.push("");
    lines.push(
      "⚠ Missing refresh token. Whoop usually only returns one when the auth request has the `offline` scope and your developer app is registered for it."
    );
  }

  return lines.join("\n");
}

async function handleRestart(ctx: CommandContext): Promise<string> {
  await ctx.bot.sendPlainMessage("Restarting server... Be back in a moment!");

  // Small delay to ensure the message is sent before exit
  setTimeout(() => {
    console.log("[Commands] Server restart requested via /restart command");
    process.exit(0);
  }, 500);

  return "";
}

export function commandExists(command: string): boolean {
  return command in COMMANDS;
}

export async function executeCommand(
  command: string,
  args: string,
  ctx: { userId: string; agent: CoachAgentV2; bot: TelegramBot }
): Promise<string> {
  const handler = COMMANDS[command];
  if (!handler) {
    return "";
  }
  return handler({ ...ctx, args });
}
