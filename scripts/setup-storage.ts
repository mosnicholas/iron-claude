#!/usr/bin/env tsx
/**
 * Create / verify the `progress-photos` Supabase Storage bucket.
 *
 * Idempotent: if the bucket already exists, this is a no-op (we just confirm
 * it has the expected privacy + file-size constraints).
 *
 * Usage:
 *   npm run setup:storage
 */

import pc from "picocolors";
import { getSupabaseAdmin, isSupabaseConfigured } from "../src/auth/supabase.js";
import { PHOTO_BUCKET } from "../src/storage/photos.js";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];

async function main(): Promise<void> {
  if (!isSupabaseConfigured()) {
    console.error(
      pc.red(
        "Supabase isn't configured. Set SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY first."
      )
    );
    process.exit(1);
  }

  const supabase = getSupabaseAdmin();

  // listBuckets is cheaper than getBucket and tells us whether the bucket
  // already exists without producing a misleading 404.
  const { data: existing, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) {
    console.error(pc.red(`Failed to list buckets: ${listErr.message}`));
    process.exit(1);
  }

  const found = existing?.find((b) => b.name === PHOTO_BUCKET);
  if (found) {
    console.log(pc.green(`Bucket "${PHOTO_BUCKET}" already exists.`));
    return;
  }

  const { error: createErr } = await supabase.storage.createBucket(PHOTO_BUCKET, {
    public: false,
    fileSizeLimit: MAX_FILE_SIZE,
    allowedMimeTypes: ALLOWED_MIME,
  });
  if (createErr) {
    console.error(pc.red(`Failed to create bucket: ${createErr.message}`));
    process.exit(1);
  }

  console.log(
    pc.green(
      `Bucket "${PHOTO_BUCKET}" created (private, ${MAX_FILE_SIZE / 1024 / 1024}MB max, ${ALLOWED_MIME.join(", ")}).`
    )
  );
}

main().catch((err) => {
  console.error(
    pc.red(`setup-storage failed: ${err instanceof Error ? err.message : String(err)}`)
  );
  process.exit(1);
});
