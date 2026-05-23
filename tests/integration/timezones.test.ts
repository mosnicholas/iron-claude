/**
 * Per-user timezone integration tests.
 *
 * Covers the three places the server's process timezone used to leak into
 * user-facing prompts and messages:
 *   1. `getDateInfoTZAware(timezone)` — must vary per user.
 *   2. `formatRecentMessagesForPrompt(userId, timezone, ...)` — must render
 *      message timestamps in the user's local clock.
 *   3. `runDailyReminder` — the morning-reminder prompt must format "today"
 *      using the user's tz, not the process env tz.
 */

import { jest } from "@jest/globals";

// Mock the agent factory and the bot dispatcher before importing the cron
// module so its top-level imports pick up the mocks.
const reminderCalls: { userId: string; prompt: string; timezone: string }[] = [];
const sentMessages: { userId: string; text: string }[] = [];

jest.unstable_mockModule("../../src/coach-v2/index.js", () => ({
  createCoachAgentV2: ({ userId, timezone }: { userId: string; timezone: string }) => ({
    runDailyReminder: async (prompt: string) => {
      reminderCalls.push({ userId, prompt, timezone });
      return { message: "stub reminder" };
    },
  }),
}));

jest.unstable_mockModule("../../src/bot/telegram-for-user.js", () => ({
  sendBotMessageForUser: async (user: { id: string }, text: string) => {
    sentMessages.push({ userId: user.id, text });
  },
  getTelegramChatId: async () => "12345",
}));

const { createMemDb, getMemDb, seedUser } = await import("../helpers/realpg.js");
const { getDb } = await import("../../src/db/client.js");
const { messages } = await import("../../src/db/schema.js");
const { getDateInfoTZAware } = await import("../../src/utils/date.js");
const { formatRecentMessagesForPrompt } = await import("../../src/bot/message-history.js");
const { processDailyReminderForUser } = await import("../../src/cron/daily-reminder.js");
const { getStorage } = await import("../../src/storage/db.js");
const { runForEachUser } = await import("../helpers/run-cron.js");

const runDailyReminder = () => runForEachUser(processDailyReminderForUser);

