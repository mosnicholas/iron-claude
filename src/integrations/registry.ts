/**
 * Integration Registry
 *
 * Stores per-device factories that build a `DeviceIntegration` for a given
 * `userId`. The factory pattern lets us:
 *   - Verify webhooks and build OAuth URLs without a user (calls with no
 *     userId get a default user-agnostic instance).
 *   - Fetch tokens / data per-user by calling `getIntegration(slug, userId)`.
 *
 * `registerIntegrationFactory` is called once at boot per device. Anything
 * that touches `users.id`-keyed data must pass `userId`.
 */

import type { DeviceIntegration, IntegrationMetadata } from "./types.js";

type IntegrationFactory = (userId?: string) => DeviceIntegration;

const factories = new Map<string, IntegrationFactory>();

export function registerIntegrationFactory(slug: string, factory: IntegrationFactory): void {
  factories.set(slug, factory);
}

export function unregisterIntegrationFactory(slug: string): void {
  factories.delete(slug);
}

/**
 * Resolve an integration for a specific user (or user-agnostic if `userId`
 * is omitted — e.g. for webhook signature verification).
 *
 * `slug` is gated against the static `INTEGRATION_METADATA` allowlist
 * before the factory call so an attacker-controlled URL `:device` param
 * can never reach a factory we didn't intend to expose. (Without this
 * gate the `factories.get(slug)` lookup already returns undefined for
 * unknown slugs — but CodeQL's "unvalidated dynamic dispatch" check
 * doesn't reason about Map semantics, and the explicit allowlist is a
 * cleaner second line of defense as we add more integrations.)
 */
export function getIntegration(slug: string, userId?: string): DeviceIntegration | undefined {
  if (!isKnownIntegrationSlug(slug)) return undefined;
  const factory = factories.get(slug);
  return factory ? factory(userId) : undefined;
}

function isKnownIntegrationSlug(slug: string): boolean {
  return INTEGRATION_METADATA.some((m) => m.slug === slug);
}

export function getRegisteredSlugs(): string[] {
  return Array.from(factories.keys());
}

export function getAllIntegrationsForUser(userId: string): DeviceIntegration[] {
  return Array.from(factories.values()).map((f) => f(userId));
}

export function getConfiguredIntegrationsForUser(userId: string): DeviceIntegration[] {
  return getAllIntegrationsForUser(userId).filter((i) => i.isConfigured());
}

export function hasConfiguredIntegrationsForUser(userId: string): boolean {
  return getConfiguredIntegrationsForUser(userId).length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Static metadata (for setup UI)
// ─────────────────────────────────────────────────────────────────────────────

export const INTEGRATION_METADATA: IntegrationMetadata[] = [
  {
    name: "Whoop",
    slug: "whoop",
    description: "Sleep, recovery scores, strain, and workout data",
    available: true,
    scopes: ["read:recovery", "read:sleep", "read:workout", "read:profile"],
    docsUrl: "https://developer.whoop.com/docs/developing/overview",
  },
];

export function getAvailableIntegrations(): IntegrationMetadata[] {
  return INTEGRATION_METADATA.filter((m) => m.available);
}

export function getIntegrationMetadata(slug: string): IntegrationMetadata | undefined {
  return INTEGRATION_METADATA.find((m) => m.slug === slug);
}
