/**
 * Supabase server-side client.
 *
 * Supabase owns the canonical auth state (phone, email, OTP, sessions).
 * We use it for two roles:
 *   - `admin` client (service role key) — verifies JWTs and looks up users
 *     server-to-server. Never exposed to the browser.
 *   - `public` client (anon key) — used to send + verify OTPs from endpoints
 *     called by the web onboarding flow.
 *
 * Phone OTP delivery is configured in the Supabase dashboard (Auth >
 * Providers > Phone, backed by Twilio). We never call Twilio directly.
 */

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

let cachedAdmin: SupabaseClient | null = null;
let cachedPublic: SupabaseClient | null = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

let forceConfiguredForTests: boolean | null = null;

export function isSupabaseConfigured(): boolean {
  if (forceConfiguredForTests !== null) return forceConfiguredForTests;
  return Boolean(
    process.env.SUPABASE_URL &&
      process.env.SUPABASE_ANON_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

/**
 * Test-only: claim Supabase is configured (or not) regardless of env vars.
 * Used alongside `__setJwtVerifierForTests` so e2e tests can stand in for
 * the entire Supabase Auth layer without setting real credentials.
 */
export function __setSupabaseConfiguredForTests(state: boolean | null): void {
  forceConfiguredForTests = state;
}

export function getSupabaseAdmin(): SupabaseClient {
  if (cachedAdmin) return cachedAdmin;
  const url = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  cachedAdmin = createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return cachedAdmin;
}

function getSupabasePublic(): SupabaseClient {
  if (cachedPublic) return cachedPublic;
  const url = requireEnv("SUPABASE_URL");
  const anonKey = requireEnv("SUPABASE_ANON_KEY");
  cachedPublic = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return cachedPublic;
}

export type OtpRequestResult = { ok: true } | { ok: false; error: string };

export async function requestOtp(phoneE164: string): Promise<OtpRequestResult> {
  try {
    const supabase = getSupabasePublic();
    const { error } = await supabase.auth.signInWithOtp({ phone: phoneE164 });
    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type OtpVerifyResult =
  | { ok: true; session: Session; supabaseUserId: string }
  | { ok: false; error: string };

export async function verifyOtp(phoneE164: string, token: string): Promise<OtpVerifyResult> {
  try {
    const supabase = getSupabasePublic();
    const { data, error } = await supabase.auth.verifyOtp({
      phone: phoneE164,
      token,
      type: "sms",
    });
    if (error) {
      return { ok: false, error: error.message };
    }
    if (!data.session || !data.user) {
      return { ok: false, error: "Supabase did not return a session" };
    }
    return { ok: true, session: data.session, supabaseUserId: data.user.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type VerifiedJwt = {
  supabaseUserId: string;
  phone: string | null;
  email: string | null;
};

type JwtVerifier = (jwt: string) => Promise<VerifiedJwt | null>;

const defaultJwtVerifier: JwtVerifier = async (jwt) => {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.auth.getUser(jwt);
    if (error || !data.user) {
      return null;
    }
    return {
      supabaseUserId: data.user.id,
      phone: data.user.phone ?? null,
      email: data.user.email ?? null,
    };
  } catch {
    return null;
  }
};

let jwtVerifierImpl: JwtVerifier = defaultJwtVerifier;

export async function verifyJwt(jwt: string): Promise<VerifiedJwt | null> {
  return jwtVerifierImpl(jwt);
}

/**
 * Test-only: replace the JWT verifier so e2e tests can bypass real Supabase
 * Auth. Pass `null` to restore the default Supabase-backed verifier.
 */
export function __setJwtVerifierForTests(fn: JwtVerifier | null): void {
  jwtVerifierImpl = fn ?? defaultJwtVerifier;
}