describe("per-user timezone handling", () => {
  beforeAll(() => {
    createMemDb();
  });
  afterAll(async () => {
    await getMemDb().close();
  });
  beforeEach(async () => {
    await getMemDb().reset();
    reminderCalls.length = 0;
    sentMessages.length = 0;
  });

  describe("getDateInfoTZAware()", () => {
    // Pick a UTC instant that straddles the calendar boundary in the US:
    // 2026-05-23 03:00 UTC = 2026-05-22 23:00 EDT = 2026-05-22 20:00 PDT.
    // A PST user is on May 22, an EST user is also on May 22 — both prior day.
    // To force the buckets to differ we use 2026-05-23 06:30 UTC:
    //   EDT (UTC-4): 02:30 on 2026-05-23 → date "2026-05-23"
    //   PDT (UTC-7): 23:30 on 2026-05-22 → date "2026-05-22"
    it("yields different date buckets for PST vs EST at the same UTC instant", () => {
      const realDate = global.Date;
      const fixedNow = new realDate("2026-05-23T06:30:00Z");
      class FixedDate extends realDate {
        constructor(...args: unknown[]) {
          if (args.length === 0) {
            super(fixedNow.getTime());
          } else {
            // @ts-expect-error spread to Date constructor
            super(...args);
          }
        }
        static now() {
          return fixedNow.getTime();
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).Date = FixedDate;
      try {
        const eastern = getDateInfoTZAware("America/New_York");
        const pacific = getDateInfoTZAware("America/Los_Angeles");
        expect(eastern.date).toBe("2026-05-23");
        expect(pacific.date).toBe("2026-05-22");
        expect(eastern.timezone).toBe("America/New_York");
        expect(pacific.timezone).toBe("America/Los_Angeles");
        // Days of week differ across the boundary too.
        expect(eastern.dayOfWeek).toBe("Saturday");
        expect(pacific.dayOfWeek).toBe("Friday");
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (global as any).Date = realDate;
      }
    });

    it("falls back to env TIMEZONE when no arg is passed (backward-compat)", () => {
      const prev = process.env.TIMEZONE;
      process.env.TIMEZONE = "America/Los_Angeles";
      try {
        const info = getDateInfoTZAware();
        expect(info.timezone).toBe("America/Los_Angeles");
      } finally {
        process.env.TIMEZONE = prev;
      }
    });
  });

  describe("formatRecentMessagesForPrompt", () => {
    it("renders message timestamps in the caller's timezone", async () => {
      const userId = await seedUser({ displayName: "TZ User" });
      const db = getDb();
      // 2026-05-23 18:00 UTC → 14:00 EDT, 11:00 PDT.
      const ts = new Date("2026-05-23T18:00:00Z");
      await db.insert(messages).values({
        userId,
        role: "user",
        text: "hello",
        ts,
      });

      const eastBlock = await formatRecentMessagesForPrompt(
        userId,
        "America/New_York",
        10
      );
      const westBlock = await formatRecentMessagesForPrompt(
        userId,
        "America/Los_Angeles",
        10
      );

      // EDT in May is UTC-4 → 14:00. PDT in May is UTC-7 → 11:00.
      expect(eastBlock).toContain("[14:00] User: hello");
      expect(westBlock).toContain("[11:00] User: hello");
      // Quick sanity: PST string is exactly 3 hours earlier than EST.
      const eastTime = /\[(\d{2}):(\d{2})\] User: hello/.exec(eastBlock)!;
      const westTime = /\[(\d{2}):(\d{2})\] User: hello/.exec(westBlock)!;
      const diffMin =
        parseInt(eastTime[1], 10) * 60 +
        parseInt(eastTime[2], 10) -
        (parseInt(westTime[1], 10) * 60 + parseInt(westTime[2], 10));
      expect(diffMin).toBe(180);
    });
  });

  describe("runDailyReminder", () => {
    it("formats 'today' using the user's timezone", async () => {
      // Seed a plan so the reminder runs the agent path (not the early-return).
      // Use the current ISO week computed in the user's tz to satisfy the plan
      // lookup. We do this for both PST and EST users.
      const pstUser = await seedUser({
        displayName: "PST User",
        timezone: "America/Los_Angeles",
      });
      const estUser = await seedUser({
        displayName: "EST User",
        timezone: "America/New_York",
      });
      // Ensure both users have a profile (otherwise the cron skips them).
      const storage = getStorage();
      await storage.writeProfile(pstUser, "# PST profile");
      await storage.writeProfile(estUser, "# EST profile");

      const { getCurrentWeek } = await import("../../src/utils/date.js");
      const pstWeek = getCurrentWeek("America/Los_Angeles");
      const estWeek = getCurrentWeek("America/New_York");
      await storage.writeWeeklyPlan(pstUser, pstWeek, "# plan PST");
      await storage.writeWeeklyPlan(estUser, estWeek, "# plan EST");

      await runDailyReminder();

      const pstCall = reminderCalls.find((c) => c.userId === pstUser);
      const estCall = reminderCalls.find((c) => c.userId === estUser);
      expect(pstCall).toBeDefined();
      expect(estCall).toBeDefined();
      expect(pstCall!.timezone).toBe("America/Los_Angeles");
      expect(estCall!.timezone).toBe("America/New_York");

      // Extract the "EEEE, MMM d (YYYY-MM-DD)" tokens from the prompt and
      // verify they were computed in the user's tz. Both prompts should
      // include a real day name + date; we check that the day name matches
      // the date string for that user's timezone.
      const { formatInTimeZone } = await import("date-fns-tz");
      for (const call of [pstCall!, estCall!]) {
        const match = /reminder for ([A-Za-z]+, [A-Za-z]+ \d{1,2}) \((\d{4}-\d{2}-\d{2})\)/.exec(
          call.prompt
        );
        expect(match).not.toBeNull();
        const [, human, isoDate] = match!;
        const expectedHuman = formatInTimeZone(
          new Date(`${isoDate}T12:00:00Z`),
          call.timezone,
          "EEEE, MMM d"
        );
        expect(human).toBe(expectedHuman);
      }
    });
  });
});
