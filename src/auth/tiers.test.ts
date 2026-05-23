/**
 * Tier helper unit tests.
 *
 * Covers:
 *   - `effectiveTier` honors `trial_ends_at` (trial → expired when past)
 *   - `effectiveTier` returns the stored tier for non-trial users
 *   - Admin override (comped) takes precedence over any auto-flip
 *   - `tierAllows` matrix matches the locked design
 */

import { effectiveTier, tierAllows, type Tier } from "./tiers.js";
import type { User } from "../db/schema.js";

function mkUser(over: Partial<User>): User {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    supabaseUserId: null,
    phoneE164: "+15555550100",
    displayName: null,
    timezone: "America/New_York",
    active: true,
    tier: "trial",
    trialStartedAt: new Date(Date.now() - 1000),
    trialEndsAt: new Date(Date.now() + 30 * 86400000),
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    tierOverriddenByAdmin: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as User;
}

describe("effectiveTier", () => {
  it("returns trial when within the trial window", () => {
    const u = mkUser({ tier: "trial", trialEndsAt: new Date(Date.now() + 86_400_000) });
    expect(effectiveTier(u)).toBe("trial");
  });

  it("returns expired when trial has elapsed", () => {
    const u = mkUser({ tier: "trial", trialEndsAt: new Date(Date.now() - 86_400_000) });
    expect(effectiveTier(u)).toBe("expired");
  });

  it("returns stored tier for non-trial users regardless of trialEndsAt", () => {
    const u = mkUser({ tier: "regular", trialEndsAt: new Date(Date.now() - 86_400_000) });
    expect(effectiveTier(u)).toBe("regular");
  });

  it("honors comped even when trial is technically over", () => {
    const u = mkUser({
      tier: "comped",
      tierOverriddenByAdmin: true,
      trialEndsAt: new Date(Date.now() - 86_400_000),
    });
    expect(effectiveTier(u)).toBe("comped");
  });

  it("falls back to trial when tier value is unrecognized", () => {
    const u = mkUser({ tier: "bogus" as Tier, trialEndsAt: new Date(Date.now() + 86_400_000) });
    expect(effectiveTier(u)).toBe("trial");
  });
});

describe("tierAllows", () => {
  it("coaching: trial, regular, athlete, comped", () => {
    expect(tierAllows("trial", "coaching")).toBe(true);
    expect(tierAllows("regular", "coaching")).toBe(true);
    expect(tierAllows("athlete", "coaching")).toBe(true);
    expect(tierAllows("comped", "coaching")).toBe(true);
    expect(tierAllows("expired", "coaching")).toBe(false);
  });

  it("photos: trial, athlete, comped only (regular excluded)", () => {
    expect(tierAllows("trial", "photos")).toBe(true);
    expect(tierAllows("regular", "photos")).toBe(false);
    expect(tierAllows("athlete", "photos")).toBe(true);
    expect(tierAllows("comped", "photos")).toBe(true);
    expect(tierAllows("expired", "photos")).toBe(false);
  });

  it("opus: trial, athlete, comped only", () => {
    expect(tierAllows("trial", "opus")).toBe(true);
    expect(tierAllows("regular", "opus")).toBe(false);
    expect(tierAllows("athlete", "opus")).toBe(true);
    expect(tierAllows("comped", "opus")).toBe(true);
    expect(tierAllows("expired", "opus")).toBe(false);
  });

  it("integrations: trial, regular, athlete, comped (not expired)", () => {
    expect(tierAllows("trial", "integrations")).toBe(true);
    expect(tierAllows("regular", "integrations")).toBe(true);
    expect(tierAllows("athlete", "integrations")).toBe(true);
    expect(tierAllows("comped", "integrations")).toBe(true);
    expect(tierAllows("expired", "integrations")).toBe(false);
  });
});
