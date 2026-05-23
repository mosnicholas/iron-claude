/**
 * Integration test for the `get_progress_photo` read tool.
 *
 * Seeds three photo rows in the shared testcontainers PG, mocks the signed-URL generator so we don't
 * need a live Supabase project, and exercises:
 *   - default (most-recent) selection
 *   - explicit index
 *   - by-date with the 7-day window
 *   - "no photos" + "out of range" + "no nearby date" failure modes
 */

import { jest } from "@jest/globals";

// Mock the auth/supabase module so the real `getPhotoSignedUrl` in
// src/storage/photos.ts can run end-to-end without a live Supabase project.
// We only need to fake the bits the helper touches: `isSupabaseConfigured`
// (returns true) and `getSupabaseAdmin().storage.from(...).createSignedUrl(...)`.
const signedUrls = new Map<string, string>();

jest.unstable_mockModule("../../src/auth/supabase.js", () => {
  return {
    isSupabaseConfigured: () => true,
    getSupabaseAdmin: () => ({
      storage: {
        from: (_bucket: string) => ({
          createSignedUrl: async (path: string) => {
            const url = signedUrls.get(path);
            return url
              ? { data: { signedUrl: url }, error: null }
              : { data: null, error: { message: "not found" } };
          },
        }),
      },
    }),
  };
});

// Dynamic imports so the mock above takes effect.
const { createMemDb, getMemDb, seedUser } = await import("../helpers/realpg.js");
const { getDb } = await import("../../src/db/client.js");
const { photos } = await import("../../src/db/schema.js");
const { getProgressPhoto } = await import("../../src/coach-v2/tools/reads.js");
const { createTestContext } = await import("./setup.js");

describe("get_progress_photo tool", () => {
  let userId: string;
  const olderId = "11111111-1111-1111-1111-111111111111";
  const middleId = "22222222-2222-2222-2222-222222222222";
  const newestId = "33333333-3333-3333-3333-333333333333";

  beforeAll(() => {
    createMemDb();
  });

  afterAll(async () => {
    await getMemDb().close();
  });

  beforeEach(async () => {
    await getMemDb().reset();
    userId = await seedUser({ displayName: "Athlete" });
    signedUrls.clear();

    const rows = [
      { id: olderId, takenAt: new Date("2026-02-23T10:00:00Z"), caption: "older shot" },
      { id: middleId, takenAt: new Date("2026-04-23T10:00:00Z"), caption: "month back" },
      { id: newestId, takenAt: new Date("2026-05-23T10:00:00Z"), caption: "latest pump" },
    ];
    for (const r of rows) {
      const path = `${userId}/${r.id}.jpg`;
      signedUrls.set(path, `https://signed.example/${r.id}`);
      await getDb().insert(photos).values({
        id: r.id,
        userId,
        storagePath: path,
        bucket: "progress-photos",
        contentType: "image/jpeg",
        caption: r.caption,
        takenAt: r.takenAt,
      });
    }
  });

  it("returns the most recent photo by default", async () => {
    const ctx = createTestContext(userId);
    const result = await getProgressPhoto.handler({}, ctx);
    expect(result).toContain("2026-05-23");
    expect(result).toContain("latest pump");
    expect(result).toContain(`https://signed.example/${newestId}`);
  });

  it("returns the Nth-most-recent photo when index is set", async () => {
    const ctx = createTestContext(userId);
    const result = await getProgressPhoto.handler({ index: 2 }, ctx);
    expect(result).toContain("2026-02-23");
    expect(result).toContain("older shot");
    expect(result).toContain(`https://signed.example/${olderId}`);
  });

  it("returns the photo closest to a given date (within 7 days)", async () => {
    const ctx = createTestContext(userId);
    // Within 7 days of the middle photo (2026-04-23).
    const result = await getProgressPhoto.handler({ date: "2026-04-25" }, ctx);
    expect(result).toContain("2026-04-23");
    expect(result).toContain(`https://signed.example/${middleId}`);
  });

  it("reports failure when no photo exists within 7 days of the requested date", async () => {
    const ctx = createTestContext(userId);
    // No photo near 2026-08-01 (all are months earlier).
    const result = await getProgressPhoto.handler({ date: "2026-08-01" }, ctx);
    expect(result).toMatch(/No progress photo found within 7 days/);
  });

  it("reports out-of-range when index exceeds the photo count", async () => {
    const ctx = createTestContext(userId);
    const result = await getProgressPhoto.handler({ index: 99 }, ctx);
    expect(result).toMatch(/out of range/);
  });

  it("reports 'no progress photos' when the user has none", async () => {
    // Wipe the seeded rows for this case.
    await getDb().delete(photos);
    const ctx = createTestContext(userId);
    const result = await getProgressPhoto.handler({}, ctx);
    expect(result).toMatch(/No progress photos/);
  });
});
