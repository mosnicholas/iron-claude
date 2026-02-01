import {
  registerIntegration,
  unregisterIntegration,
  getIntegration,
  getAllIntegrations,
  getConfiguredIntegrations,
  hasConfiguredIntegrations,
  INTEGRATION_METADATA,
  getAvailableIntegrations,
  getIntegrationMetadata,
} from "./registry.js";
import type { DeviceIntegration } from "./types.js";

// Mock integration for testing
function createMockIntegration(slug: string, configured: boolean = true): DeviceIntegration {
  return {
    name: slug.charAt(0).toUpperCase() + slug.slice(1),
    slug,
    isConfigured: () => configured,
    getAuthUrl: () => "https://example.com/auth",
    handleOAuthCallback: async () => ({
      accessToken: "token",
      refreshToken: "refresh",
      expiresAt: Date.now() + 3600000,
    }),
    refreshToken: async () => ({
      accessToken: "newtoken",
      refreshToken: "newrefresh",
      expiresAt: Date.now() + 3600000,
    }),
    fetchSleep: async () => null,
    fetchRecovery: async () => null,
    fetchWorkouts: async () => [],
    verifyWebhook: () => true,
    parseWebhook: () => null,
  };
}

describe("integration registry", () => {
  // Clean up after each test
  afterEach(() => {
    // Unregister any test integrations
    unregisterIntegration("test-device");
    unregisterIntegration("another-device");
  });

  describe("registerIntegration", () => {
    it("registers an integration", () => {
      const mock = createMockIntegration("test-device");
      registerIntegration(mock);

      const retrieved = getIntegration("test-device");
      expect(retrieved).toBe(mock);
    });

    it("overwrites existing integration with same slug", () => {
      const mock1 = createMockIntegration("test-device");
      const mock2 = createMockIntegration("test-device");

      registerIntegration(mock1);
      registerIntegration(mock2);

      const retrieved = getIntegration("test-device");
      expect(retrieved).toBe(mock2);
    });
  });

  describe("unregisterIntegration", () => {
    it("removes an integration", () => {
      const mock = createMockIntegration("test-device");
      registerIntegration(mock);

      unregisterIntegration("test-device");

      expect(getIntegration("test-device")).toBeUndefined();
    });

    it("does nothing if integration does not exist", () => {
      // Should not throw
      unregisterIntegration("nonexistent");
    });
  });

  describe("getIntegration", () => {
    it("returns undefined for unknown integration", () => {
      expect(getIntegration("unknown")).toBeUndefined();
    });

    it("returns the registered integration", () => {
      const mock = createMockIntegration("test-device");
      registerIntegration(mock);

      expect(getIntegration("test-device")).toBe(mock);
    });
  });

  describe("getAllIntegrations", () => {
    it("returns all registered integrations", () => {
      const mock1 = createMockIntegration("test-device");
      const mock2 = createMockIntegration("another-device");

      registerIntegration(mock1);
      registerIntegration(mock2);

      const all = getAllIntegrations();
      expect(all).toContain(mock1);
      expect(all).toContain(mock2);
    });
  });

  describe("getConfiguredIntegrations", () => {
    it("returns only configured integrations", () => {
      const configured = createMockIntegration("test-device", true);
      const unconfigured = createMockIntegration("another-device", false);

      registerIntegration(configured);
      registerIntegration(unconfigured);

      const result = getConfiguredIntegrations();
      expect(result).toContain(configured);
      expect(result).not.toContain(unconfigured);
    });
  });

  describe("hasConfiguredIntegrations", () => {
    it("returns false when no integrations are configured", () => {
      const unconfigured = createMockIntegration("test-device", false);
      registerIntegration(unconfigured);

      expect(hasConfiguredIntegrations()).toBe(false);
    });

    it("returns true when at least one integration is configured", () => {
      const configured = createMockIntegration("test-device", true);
      registerIntegration(configured);

      expect(hasConfiguredIntegrations()).toBe(true);
    });
  });

  describe("INTEGRATION_METADATA", () => {
    it("contains Whoop metadata", () => {
      const whoop = INTEGRATION_METADATA.find((m) => m.slug === "whoop");
      expect(whoop).toBeDefined();
      expect(whoop?.name).toBe("Whoop");
      expect(whoop?.available).toBe(true);
    });

    // Additional integrations (Garmin, Oura) can be added here when implemented
  });

  describe("getAvailableIntegrations", () => {
    it("returns only available integrations", () => {
      const available = getAvailableIntegrations();

      expect(available.every((m) => m.available)).toBe(true);
      expect(available.some((m) => m.slug === "whoop")).toBe(true);
    });
  });

  describe("getIntegrationMetadata", () => {
    it("returns metadata for known integration", () => {
      const whoop = getIntegrationMetadata("whoop");
      expect(whoop?.name).toBe("Whoop");
    });

    it("returns undefined for unknown integration", () => {
      expect(getIntegrationMetadata("unknown")).toBeUndefined();
    });
  });
});
