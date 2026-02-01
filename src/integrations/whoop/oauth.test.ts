/**
 * Tests for Whoop OAuth helpers
 */

import fs from "node:fs";
import {
  getAuthorizationUrl,
  isWhoopOAuthConfigured,
  getStoredTokens,
  isTokenExpired,
  persistTokens,
  clearPersistedTokens,
  DEFAULT_SCOPES,
} from "./oauth.js";

describe("Whoop OAuth", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    // Clean up any test token files
    try {
      if (fs.existsSync("/tmp/test-whoop-tokens.json")) {
        fs.unlinkSync("/tmp/test-whoop-tokens.json");
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("isWhoopOAuthConfigured", () => {
    it("returns false when credentials are not set", () => {
      delete process.env.WHOOP_CLIENT_ID;
      delete process.env.WHOOP_CLIENT_SECRET;

      expect(isWhoopOAuthConfigured()).toBe(false);
    });

    it("returns false when only client ID is set", () => {
      process.env.WHOOP_CLIENT_ID = "test-id";
      delete process.env.WHOOP_CLIENT_SECRET;

      expect(isWhoopOAuthConfigured()).toBe(false);
    });

    it("returns true when both credentials are set", () => {
      process.env.WHOOP_CLIENT_ID = "test-id";
      process.env.WHOOP_CLIENT_SECRET = "test-secret";

      expect(isWhoopOAuthConfigured()).toBe(true);
    });
  });

  describe("getStoredTokens", () => {
    it("returns null when no tokens are configured", () => {
      delete process.env.WHOOP_ACCESS_TOKEN;
      delete process.env.WHOOP_REFRESH_TOKEN;

      expect(getStoredTokens()).toBe(null);
    });

    it("returns tokens from environment variables", () => {
      process.env.WHOOP_ACCESS_TOKEN = "test-access";
      process.env.WHOOP_REFRESH_TOKEN = "test-refresh";
      process.env.WHOOP_TOKEN_EXPIRES = "1234567890000";

      const tokens = getStoredTokens();

      expect(tokens).toEqual({
        accessToken: "test-access",
        refreshToken: "test-refresh",
        expiresAt: 1234567890000,
      });
    });

    it("defaults expiresAt to 0 when not set", () => {
      process.env.WHOOP_ACCESS_TOKEN = "test-access";
      process.env.WHOOP_REFRESH_TOKEN = "test-refresh";
      delete process.env.WHOOP_TOKEN_EXPIRES;

      const tokens = getStoredTokens();

      expect(tokens?.expiresAt).toBe(0);
    });
  });

  describe("isTokenExpired", () => {
    it("returns true when expiresAt is 0", () => {
      const unsetTokens = {
        accessToken: "test",
        refreshToken: "test",
        expiresAt: 0,
      };

      expect(isTokenExpired(unsetTokens)).toBe(true);
    });

    it("returns true when token is expired", () => {
      const expiredTokens = {
        accessToken: "test",
        refreshToken: "test",
        expiresAt: Date.now() - 1000, // 1 second ago
      };

      expect(isTokenExpired(expiredTokens)).toBe(true);
    });

    it("returns true when token expires within 5 minutes", () => {
      const soonToExpireTokens = {
        accessToken: "test",
        refreshToken: "test",
        expiresAt: Date.now() + 4 * 60 * 1000, // 4 minutes from now
      };

      expect(isTokenExpired(soonToExpireTokens)).toBe(true);
    });

    it("returns false when token is valid", () => {
      const validTokens = {
        accessToken: "test",
        refreshToken: "test",
        expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes from now
      };

      expect(isTokenExpired(validTokens)).toBe(false);
    });
  });

  describe("getAuthorizationUrl", () => {
    beforeEach(() => {
      process.env.WHOOP_CLIENT_ID = "test-client-id";
      process.env.WHOOP_CLIENT_SECRET = "test-secret";
    });

    it("generates correct authorization URL", () => {
      const url = getAuthorizationUrl("https://example.com/callback");

      expect(url).toContain("https://api.prod.whoop.com/oauth/oauth2/auth");
      expect(url).toContain("client_id=test-client-id");
      expect(url).toContain("redirect_uri=https%3A%2F%2Fexample.com%2Fcallback");
      expect(url).toContain("response_type=code");
    });

    it("includes default scopes", () => {
      const url = getAuthorizationUrl("https://example.com/callback");

      // URL encoding may vary (%3A vs :, + vs %20), so just check the scope names are present
      for (const scope of DEFAULT_SCOPES) {
        // Check that either the encoded or decoded version is in the URL
        const scopeName = scope.split(":")[1]; // e.g., "recovery" from "read:recovery"
        expect(url).toContain(scopeName);
      }
    });

    it("includes custom scopes when provided", () => {
      const url = getAuthorizationUrl("https://example.com/callback", ["read:profile"]);

      expect(url).toContain("scope=read%3Aprofile");
    });

    it("includes state parameter when provided", () => {
      const url = getAuthorizationUrl("https://example.com/callback", DEFAULT_SCOPES, "test-state");

      expect(url).toContain("state=test-state");
    });
  });

  describe("token persistence", () => {
    beforeEach(() => {
      process.env.WHOOP_TOKEN_FILE = "/tmp/test-whoop-tokens.json";
    });

    it("persists and loads tokens from file", () => {
      const tokens = {
        accessToken: "persisted-access",
        refreshToken: "persisted-refresh",
        expiresAt: 9999999999999,
      };

      persistTokens(tokens);

      // Clear env vars to ensure we're loading from file
      delete process.env.WHOOP_ACCESS_TOKEN;
      delete process.env.WHOOP_REFRESH_TOKEN;
      delete process.env.WHOOP_TOKEN_EXPIRES;

      // Need to re-import to pick up the new file
      const loaded = getStoredTokens();

      expect(loaded).toEqual(tokens);
    });

    it("clears persisted tokens", () => {
      const tokens = {
        accessToken: "to-clear",
        refreshToken: "to-clear",
        expiresAt: 9999999999999,
      };

      persistTokens(tokens);
      clearPersistedTokens();

      // Clear env vars
      delete process.env.WHOOP_ACCESS_TOKEN;
      delete process.env.WHOOP_REFRESH_TOKEN;
      delete process.env.WHOOP_TOKEN_EXPIRES;

      const loaded = getStoredTokens();
      expect(loaded).toBe(null);
    });
  });
});
