/**
 * AES-256-GCM helpers for encrypting at-rest secrets like OAuth tokens.
 *
 * The key comes from $INTEGRATION_TOKEN_KEY (base64-encoded 32 bytes). The
 * importer and OAuth flow encrypt tokens before insert; readers decrypt on
 * demand. Format is `v1:<iv_base64>:<tag_base64>:<ciphertext_base64>`.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const VERSION = "v1";

function getKey(): Buffer {
  const raw = process.env.INTEGRATION_TOKEN_KEY;
  if (!raw) throw new Error("INTEGRATION_TOKEN_KEY is not set");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error(`INTEGRATION_TOKEN_KEY must decode to 32 bytes (got ${buf.length})`);
  }
  return buf;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("encrypted payload is not in v1 format");
  }
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const ct = Buffer.from(parts[3], "base64");
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
