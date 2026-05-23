/**
 * Auth HTTP handlers.
 *
 * Express endpoints that drive the web onboarding OTP flow. Supabase Auth
 * generates + verifies the OTP itself (Twilio under the hood); we just bind
 * the resulting Supabase user to an IronClaude `users` row and set session
 * cookies.
 *
 *   POST /api/auth/otp/request  body {phone}             → triggers SMS
 *   POST /api/auth/otp/verify   body {phone, token}       → exchanges OTP for session
 *   POST /api/auth/signout                                  → clears cookies
 *   GET  /api/me                                            → current user (requireSession)
 *
 * Mount these from server.ts. We deliberately don't touch server.ts here —
 * the main agent wires the routes.
 */

import type { Request, Response, RequestHandler } from "express";
import { findOrCreateUserByPhone } from "../auth/identity.js";
import { requireSession } from "../auth/middleware.js";
import { getSupabaseAdmin, isSupabaseConfigured, requestOtp, verifyOtp } from "../auth/supabase.js";
import type { User } from "../db/schema.js";

const E164_REGEX = /^\+[1-9]\d{6,14}$/;

function userPayload(user: User): {
  id: string;
  phone: string;
  displayName: string | null;
  timezone: string;
} {
  return {
    id: user.id,
    phone: user.phoneE164,
    displayName: user.displayName,
    timezone: user.timezone,
  };
}

function setSessionCookies(
  res: Response,
  accessToken: string,
  refreshToken: string,
  expiresInSeconds: number
): void {
  const secure = process.env.NODE_ENV === "production";
  const accessMaxAge = Math.max(0, expiresInSeconds) * 1000;
  res.cookie("sb-access-token", accessToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge: accessMaxAge,
    path: "/",
  });
  // Refresh tokens are longer-lived; let them ride the browser session by
  // default (no maxAge means session cookie). Supabase rotates them on
  // refresh, so we don't need a hard expiry here.
  res.cookie("sb-refresh-token", refreshToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
  });
}

function clearSessionCookies(res: Response): void {
  res.clearCookie("sb-access-token", { path: "/" });
  res.clearCookie("sb-refresh-token", { path: "/" });
}

export const otpRequestHandler: RequestHandler = async (req, res) => {
  if (!isSupabaseConfigured()) {
    res.status(503).json({ ok: false, error: "auth not configured" });
    return;
  }
  const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
  if (!E164_REGEX.test(phone)) {
    res.status(400).json({ ok: false, error: "phone must be E.164 (e.g. +14155551234)" });
    return;
  }
  const result = await requestOtp(phone);
  if (!result.ok) {
    res.status(400).json({ ok: false, error: result.error });
    return;
  }
  res.json({ ok: true });
};

export const otpVerifyHandler: RequestHandler = async (req, res) => {
  if (!isSupabaseConfigured()) {
    res.status(503).json({ ok: false, error: "auth not configured" });
    return;
  }
  const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  if (!E164_REGEX.test(phone)) {
    res.status(400).json({ ok: false, error: "phone must be E.164" });
    return;
  }
  if (!token) {
    res.status(400).json({ ok: false, error: "token is required" });
    return;
  }

  const result = await verifyOtp(phone, token);
  if (!result.ok) {
    res.status(401).json({ ok: false, error: result.error });
    return;
  }

  const user = await findOrCreateUserByPhone(phone, result.supabaseUserId);
  setSessionCookies(
    res,
    result.session.access_token,
    result.session.refresh_token,
    result.session.expires_in ?? 3600
  );
  res.json({ ok: true, user: userPayload(user) });
};

export const signoutHandler: RequestHandler = async (req, res) => {
  const auth = req.headers.authorization;
  const headerJwt = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : null;
  const cookieJar = (req as Request & { cookies?: Record<string, string> }).cookies;
  const cookieJwt = cookieJar?.["sb-access-token"] ?? null;
  const jwt = headerJwt || cookieJwt;

  if (jwt && isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseAdmin();
      await supabase.auth.admin.signOut(jwt);
    } catch (err) {
      console.error("[auth] signOut error:", err);
    }
  }
  clearSessionCookies(res);
  res.json({ ok: true });
};

export const meHandler: RequestHandler = (req, res) => {
  const user = req.user;
  if (!user) {
    // requireSession should have caught this — belt and suspenders.
    res.status(401).json({ ok: false, error: "not authenticated" });
    return;
  }
  res.json({ ok: true, user: userPayload(user) });
};

/**
 * Convenience export so server.ts can mount everything in one shot:
 *
 *   app.post("/api/auth/otp/request", authRoutes.otpRequest);
 *   app.post("/api/auth/otp/verify",  authRoutes.otpVerify);
 *   app.post("/api/auth/signout",     authRoutes.signout);
 *   app.get ("/api/me", authRoutes.requireSession, authRoutes.me);
 */
export const authRoutes = {
  otpRequest: otpRequestHandler,
  otpVerify: otpVerifyHandler,
  signout: signoutHandler,
  me: meHandler,
  requireSession,
};
