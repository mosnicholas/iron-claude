/**
 * Telegram Webhook Configuration
 *
 * Sets up the Telegram webhook to point to the deployed URL.
 */

const TELEGRAM_API_BASE = "https://api.telegram.org";

interface TelegramResponse {
  ok: boolean;
  description?: string;
  result?: unknown;
}

/**
 * Set the Telegram webhook URL
 */
export async function setWebhook(
  botToken: string,
  webhookUrl: string,
  secretToken?: string
): Promise<void> {
  const body: Record<string, unknown> = {
    url: webhookUrl,
    allowed_updates: ["message"],
    drop_pending_updates: true,
  };

  if (secretToken) {
    body.secret_token = secretToken;
  }

  const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as TelegramResponse;

  if (!data.ok) {
    throw new Error(`Failed to set webhook: ${data.description}`);
  }
}

/**
 * Delete the Telegram webhook
 */
export async function deleteWebhook(botToken: string): Promise<void> {
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/deleteWebhook`, {
    method: "POST",
  });

  const data = (await response.json()) as TelegramResponse;

  if (!data.ok) {
    throw new Error(`Failed to delete webhook: ${data.description}`);
  }
}

/**
 * Get current webhook info
 */
export async function getWebhookInfo(
  botToken: string
): Promise<{ url: string; pending_update_count: number }> {
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/getWebhookInfo`);

  const data = (await response.json()) as TelegramResponse;

  if (!data.ok) {
    throw new Error(`Failed to get webhook info: ${data.description}`);
  }

  return data.result as { url: string; pending_update_count: number };
}

/**
 * Verify bot token is valid by getting bot info
 */
export async function verifyBotToken(botToken: string): Promise<string> {
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/getMe`);

  const data = (await response.json()) as TelegramResponse;

  if (!data.ok) {
    throw new Error("Invalid Telegram bot token");
  }

  const botInfo = data.result as { username: string };
  return botInfo.username;
}
