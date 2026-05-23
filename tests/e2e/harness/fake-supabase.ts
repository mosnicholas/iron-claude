/**
 * Fake Supabase Auth — replaces verifyJwt with a deterministic verifier
 * that decodes a test JWT of the form `Bearer test:<userId>:<phone>`.
 *
 * Production verifyJwt round-trips to Supabase's `/auth/v1/user`. We don't
 * want that in tests. Instead we register a custom verifier via
 * `__setJwtVerifierForTests` that pulls user identity from a known token
 * format the harness mints.
 */

import {
  __setJwtVerifierForTests,
  __setSupabaseConfiguredForTests,
  type VerifiedJwt,
} from "../../../src/auth/supabase.js";

const TEST_TOKEN_PREFIX = "test:";

export function installFakeSupabase(): void {
  __setSupabaseConfiguredForTests(true);
  __setJwtVerifierForTests(async (jwt) => {
    if (!jwt.startsWith(TEST_TOKEN_PREFIX)) return null;
    const [, supabaseUserId, phone] = jwt.split(":");
    if (!supabaseUserId) return null;
    return {
      supabaseUserId,
      phone: phone ?? null,
      email: null,
    } satisfies VerifiedJwt;
  });
}

export function uninstallFakeSupabase(): void {
  __setJwtVerifierForTests(null);
  __setSupabaseConfiguredForTests(null);
}

/**
 * Build a test JWT for the given Supabase user id. Harness clients pass
 * this in the Authorization header (or `sb-access-token` cookie) and the
 * verifier above accepts it.
 */
export function mintTestJwt(opts: { supabaseUserId: string; phone?: string }): string {
  return `${TEST_TOKEN_PREFIX}${opts.supabaseUserId}${opts.phone ? `:${opts.phone}` : ""}`;
}
