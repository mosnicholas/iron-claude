/**
 * Daily Reminder — per-user logic. Dispatched from pg-boss via the
 * `daily-reminder.tick` schedule (fan-out) → `daily-reminder.user`
 * (one job per user, with its own retry).
 */

import { createCoachAgentV2 } from "../coach-v2/index.js";
import { getCurrentWeek, getToday, formatDateHuman } from "../utils/date.js";
import type { JobCtx } from "../jobs/handlers.js";

export async function processDailyReminderForUser({
  user,
  storage,
  sendMessage,
}: JobCtx): Promise<{ success: boolean; message?: string; error?: string }> {
  const timezone = user.timezone;
  const currentWeek = getCurrentWeek(timezone);
  const today = getToday(timezone);

  const plan = await storage.readWeeklyPlan(user.id, currentWeek);

  if (!plan) {
    await sendMessage(
      `Good morning! No plan loaded for this week (${currentWeek}). ` +
        `Want me to generate one? Just say "plan my week".`
    );
    return { success: true, message: "No weekly plan found, sent prompt to generate" };
  }

  const agent = createCoachAgentV2({ userId: user.id, timezone });
  const response = await agent.runDailyReminder(
    `Generate the morning workout reminder for ${formatDateHuman(new Date(today))} (${today}). ` +
      `Reference today's plan. End by asking what time they're heading to the gym ` +
      `so you can schedule a warm-up reminder.`
  );
  await sendMessage(response.message);

  return { success: true, message: `Sent morning reminder for ${today}` };
}
