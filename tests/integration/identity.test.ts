/**
 * Identity / channel-binding integration tests.
 */

import { createMemDb, getMemDb } from "../helpers/pgmem.js";
import {
  findOrCreateUserByChannel,
  findOrCreateUserByPhone,
  bindChannelToUser,
  getUserById,
  resolveUserByChannel,
} from "../../src/auth/identity.js";

describe("identity", () => {
  beforeAll(() => {
    createMemDb();
  });
  afterAll(() => {
    getMemDb().close();
  });
  beforeEach(() => {
    getMemDb().reset();
  });

  describe("findOrCreateUserByChannel", () => {
    it("auto-creates a user the first time", async () => {
      const u = await findOrCreateUserByChannel("telegram", "12345");
      expect(u.id).toBeTruthy();
      // Placeholder phone is synthesized from the channel id.
      expect(u.phoneE164).toMatch(/^\+pending:telegram:12345$/);
    });

    it("returns the existing user on a second call", async () => {
      const a = await findOrCreateUserByChannel("telegram", "12345");
      const b = await findOrCreateUserByChannel("telegram", "12345");
      expect(b.id).toBe(a.id);
    });

    it("accepts hints (displayName, timezone)", async () => {
      const u = await findOrCreateUserByChannel("telegram", "99", {
        displayName: "Bob",
        timezone: "Europe/London",
      });
      expect(u.displayName).toBe("Bob");
      expect(u.timezone).toBe("Europe/London");
    });

    it("scopes by (channel, externalId) — different externalId → different user", async () => {
      const a = await findOrCreateUserByChannel("telegram", "111");
      const b = await findOrCreateUserByChannel("telegram", "222");
      expect(a.id).not.toBe(b.id);
    });
  });

  describe("resolveUserByChannel + getUserById", () => {
    it("returns null when no binding exists", async () => {
      expect(await resolveUserByChannel("telegram", "nope")).toBeNull();
    });

    it("getUserById returns the user", async () => {
      const u = await findOrCreateUserByChannel("telegram", "abc");
      const found = await getUserById(u.id);
      expect(found?.id).toBe(u.id);
    });
  });

  describe("bindChannelToUser", () => {
    it("binds a channel to an existing user", async () => {
      const u = await findOrCreateUserByChannel("telegram", "10");
      await bindChannelToUser(u.id, "whatsapp", "+1555");
      const found = await resolveUserByChannel("whatsapp", "+1555");
      expect(found?.id).toBe(u.id);
    });

    it("is idempotent on (channel, externalId) — no duplicate row", async () => {
      const u = await findOrCreateUserByChannel("telegram", "10");
      await bindChannelToUser(u.id, "whatsapp", "+1555");
      await bindChannelToUser(u.id, "whatsapp", "+1555");
      // Second call should be a no-op; still resolves to the same user.
      const found = await resolveUserByChannel("whatsapp", "+1555");
      expect(found?.id).toBe(u.id);
    });
  });

  describe("findOrCreateUserByPhone", () => {
    const SUPA_1 = "11111111-1111-1111-1111-111111111111";
    const SUPA_2 = "22222222-2222-2222-2222-222222222222";

    it("creates a new user if no row exists", async () => {
      const u = await findOrCreateUserByPhone("+15551234567", SUPA_1);
      expect(u.phoneE164).toBe("+15551234567");
      expect(u.supabaseUserId).toBe(SUPA_1);
    });

    it("returns the existing user when supabaseUserId already matches", async () => {
      const a = await findOrCreateUserByPhone("+15551234567", SUPA_1);
      const b = await findOrCreateUserByPhone("+15551234567", SUPA_1);
      expect(b.id).toBe(a.id);
    });

    it("adopts an existing phone-only row by writing supabaseUserId back", async () => {
      // Create a user via the channel path — they get a placeholder phone.
      // Then manually upgrade their phoneE164 to a real number with a direct
      // update, simulating the state right before OTP completion.
      const tg = await findOrCreateUserByChannel("telegram", "777");
      expect(tg.supabaseUserId).toBeNull();
      // Promote the placeholder to a real phone (still no supabaseUserId).
      const { getDb } = await import("../../src/db/client.js");
      const { users } = await import("../../src/db/schema.js");
      const { eq } = await import("drizzle-orm");
      await getDb()
        .update(users)
        .set({ phoneE164: "+15558887777" })
        .where(eq(users.id, tg.id));

      // Now the OTP finishes — adopt the existing row.
      const adopted = await findOrCreateUserByPhone("+15558887777", SUPA_2);
      expect(adopted.id).toBe(tg.id);
      expect(adopted.supabaseUserId).toBe(SUPA_2);
    });
  });
});
