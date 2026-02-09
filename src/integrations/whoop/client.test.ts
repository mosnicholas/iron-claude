/**
 * Tests for WhoopClient.fromEnvironment() token refresh and fallback logic
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// Mock oauth module before importing client
jest.unstable_mockModule("./oauth.js", () => ({
  getStoredTokens: jest.fn(),
  getTokensFromGitHub: jest.fn(),
  isTokenExpired: jest.fn(),
  refreshAccessToken: jest.fn(),
  persistTokens: jest.fn(),
}));

const { getStoredTokens, getTokensFromGitHub, isTokenExpired, refreshAccessToken, persistTokens } =
  await import("./oauth.js");
const { WhoopClient } = await import("./client.js");

const mockGetStoredTokens = getStoredTokens as jest.MockedFunction<typeof getStoredTokens>;
const mockGetTokensFromGitHub = getTokensFromGitHub as jest.MockedFunction<
  typeof getTokensFromGitHub
>;
const mockIsTokenExpired = isTokenExpired as jest.MockedFunction<typeof isTokenExpired>;
const mockRefreshAccessToken = refreshAccessToken as jest.MockedFunction<typeof refreshAccessToken>;
const mockPersistTokens = persistTokens as jest.MockedFunction<typeof persistTokens>;

const validTokens = {
  accessToken: "valid-access",
  refreshToken: "valid-refresh",
  expiresAt: Date.now() + 60 * 60 * 1000,
};

const expiredTokens = {
  accessToken: "expired-access",
  refreshToken: "old-refresh",
  expiresAt: Date.now() - 1000,
};

const refreshedTokens = {
  accessToken: "new-access",
  refreshToken: "new-refresh",
  expiresAt: Date.now() + 60 * 60 * 1000,
};

describe("WhoopClient.fromEnvironment", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns client with valid tokens without refreshing", async () => {
    mockGetStoredTokens.mockResolvedValue(validTokens);
    mockIsTokenExpired.mockReturnValue(false);

    const client = await WhoopClient.fromEnvironment();

    expect(client.getTokens()).toEqual(validTokens);
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
  });

  it("throws when no tokens are stored", async () => {
    mockGetStoredTokens.mockResolvedValue(null);

    await expect(WhoopClient.fromEnvironment()).rejects.toThrow("Whoop tokens not configured");
  });

  it("refreshes expired tokens and persists them", async () => {
    mockGetStoredTokens.mockResolvedValue(expiredTokens);
    mockIsTokenExpired.mockReturnValue(true);
    mockRefreshAccessToken.mockResolvedValue(refreshedTokens);
    mockPersistTokens.mockResolvedValue(undefined);

    const client = await WhoopClient.fromEnvironment();

    expect(client.getTokens()).toEqual(refreshedTokens);
    expect(mockRefreshAccessToken).toHaveBeenCalledWith("old-refresh");
    expect(mockPersistTokens).toHaveBeenCalledWith(refreshedTokens);
  });

  it("falls back to GitHub when refresh fails (another instance rotated token)", async () => {
    mockGetStoredTokens.mockResolvedValue(expiredTokens);
    mockIsTokenExpired.mockImplementation((tokens) => tokens.accessToken === "expired-access");
    mockRefreshAccessToken.mockRejectedValue(new Error("invalid_grant"));

    // Another instance already refreshed and persisted to GitHub
    mockGetTokensFromGitHub.mockResolvedValue({
      tokens: refreshedTokens,
      sha: "sha-from-other-instance",
    });

    const client = await WhoopClient.fromEnvironment();

    expect(client.getTokens()).toEqual(refreshedTokens);
    expect(mockGetTokensFromGitHub).toHaveBeenCalled();
  });

  it("throws when refresh fails and GitHub has no valid tokens", async () => {
    mockGetStoredTokens.mockResolvedValue(expiredTokens);
    mockIsTokenExpired.mockReturnValue(true);
    mockRefreshAccessToken.mockRejectedValue(new Error("invalid_grant"));
    mockGetTokensFromGitHub.mockResolvedValue(null);

    await expect(WhoopClient.fromEnvironment()).rejects.toThrow(
      "Whoop token refresh failed and no valid tokens found in GitHub"
    );
  });

  it("throws when refresh fails and GitHub tokens are also expired", async () => {
    mockGetStoredTokens.mockResolvedValue(expiredTokens);
    mockIsTokenExpired.mockReturnValue(true);
    mockRefreshAccessToken.mockRejectedValue(new Error("invalid_grant"));

    // GitHub has tokens but they're expired too
    mockGetTokensFromGitHub.mockResolvedValue({
      tokens: expiredTokens,
      sha: "sha-stale",
    });

    await expect(WhoopClient.fromEnvironment()).rejects.toThrow(
      "Whoop token refresh failed and no valid tokens found in GitHub"
    );
  });
});
