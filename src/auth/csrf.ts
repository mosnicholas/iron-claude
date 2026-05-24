/**
 * CSRF guard for state-changing endpoints that accept cookie auth.
 *
 * Strategy: SameSite=Lax cookies (set by handlers/auth.ts) already drop the
 * `sb-access-token` cookie on cross-site form POSTs. This middleware is the
 * second line of defense — it rejects cross-site mutating requests by
 * checking the browser-set `Sec-Fetch-Site` header (or, on legacy clients,
 * `Origin`/`Referer`).
 *
 * Authorization-header callers (mobile/SDK) are exempt: an attacker can't
 * make a victim's browser auto-include an `Authorization` header from a
 * cross-site context, so the cookie-only attack surface doesn't apply.
 */

import type { NextFunction, Request, Response } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function csrfGuard(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  // Authorization-header path is exempt — browsers don't auto-attach the
  // header on cross-site requests.
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) {
    next();
    return;
  }

  const fetchSite = req.headers["sec-fetch-site"];
  if (typeof fetchSite === "string") {
    // Modern browsers populate this. Allow same-origin, same-site, and
    // direct user navigation ("none"). Reject "cross-site".
    if (fetchSite === "same-origin" || fetchSite === "same-site" || fetchSite === "none") {
      next();
      return;
    }
    res.status(403).json({ ok: false, error: "cross-site request blocked" });
    return;
  }

  // Older browsers without Sec-Fetch-Site: fall back to Origin / Referer.
  const origin = (req.headers.origin as string | undefined) ?? null;
  const referer = (req.headers.referer as string | undefined) ?? null;
  const host = (req.headers["x-forwarded-host"] as string | undefined) ?? req.headers.host ?? null;

  if (!host) {
    res.status(403).json({ ok: false, error: "missing host header" });
    return;
  }

  const matchesHost = (url: string | null): boolean => {
    if (!url) return false;
    try {
      const u = new URL(url);
      return u.host === host;
    } catch {
      return false;
    }
  };

  if (matchesHost(origin) || matchesHost(referer)) {
    next();
    return;
  }

  res.status(403).json({ ok: false, error: "cross-site request blocked" });
}
