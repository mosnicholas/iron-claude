/**
 * Integration Registry
 *
 * Central registry for all fitness device integrations.
 * Provides discovery and access to configured integrations.
 */

import type { DeviceIntegration, IntegrationMetadata } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Registry State
// ─────────────────────────────────────────────────────────────────────────────

const integrations = new Map<string, DeviceIntegration>();

// ─────────────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register a device integration with the registry.
 * Should be called at app startup for each available integration.
 */
export function registerIntegration(integration: DeviceIntegration): void {
  integrations.set(integration.slug, integration);
}

/**
 * Unregister a device integration (mainly for testing).
 */
export function unregisterIntegration(slug: string): void {
  integrations.delete(slug);
}

// ─────────────────────────────────────────────────────────────────────────────
// Lookup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get a specific integration by slug.
 */
export function getIntegration(slug: string): DeviceIntegration | undefined {
  return integrations.get(slug);
}

/**
 * Get all registered integrations.
 */
export function getAllIntegrations(): DeviceIntegration[] {
  return Array.from(integrations.values());
}

/**
 * Get all integrations that are currently configured (have valid tokens).
 */
export function getConfiguredIntegrations(): DeviceIntegration[] {
  return Array.from(integrations.values()).filter((i) => i.isConfigured());
}

/**
 * Check if any integrations are configured.
 */
export function hasConfiguredIntegrations(): boolean {
  return getConfiguredIntegrations().length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Metadata (for setup UI)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Static metadata for all supported integrations (including "coming soon").
 * Used by setup scripts to show available options.
 */
export const INTEGRATION_METADATA: IntegrationMetadata[] = [
  {
    name: "Whoop",
    slug: "whoop",
    description: "Sleep, recovery scores, strain, and workout data",
    available: true,
    scopes: ["read:recovery", "read:sleep", "read:workout", "read:profile"],
    docsUrl: "https://developer.whoop.com/docs/developing/overview",
  },
  {
    name: "Garmin",
    slug: "garmin",
    description: "Activity, sleep, and heart rate data",
    available: false, // Coming soon
    scopes: [],
    docsUrl: "https://developer.garmin.com/",
  },
  {
    name: "Oura",
    slug: "oura",
    description: "Sleep stages, readiness scores, and activity",
    available: false, // Coming soon
    scopes: [],
    docsUrl: "https://cloud.ouraring.com/docs/",
  },
];

/**
 * Get metadata for available integrations only.
 */
export function getAvailableIntegrations(): IntegrationMetadata[] {
  return INTEGRATION_METADATA.filter((m) => m.available);
}

/**
 * Get metadata for a specific integration.
 */
export function getIntegrationMetadata(slug: string): IntegrationMetadata | undefined {
  return INTEGRATION_METADATA.find((m) => m.slug === slug);
}
