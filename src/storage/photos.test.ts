/**
 * Unit tests for the photo-metadata storage helpers.
 *
 * These tests cover the DB-only paths (`listUserPhotos`, `getPhoto`) using the
 * in-memory Postgres helper. They intentionally skip anything that hits real
 * Supabase Storage (`uploadPhoto`, `getPhotoSignedUrl`, `deletePhoto`) — those
 * would require either a live Supabase project or a Storage mock harness.
 */

import { createMemDb, getMemDb, seedUser } from "../../tests/helpers/realpg.js";
import { getDb } from "../db/client.js";
import { photos } from "../db/schema.js";
import { getPhoto, listUserPhotos } from "./photos.js";

describe("photo metadata storage (DB layer)", () => {
  let alice: string;
  let bob: string;

  beforeAll(() => {
    createMemDb();
  });

  afterAll(async () => {
    await getMemDb().close();
  });

  beforeEach(async () => {
    await getMemDb().reset();
    alice = await seedUser({ displayName: "Alice" });
    bob = await seedUser({ displayName: "Bob" });
  });

  async function seedPhoto(
    userId: string,
    takenAt: Date,
    overrides: Partial<{ caption: string; contentType: string }> = {}
  ): Promise<string> {
    const id = crypto.randomUUID();
    await getDb()
      .insert(photos)
      .values({
        id,
        userId,
        storagePath: `${userId}/${id}.jpg`,
        bucket: "progress-photos",
        contentType: overrides.contentType ?? "image/jpeg",
        caption: overrides.caption ?? null,
        takenAt,
      });
    return id;
  }

  describe("listUserPhotos", () => {
    it("returns an empty array when the user has no photos", async () => {
      const rows = await listUserPhotos(alice);
      expect(rows).toEqual([]);
    });

    it("returns rows in newest-first order", async () => {
      const old = await seedPhoto(alice, new Date("2026-01-01T10:00:00Z"));
      const middle = await seedPhoto(alice, new Date("2026-03-01T10:00:00Z"));
      const recent = await seedPhoto(alice, new Date("2026-05-01T10:00:00Z"));

      const rows = await listUserPhotos(alice);
      expect(rows.map((r) => r.id)).toEqual([recent, middle, old]);
    });

    it("scopes by userId — never leaks across users", async () => {
      await seedPhoto(alice, new Date("2026-04-01T10:00:00Z"));
      const bobsPhoto = await seedPhoto(bob, new Date("2026-04-02T10:00:00Z"));

      const aliceRows = await listUserPhotos(alice);
      const bobRows = await listUserPhotos(bob);
      expect(aliceRows.every((r) => r.userId === alice)).toBe(true);
      expect(bobRows.map((r) => r.id)).toEqual([bobsPhoto]);
    });

    it("respects the limit option", async () => {
      for (let i = 0; i < 5; i++) {
        await seedPhoto(alice, new Date(`2026-01-${String(i + 1).padStart(2, "0")}T10:00:00Z`));
      }
      const rows = await listUserPhotos(alice, { limit: 2 });
      expect(rows).toHaveLength(2);
    });

    it("filters by since/until window", async () => {
      await seedPhoto(alice, new Date("2026-01-15T10:00:00Z"));
      const inside = await seedPhoto(alice, new Date("2026-03-15T10:00:00Z"));
      await seedPhoto(alice, new Date("2026-05-15T10:00:00Z"));

      const rows = await listUserPhotos(alice, {
        since: "2026-02-01T00:00:00Z",
        until: "2026-04-30T23:59:59Z",
      });
      expect(rows.map((r) => r.id)).toEqual([inside]);
    });
  });

  describe("getPhoto", () => {
    it("returns the row when present", async () => {
      const id = await seedPhoto(alice, new Date("2026-04-01T10:00:00Z"), {
        caption: "first photo",
      });
      const row = await getPhoto(alice, id);
      expect(row?.id).toBe(id);
      expect(row?.caption).toBe("first photo");
    });

    it("returns null when the photo belongs to another user", async () => {
      const bobsPhoto = await seedPhoto(bob, new Date("2026-04-01T10:00:00Z"));
      const row = await getPhoto(alice, bobsPhoto);
      expect(row).toBeNull();
    });

    it("returns null for an unknown id", async () => {
      const row = await getPhoto(alice, crypto.randomUUID());
      expect(row).toBeNull();
    });
  });
});
