/**
 * Subscription tiers.
 *
 * The `users.tier` column carries the *stored* tier; `effectiveTier(user)`
 * derives the runtime tier (e.g. a `trial` user whose `trial_ends_at` is in
 * the past is effectively `expired`). All gating code should call
 * `effectiveTier`, never read `user.tier` directly.
 *
 * Tier semantics:
 *   - trial    — Full coaching for 30 days from signup. Auto-flips to
 *                "expired" via the trial-expiry cron once trial_ends_at passes.
 *   - expired  — Read-only. Coaching turns return "subscribe to continue".
 *   - regular  — Unlimited turns, all integrations, Haiku/Sonnet model.
 *                No photos.
 *   - athlete  — Everything in regular + photos + Opus + higher rate ceiling.
 *   - comped   — Same capabilities as athlete; never downgraded by Stripe.
 *                Admin grants this via scripts/grant-tier.ts which also sets
 *                `tier_overridden_by_admin = true`.
 */

import type { User } from "../db/schema.js";

export type Tier = "trial" | "expired" | "regular" | "athlete" | "comped";

export type Feature = "coaching" | "photos" | "opus" | "integrations";

const KNOWN_TIERS: ReadonlySet<Tier> = new Set([
  "trial",
  "expired",
  "regular",
  "athlete",
  "comped",
]);

export function isTier(value: unknown): value is Tier {
  return typeof value === "string" && KNOWN_TIERS.has(value as Tier);
}

/**
 * Resolve the runtime tier for a user.
 *
 * - If the stored tier is `trial` and `trial_ends_at` is in the past, return
 *   `expired`. The trial-expiry cron will later persist this so downstream
 *   queries see it too, but we don't rely on the cron running on time.
 * - Otherwise, return the stored tier (defaulting to `trial` if the column
 *   is somehow unrecognized — defensive fallback for forward-compatibility).
 */
export function effectiveTier(user: Pick<User, "tier" | "trialEndsAt">): Tier {
  const stored = isTier(user.tier) ? user.tier : "trial";
  if (stored === "trial") {
    const ends = user.trialEndsAt instanceof Date ? user.trialEndsAt : new Date(user.trialEndsAt);
    if (Number.isFinite(ends.getTime()) && ends.getTime() < Date.now()) {
      return "expired";
    }
  }
  return stored;
}

/**
 * Feature gate. The matrix below is the locked tier design — keep this in
 * sync with the docs in src/auth/tiers.ts top-of-file and CLAUDE.md.
 *
 * - coaching: trial, regular, athlete, comped (expired = read-only)
 * - integrations: trial, regular, athlete, comped
 * - photos: trial, athlete, comped (regular does NOT include photos)
 * - opus: trial (during the trial they get the full experience), athlete,
 *         comped. Regular uses Sonnet.
 */
export function tierAllows(tier: Tier, feature: Feature): boolean {
  switch (feature) {
    case "coaching":
      return tier === "trial" || tier === "regular" || tier === "athlete" || tier === "comped";
    case "integrations":
      return tier === "trial" || tier === "regular" || tier === "athlete" || tier === "comped";
    case "photos":
      return tier === "trial" || tier === "athlete" || tier === "comped";
    case "opus":
      return tier === "trial" || tier === "athlete" || tier === "comped";
    default:
      return false;
  }
}

/**
 * Express middleware: 402 Payment Required if the user's effective tier is
 * not in the allowed set. Assumes `requireSession` has already populated
 * `req.user`.
 */
import type { NextFunction, Request, Response } from "express";

export function requireTier(
  ...allowed: Tier[]
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ ok: false, error: "not authenticated" });
      return;
    }
    const tier = effectiveTier(user);
    if (!allowed.includes(tier)) {
      res.status(402).json({ ok: false, error: "subscription required", tier });
      return;
    }
    next();
  };
}
