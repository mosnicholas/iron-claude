/**
 * Express auth middleware.
 *
 * `requireSession` enforces that the request carries a valid Supabase JWT
 * (Authorization header or `sb-access-token` cookie) AND that the Supabase
 * user is linked to a row in our `users` table. On success, the IronClaude
 * user row is attached to `req.user`.
 *
 * `optionalSession` is the same lookup but never rejects the request — it
 * just leaves `req.user` null when auth is missing or invalid. Useful for
 * endpoints that are public but want user context if available.
 */

import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { users } from "../db/schema.js";
import { isSupabaseConfigured, verifyJwt } from "./supabase.js";

const COOKIE_NAME = "sb-access-token";

function extractJwt(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length).trim() || null;
  }
  const cookieJar = (req as Request & { cookies?: Record<string, string> }).cookies;
  if (cookieJar && typeof cookieJar[COOKIE_NAME] === "string") {
    return cookieJar[COOKIE_NAME];
  }
  return null;
}

async function resolveUserFromJwt(jwt: string) {
  const verified = await verifyJwt(jwt);
  if (!verified) return null;
  const db = getDb();
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.supabaseUserId, verified.supabaseUserId))
    .limit(1);
  return { verified, user: rows[0] ?? null };
}

export async function requireSession(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!isSupabaseConfigured()) {
    res.status(503).json({ ok: false, error: "auth not configured" });
    return;
  }

  const jwt = extractJwt(req);
  if (!jwt) {
    res.status(401).json({ ok: false, error: "missing auth token" });
    return;
  }

  try {
    const resolved = await resolveUserFromJwt(jwt);
    if (!resolved) {
      res.status(401).json({ ok: false, error: "invalid auth token" });
      return;
    }
    if (!resolved.user) {
      res.status(403).json({ ok: false, error: "user not yet linked" });
      return;
    }
    req.user = resolved.user;
    next();
  } catch (err) {
    console.error("[auth] requireSession error:", err);
    res.status(401).json({ ok: false, error: "auth failed" });
  }
}
