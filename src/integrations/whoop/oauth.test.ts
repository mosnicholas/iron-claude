/**
 * Tests for Whoop OAuth helpers
 */

import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";

// Mock GitHub storage before importing oauth module
jest.unstable_mockModule("../../storage/github.js", () => ({
  createGitHubStorage: jest.fn(),
}));

// Dynamic imports after mock setup (required for ESM mocking)
const { createGitHubStorage } = await import("../../storage/github.js");
const {
  getAuthorizationUrl,
  isWhoopOAuthConfigured,
  getStoredTokens,
  isTokenExpired,
  persistTokens,
  getTokensFromGitHub,
  saveTokensToGitHub,
  _resetTokenCache,
  DEFAULT_SCOPES,
} = await import("./oauth.js");

const mockCreateGitHubStorage = createGitHubStorage as jest.MockedFunction<
  typeof createGitHubStorage
>;

function createMockStorage(fileData: { content: string; sha: string } | null = null) {
  return {
    readFileWithSha: jest.fn().mockResolvedValue(fileData as never),
    writeFileWithSha: jest
      .fn()
      .mockResolvedValue({ commit: { sha: "new" }, content: { sha: "new" } } as never),
  } as unknown as ReturnType<typeof createGitHubStorage>;
}

describe("Whoop OAuth", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    _resetTokenCache();
  });

  afterEach(() => {
    process.env = originalEnv;
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
    it("returns null when no tokens exist in GitHub", async () => {
      const mockStorage = createMockStorage(null);
      mockCreateGitHubStorage.mockReturnValue(mockStorage);

      const tokens = await getStoredTokens();
      expect(tokens).toBe(null);
    });

    it("returns tokens from GitHub", async () => {
      const tokenData = {
        content: JSON.stringify({
          accessToken: "test-access",
          refreshToken: "test-refresh",
          expiresAt: Date.now() + 60 * 60 * 1000, // 1 hour from now
          updatedAt: "2026-02-09T12:00:00Z",
        }),
        sha: "abc123",
      };
      const mockStorage = createMockStorage(tokenData);
      mockCreateGitHubStorage.mockReturnValue(mockStorage);

      const tokens = await getStoredTokens();

      expect(tokens).toEqual({
        accessToken: "test-access",
        refreshToken: "test-refresh",
        expiresAt: expect.any(Number),
      });
    });
  });

  describe("getTokensFromGitHub", () => {
    it("returns tokens and SHA for optimistic locking", async () => {
      const tokenData = {
        content: JSON.stringify({
          accessToken: "gh-access",
          refreshToken: "gh-refresh",
          expiresAt: 9999999999999,
          updatedAt: "2026-02-09T12:00:00Z",
        }),
        sha: "sha-123",
      };
      const mockStorage = createMockStorage(tokenData);
      mockCreateGitHubStorage.mockReturnValue(mockStorage);

      const result = await getTokensFromGitHub();

      expect(result).toEqual({
        tokens: {
          accessToken: "gh-access",
          refreshToken: "gh-refresh",
          expiresAt: 9999999999999,
        },
        sha: "sha-123",
      });
    });

    it("returns null when file does not exist", async () => {
      const mockStorage = createMockStorage(null);
      mockCreateGitHubStorage.mockReturnValue(mockStorage);

      const result = await getTokensFromGitHub();
      expect(result).toBe(null);
    });
  });

  describe("saveTokensToGitHub", () => {
    it("writes tokens with SHA for optimistic locking", async () => {
      const mockStorage = createMockStorage();
      mockCreateGitHubStorage.mockReturnValue(mockStorage);

      const tokens = {
        accessToken: "new-access",
        refreshToken: "new-refresh",
        expiresAt: 9999999999999,
      };

      await saveTokensToGitHub(tokens, "old-sha");

      expect(mockStorage.writeFileWithSha).toHaveBeenCalledWith(
        "state/whoop/tokens.json",
        expect.stringContaining("new-access"),
        "Update Whoop tokens",
        "old-sha"
      );
    });
  });

  describe("persistTokens", () => {
    it("writes tokens to GitHub", async () => {
      const mockStorage = createMockStorage({
        content: JSON.stringify({
          accessToken: "old",
          refreshToken: "old",
          expiresAt: 0,
          updatedAt: "",
        }),
        sha: "existing-sha",
      });
      mockCreateGitHubStorage.mockReturnValue(mockStorage);

      const tokens = {
        accessToken: "persist-access",
        refreshToken: "persist-refresh",
        expiresAt: 9999999999999,
      };

      await persistTokens(tokens);

      expect(mockStorage.writeFileWithSha).toHaveBeenCalled();
    });
  });

  describe("in-memory caching", () => {
    it("uses cached tokens on second call when still valid", async () => {
      const tokenData = {
        content: JSON.stringify({
          accessToken: "cached-access",
          refreshToken: "cached-refresh",
          expiresAt: Date.now() + 60 * 60 * 1000,
          updatedAt: "2026-02-09T12:00:00Z",
        }),
        sha: "sha-1",
      };
      const mockStorage = createMockStorage(tokenData);
      mockCreateGitHubStorage.mockReturnValue(mockStorage);

      // First call reads from GitHub
      const first = await getStoredTokens();
      expect(first?.accessToken).toBe("cached-access");
      expect(mockStorage.readFileWithSha).toHaveBeenCalledTimes(1);

      // Second call should use cache - reset mock to verify no new calls
      (mockStorage.readFileWithSha as jest.Mock).mockClear();
      const second = await getStoredTokens();
      expect(second?.accessToken).toBe("cached-access");
      expect(mockStorage.readFileWithSha).not.toHaveBeenCalled();
    });

    it("re-reads from GitHub when cached token is expired", async () => {
      // First: seed the cache with an expired token via persistTokens
      const expiredTokens = {
        accessToken: "expired-access",
        refreshToken: "expired-refresh",
        expiresAt: Date.now() - 1000, // already expired
      };
      const mockStorage1 = createMockStorage({
        content: JSON.stringify({ ...expiredTokens, updatedAt: "" }),
        sha: "sha-old",
      });
      mockCreateGitHubStorage.mockReturnValue(mockStorage1);
      await persistTokens(expiredTokens); // sets cache to expired tokens

      // Now set up GitHub to return fresh tokens
      const freshData = {
        content: JSON.stringify({
          accessToken: "fresh-access",
          refreshToken: "fresh-refresh",
          expiresAt: Date.now() + 60 * 60 * 1000,
          updatedAt: "2026-02-09T13:00:00Z",
        }),
        sha: "sha-new",
      };
      const mockStorage2 = createMockStorage(freshData);
      mockCreateGitHubStorage.mockReturnValue(mockStorage2);

      // getStoredTokens should skip cache (expired) and read from GitHub
      const result = await getStoredTokens();
      expect(result?.accessToken).toBe("fresh-access");
      expect(mockStorage2.readFileWithSha).toHaveBeenCalled();
    });
  });

  describe("persistTokens resilience", () => {
    it("does not throw on GitHub write failure (SHA mismatch)", async () => {
      const mockStorage = {
        readFileWithSha: jest.fn().mockResolvedValue({
          content: JSON.stringify({
            accessToken: "old",
            refreshToken: "old",
            expiresAt: 0,
            updatedAt: "",
          }),
          sha: "stale-sha",
        } as never),
        writeFileWithSha: jest.fn().mockRejectedValue(new Error("409 Conflict") as never),
      } as unknown as ReturnType<typeof createGitHubStorage>;
      mockCreateGitHubStorage.mockReturnValue(mockStorage);

      const tokens = {
        accessToken: "race-winner",
        refreshToken: "race-refresh",
        expiresAt: Date.now() + 60 * 60 * 1000,
      };

      // Should not throw despite GitHub write failure
      await expect(persistTokens(tokens)).resolves.toBeUndefined();
    });

    it("updates in-memory cache even when GitHub write fails", async () => {
      const mockStorage = {
        readFileWithSha: jest.fn().mockResolvedValue({
          content: JSON.stringify({
            accessToken: "old",
            refreshToken: "old",
            expiresAt: 0,
            updatedAt: "",
          }),
          sha: "stale-sha",
        } as never),
        writeFileWithSha: jest.fn().mockRejectedValue(new Error("409 Conflict") as never),
      } as unknown as ReturnType<typeof createGitHubStorage>;
      mockCreateGitHubStorage.mockReturnValue(mockStorage);

      const tokens = {
        accessToken: "cached-despite-failure",
        refreshToken: "cached-refresh",
        expiresAt: Date.now() + 60 * 60 * 1000,
      };

      await persistTokens(tokens);

      // Cache should have the new tokens, so getStoredTokens() returns them
      // without hitting GitHub (cache hit)
      (mockStorage.readFileWithSha as jest.Mock).mockClear();
      const cached = await getStoredTokens();
      expect(cached?.accessToken).toBe("cached-despite-failure");
      expect(mockStorage.readFileWithSha).not.toHaveBeenCalled();
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
        // Handle scopes like "read:recovery" and simple scopes like "offline"
        const scopeName = scope.includes(":") ? scope.split(":")[1] : scope;
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
});
