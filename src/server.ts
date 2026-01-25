/**
 * Express HTTP Server
 *
 * Main entry point for the Fly.io deployment.
 */

import express from "express";
import { webhookHandler } from "./handlers/webhook.js";
import { createCronHandler } from "./handlers/cron.js";

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

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
