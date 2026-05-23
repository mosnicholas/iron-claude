/**
 * Progress-photo storage helpers.
 *
 * Photos are persisted in two places:
 *   - **Supabase Storage** (bucket `progress-photos`) — the bytes, at the
 *     well-known path `${userId}/${photoId}.${ext}`.
 *   - **`photos` table** — metadata (caption, content type, source) so the
 *     coach can query history without listing bucket objects.
 *
 * Every call is scoped by `userId`; the function signatures intentionally
 * require it so there is no path by which one user's bytes can be referenced
 * by another. Cross-user access is enforced at the DB layer (queries always
 * include `where(eq(photos.userId, ...))`).
 *
 * If Supabase is not configured (no SUPABASE_URL), all calls throw a clear
 * error rather than silently no-oping — the inbox worker's photo branch is
 * expected to catch + continue when that happens.
 */

import { and, desc, eq, gte, lte } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { photos, type Photo } from "../db/schema.js";
import { getSupabaseAdmin, isSupabaseConfigured } from "../auth/supabase.js";

export const PHOTO_BUCKET = "progress-photos";
const DEFAULT_SIGNED_URL_TTL_SECONDS = 5 * 60;

export interface UploadPhotoMeta {
  caption?: string | null;
  sizeBytes?: number | null;
  width?: number | null;
  height?: number | null;
  sourceChannel?: string;
  sourceMessageId?: string | null;
  takenAt?: Date;
}

export interface UploadPhotoResult {
  path: string;
  photoId: string;
}

export interface ListPhotosOpts {
  since?: string; // YYYY-MM-DD or ISO timestamp
  until?: string;
  limit?: number;
}

function requireSupabase(): ReturnType<typeof getSupabaseAdmin> {
  if (!isSupabaseConfigured()) {
    throw new Error(
      "Supabase Storage is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"
    );
  }
  return getSupabaseAdmin();
}

function extensionFor(contentType: string): string {
  switch (contentType.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/heic":
      return "heic";
    default:
      // Fall back to the subtype if it looks reasonable, else .bin.
      const m = /^image\/([a-z0-9]+)/i.exec(contentType);
      return m ? m[1].toLowerCase() : "bin";
  }
}

/**
 * Upload a photo's bytes to Supabase Storage AND record a row in `photos`.
 * If the DB insert fails, the freshly-uploaded object is best-effort deleted
 * so the bucket doesn't accumulate orphans.
 */
export async function uploadPhoto(
  userId: string,
  buffer: Buffer,
  contentType: string,
  meta: UploadPhotoMeta = {}
): Promise<UploadPhotoResult> {
  const supabase = requireSupabase();

  // Pre-generate the photo id so the storage path and DB row agree even on
  // races (and so we can clean up by path if the insert later fails).
  const photoId = crypto.randomUUID();
  const ext = extensionFor(contentType);
  const path = `${userId}/${photoId}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, buffer, { contentType, upsert: false });

  if (uploadError) {
    throw new Error(`Failed to upload photo: ${uploadError.message}`);
  }

  try {
    await getDb()
      .insert(photos)
      .values({
        id: photoId,
        userId,
        storagePath: path,
        bucket: PHOTO_BUCKET,
        contentType,
        sizeBytes: meta.sizeBytes ?? buffer.byteLength,
        width: meta.width ?? null,
        height: meta.height ?? null,
        caption: meta.caption ?? null,
        takenAt: meta.takenAt ?? new Date(),
        sourceChannel: meta.sourceChannel ?? "telegram",
        sourceMessageId: meta.sourceMessageId ?? null,
      });
  } catch (dbErr) {
    // Best-effort cleanup of the orphaned object.
    try {
      await supabase.storage.from(PHOTO_BUCKET).remove([path]);
    } catch (cleanupErr) {
      console.error(
        "[photos] Storage cleanup after failed DB insert also failed:",
        cleanupErr
      );
    }
    throw dbErr;
  }

  return { path, photoId };
}

/**
 * Generate a short-lived signed URL for a stored photo. Returns null if the
 * photo doesn't exist for this user (defends against cross-user URL guessing).
 */
export async function getPhotoSignedUrl(
  userId: string,
  photoId: string,
  ttlSeconds: number = DEFAULT_SIGNED_URL_TTL_SECONDS
): Promise<string | null> {
  const supabase = requireSupabase();

  const photo = await getPhoto(userId, photoId);
  if (!photo) return null;

  const { data, error } = await supabase.storage
    .from(photo.bucket)
    .createSignedUrl(photo.storagePath, ttlSeconds);
  if (error || !data) {
    console.error("[photos] createSignedUrl failed:", error);
    return null;
  }
  return data.signedUrl;
}

/**
 * List photos for a user, most-recent first.
 *
 * Pure DB read — does not hit Supabase Storage. Useful for the coach tool
 * that needs to find "the most recent" or "the photo closest to date X".
 */
export async function listUserPhotos(
  userId: string,
  opts: ListPhotosOpts = {}
): Promise<Photo[]> {
  const conditions = [eq(photos.userId, userId)];
  if (opts.since) conditions.push(gte(photos.takenAt, new Date(opts.since)));
  if (opts.until) conditions.push(lte(photos.takenAt, new Date(opts.until)));

  return getDb()
    .select()
    .from(photos)
    .where(and(...conditions))
    .orderBy(desc(photos.takenAt))
    .limit(opts.limit ?? 50);
}

/** Fetch a single photo row, scoped by user. */
export async function getPhoto(userId: string, photoId: string): Promise<Photo | null> {
  const rows = await getDb()
    .select()
    .from(photos)
    .where(and(eq(photos.userId, userId), eq(photos.id, photoId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Delete a photo row and its underlying storage object (idempotent). */
export async function deletePhoto(userId: string, photoId: string): Promise<void> {
  const photo = await getPhoto(userId, photoId);
  if (!photo) return;

  // Delete the object first; if it fails, leave the row in place so a retry
  // can re-attempt without an inconsistent DB state.
  const supabase = requireSupabase();
  const { error } = await supabase.storage.from(photo.bucket).remove([photo.storagePath]);
  if (error) {
    throw new Error(`Failed to delete photo object: ${error.message}`);
  }

  await getDb()
    .delete(photos)
    .where(and(eq(photos.userId, userId), eq(photos.id, photoId)));
}
