/**
 * Express HTTP Server
 *
 * Main entry point for the Fly.io deployment.
 */

import express from "express";
import { webhookHandler } from "./handlers/webhook.js";
import { createCronHandler } from "./handlers/cron.js";
import { createTelegramBot } from "./bot/telegram.js";

const app = express();
app.use(express.json());

// Health check
app.get("/health", (_, res) => res.json({ ok: true }));

// Telegram webhook
app.post("/api/webhook", webhookHandler);

// Cron endpoints (called by external cron service like cron-job.org)
app.get("/api/cron/daily-reminder", createCronHandler("daily-reminder"));
app.get("/api/cron/weekly-plan", createCronHandler("weekly-plan"));
app.get("/api/cron/weekly-retro", createCronHandler("weekly-retro"));
app.get("/api/cron/check-reminders", createCronHandler("check-reminders"));

/**
 * Send deployment notification to user
 */
async function notifyDeployment(): Promise<void> {
  try {
    const bot = createTelegramBot();
    const commitSha = process.env.GIT_COMMIT_SHA;
    const version = commitSha && commitSha !== "unknown" ? commitSha.slice(0, 7) : null;

    const message = version
      ? `🚀 New version deployed (${version}). I'm back online!`
      : `🚀 New version deployed. I'm back online!`;

    await bot.sendMessage(message);
  } catch {
    // Don't fail startup if notification fails
    console.log("Could not send deployment notification");
  }
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  notifyDeployment();
});
