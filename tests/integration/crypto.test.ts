/**
 * Crypto (encryptSecret/decryptSecret) round-trip tests.
 */

import { randomBytes } from "crypto";
import { encryptSecret, decryptSecret } from "../../src/crypto/secrets.js";

const ORIGINAL_KEY = process.env.INTEGRATION_TOKEN_KEY;

function setKey(): void {
  process.env.INTEGRATION_TOKEN_KEY = randomBytes(32).toString("base64");
}

describe("crypto/secrets", () => {
  beforeAll(() => {
    setKey();
  });
  afterAll(() => {
    if (ORIGINAL_KEY === undefined) {
      delete process.env.INTEGRATION_TOKEN_KEY;
    } else {
      process.env.INTEGRATION_TOKEN_KEY = ORIGINAL_KEY;
    }
  });

  it("round-trips a plaintext through encrypt/decrypt", () => {
    const plaintext = "hello world";
    const ct = encryptSecret(plaintext);
    expect(decryptSecret(ct)).toBe(plaintext);
  });

  it("uses the v1 format", () => {
    const ct = encryptSecret("x");
    expect(ct.startsWith("v1:")).toBe(true);
    expect(ct.split(":")).toHaveLength(4);
  });

  it("produces a different ciphertext per call (random IV)", () => {
    const a = encryptSecret("same");
    const b = encryptSecret("same");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same");
    expect(decryptSecret(b)).toBe("same");
  });

  it("rejects a tampered ciphertext (auth tag mismatch)", () => {
    const ct = encryptSecret("secret");
    // Flip a bit in the ciphertext portion (last segment).
    const parts = ct.split(":");
    const bytes = Buffer.from(parts[3], "base64");
    bytes[0] = bytes[0] ^ 0x01;
    parts[3] = bytes.toString("base64");
    const tampered = parts.join(":");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("rejects payloads in the wrong format", () => {
    expect(() => decryptSecret("not-v1:foo")).toThrow(/v1 format/);
    expect(() => decryptSecret("v2:a:b:c")).toThrow(/v1 format/);
  });

  it("rejects key that doesn't decode to 32 bytes", () => {
    const saved = process.env.INTEGRATION_TOKEN_KEY;
    try {
      process.env.INTEGRATION_TOKEN_KEY = Buffer.from("too-short").toString(
        "base64"
      );
      expect(() => encryptSecret("x")).toThrow(/32 bytes/);
    } finally {
      process.env.INTEGRATION_TOKEN_KEY = saved;
    }
  });

  it("requires the key env var to be set", () => {
    const saved = process.env.INTEGRATION_TOKEN_KEY;
    try {
      delete process.env.INTEGRATION_TOKEN_KEY;
      expect(() => encryptSecret("x")).toThrow(/INTEGRATION_TOKEN_KEY/);
    } finally {
      process.env.INTEGRATION_TOKEN_KEY = saved;
    }
  });
});
