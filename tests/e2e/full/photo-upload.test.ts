/**
 * Full e2e — photo upload via Telegram.
 *
 * Exercises the agent-turn photo branch end-to-end:
 *
 *   - Telegram update arrives with a `photo` array
 *   - Webhook queues the inbox event
 *   - Worker calls runAgentTurn → downloadPhotoBytes → (best-effort) Supabase
 *     Storage upload
 *
 * The harness's FakeTelegram does NOT serve `/file/bot.../...`, so the photo
 * download will fail and the agent-turn catch block sends "Couldn't download
 * that image" via the bot. The webhook itself MUST still return 200 and the
 * server must not crash. If real Supabase Storage isn't configured (it isn't
 * in tests), `uploadPhoto` is skipped by design via `isSupabaseConfigured()`.
 *
 * This test guarantees:
 *   - The webhook accepts a photo-bearing update (HTTP 200)
 *   - The conversation continues (an outbound bot message is produced)
 *   - No photos row is required (Storage write is best-effort)
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import { eq } from "drizzle-orm";
import { E2EHarness } from "../harness/index.js";
import { seedUser } from "../harness/builders.js";
import { eventually } from "../harness/waiters.js";
import { getDb } from "../../../src/db/client.js";
import { messages, photos } from "../../../src/db/schema.js";

const HAS_API_KEY = !!process.env.ANTHROPIC_API_KEY;
const describeMaybe = HAS_API_KEY ? describe : describe.skip;

describeMaybe("e2e full / photo upload", () => {
  let env: E2EHarness;

  beforeAll(async () => {
    env = await E2EHarness.start();
  });

  afterAll(async () => {
    await env.stop();
  });

  beforeEach(async () => {
    await env.beforeEach();
  });

  it("accepts a photo-bearing update without crashing", async () => {
    const user = await seedUser({
      displayName: "PhotoAthlete",
      timezone: "America/New_York",
      tier: "athlete", // photos are gated on tier; athlete is the safe choice
      telegramChatId: "9201",
      profileBody:
        "## Goals\nphysique\n## Equipment\nfull gym\n## Schedule\n4x/week",
    });

    try {
      const res = await env.sendTelegramUpdate({
        chatId: 9201,
        photoFileId: "photo_test_1",
        caption: "progress check",
        updateId: 92011,
      });
      expect(res.status).toBe(200);

      // The worker should still process the inbox row — at minimum there
      // should be an outbound Telegram call (either "couldn't download" on
      // the photo-fetch path, or a real assistant reply if download
      // somehow succeeded).
      await eventually(
        async () => env.telegram.calls.length > 0,
        { timeoutMs: 30_000, label: "bot produced at least one outbound message" }
      );

      // photos row is best-effort. If Supabase Storage isn't configured (the
      // default in tests), the upload is skipped by design. Log either
      // outcome.
      const db = getDb();
      const photoRows = await db.select().from(photos).where(eq(photos.userId, user.id));
      if (photoRows.length === 0) {
        console.log("[photo-upload] photo upload skipped (no Supabase Storage)");
      } else {
        console.log(`[photo-upload] photo persisted (id=${photoRows[0].id})`);
        expect(photoRows[0].userId).toBe(user.id);
      }

      // Whatever happened upstream, the conversation must not have crashed:
      // either an assistant message landed, OR the bot sent a "couldn't
      // download" notice (which goes out as a sendMessage call but isn't
      // logged into `messages` since runAgentTurn returns early). We accept
      // either signal.
      const assistantMessages = await db
        .select()
        .from(messages)
        .where(eq(messages.userId, user.id));
      const sawAssistant = assistantMessages.some((m) => m.role === "assistant");
      const sawOutboundBotMessage = env.telegram.callsTo("sendMessage").length > 0;
      expect(sawAssistant || sawOutboundBotMessage).toBe(true);
    } catch (err) {
      env.printTimeline("photo-upload failure");
      throw err;
    }
  }, 120_000);
});
