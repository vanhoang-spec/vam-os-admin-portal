/**
 * Edge-safe trusted-server resolution of the active `admin_users` row.
 *
 * WHY THIS EXISTS
 * ---------------
 * Production release S12 / T2 removed SELECT on `public.admin_users` from
 * both `anon` and `authenticated` (RLS enabled, zero policies). Measured on
 * Production after T2:
 *
 *   authenticated_can_select_admin_users = false
 *   anon_can_select_admin_users          = false
 *   service_role_can_select_admin_users  = true
 *   rls_enabled = true, policy_count = 0
 *
 * The previous middleware resolved the active-admin row by querying
 * `/rest/v1/admin_users` with the anon apikey and the *user's* access token,
 * i.e. as `authenticated`. Post-T2 that request is refused, middleware read
 * the refusal as "not an admin", and every protected navigation bounced back
 * to /login — the production redirect loop.
 *
 * This module restores compatibility WITHOUT weakening T2: the table stays
 * unreadable to anon/authenticated, and the lookup is instead performed in
 * trusted server context with the service-role credential.
 *
 * SECURITY INVARIANTS (each has a regression test)
 * ------------------------------------------------
 * 1. Server-only. This module is imported exclusively by `middleware.ts`,
 *    which Next.js never emits into a client bundle. The credential is read
 *    from `SUPABASE_SERVICE_ROLE_KEY` — no `NEXT_PUBLIC_` prefix, so Next
 *    cannot inline it into browser JavaScript.
 * 2. Fails CLOSED. Missing URL, missing service-role key, a service-role key
 *    that is actually the anon/publishable key, a non-ok PostgREST response,
 *    a malformed body, or a thrown fetch all deny the request.
 * 3. No user-controlled lookup parameters. The ONLY inputs are `id` and
 *    `email` taken from the Supabase Auth `/auth/v1/user` response for an
 *    already-validated access token. Both are re-validated against strict
 *    allowlist patterns here before reaching PostgREST, because service role
 *    bypasses RLS and an unvalidated value interpolated into a filter would
 *    be a table-disclosure vector.
 * 4. No ambiguous identity match. `service_role` bypasses RLS, so a row is
 *    only accepted when it belongs to THIS user: either linked
 *    (`auth_user_id = user.id`) or a genuinely unlinked legacy row
 *    (`auth_user_id IS NULL AND email = user.email`). More than one candidate
 *    denies rather than picking arbitrarily — the chosen row would otherwise
 *    decide the granted privilege. This mirrors `findAdminUserForAuthUser`
 *    in `lib/admin-auth.ts`.
 * 5. `status=eq.active` is always required — inactive admins stay denied.
 * 6. The credential is never logged, never returned, and never placed in a
 *    response body or header.
 *
 * RUNTIME NOTE: Next 14 middleware runs on the Edge runtime. This module
 * therefore uses bare `fetch` only — no `next/headers`, no `server-only`, no
 * `@supabase/supabase-js`.
 */

export const SERVICE_ROLE_ENV_NAME = "SUPABASE_SERVICE_ROLE_KEY";

type EnvLike = Record<string, string | undefined>;

/** Supabase Auth user ids are UUIDs. Anything else is rejected outright. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Deliberately an allowlist, not a denylist. PostgREST treats `,` `(` `)` `"`
 * and whitespace as filter syntax; under service role a crafted value could
 * otherwise widen the query. Every character permitted here is inert inside a
 * `column=eq.<value>` term.
 */
const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export type TrustedCredentialResolution =
  | { ok: true; supabaseUrl: string; serviceRoleKey: string }
  | { ok: false; reason: TrustedCredentialFailure };

export type TrustedCredentialFailure =
  | "missing_supabase_url"
  | "missing_service_role_key"
  | "service_role_key_equals_anon_key"
  | "service_role_key_is_publishable_key";

export type AdminLookupDecision = {
  allowed: boolean;
  /** Coarse, secret-free reason retained for diagnostics and tests. */
  reason:
    | "active_admin_linked"
    | "active_admin_legacy_email"
    | TrustedCredentialFailure
    | "invalid_user_identity"
    | "lookup_request_failed"
    | "lookup_response_malformed"
    | "ambiguous_identity"
    | "no_active_admin_row";
};

/**
 * Resolves the trusted server credential, refusing any credential that is not
 * actually privileged.
 *
 * The `service_role_key_equals_anon_key` and `..._is_publishable_key` checks
 * exist because a misconfigured deployment that pasted the anon key into
 * SUPABASE_SERVICE_ROLE_KEY would, post-T2, produce exactly the same silent
 * "no admin row" answer as a genuine non-admin — turning a config error back
 * into the redirect loop instead of a diagnosable refusal.
 */
export function resolveTrustedCredential(env: EnvLike): TrustedCredentialResolution {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = (env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)?.trim();
  const serviceRoleKey = env[SERVICE_ROLE_ENV_NAME]?.trim();

  if (!supabaseUrl) return { ok: false, reason: "missing_supabase_url" };
  if (!serviceRoleKey) return { ok: false, reason: "missing_service_role_key" };
  if (anonKey && serviceRoleKey === anonKey) {
    return { ok: false, reason: "service_role_key_equals_anon_key" };
  }
  if (serviceRoleKey.startsWith("sb_publishable_")) {
    return { ok: false, reason: "service_role_key_is_publishable_key" };
  }

  return { ok: true, supabaseUrl, serviceRoleKey };
}

/**
 * True for the reasons that mean "this deployment cannot authorize ANYONE",
 * as opposed to an ordinary per-user denial. Callers use it to emit a
 * secret-free operational alarm; the reason values are fixed literals.
 */
export function isTrustedCredentialMisconfiguration(
  reason: AdminLookupDecision["reason"]
): boolean {
  return (
    reason === "missing_supabase_url" ||
    reason === "missing_service_role_key" ||
    reason === "service_role_key_equals_anon_key" ||
    reason === "service_role_key_is_publishable_key"
  );
}

type AdminUserRow = {
  auth_user_id: string | null;
  email: string | null;
  status: string | null;
};

/**
 * `limit=3` rather than `limit=1`: at most one linked row and one legacy row
 * are legitimate, so a third can only mean corrupt data. Reading one extra row
 * is what makes ambiguity *detectable* instead of silently truncated away.
 */
const ROW_LIMIT = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseRows(payload: unknown): AdminUserRow[] | null {
  if (!Array.isArray(payload)) return null;
  return payload.map((entry) => {
    const row = isRecord(entry) ? entry : {};
    return {
      auth_user_id: typeof row.auth_user_id === "string" ? row.auth_user_id : null,
      email: typeof row.email === "string" ? row.email : null,
      status: typeof row.status === "string" ? row.status : null
    };
  });
}

/**
 * Performs the active-admin lookup in trusted server context.
 *
 * `user` MUST be the parsed response of a successful `/auth/v1/user` call for
 * the caller's access token — never values taken from the request URL, body or
 * headers.
 */
export async function resolveActiveAdminViaTrustedServer(
  user: { id?: string | null; email?: string | null },
  env: EnvLike,
  fetchImpl: typeof fetch
): Promise<AdminLookupDecision> {
  const credential = resolveTrustedCredential(env);
  if (!credential.ok) return { allowed: false, reason: credential.reason };

  const userId = user.id?.trim();
  const userEmail = user.email?.trim();

  // RC3 required BOTH a user id and an email before consulting admin_users.
  // That precondition is preserved exactly — this hotfix changes which
  // credential performs the lookup, not who is eligible for one.
  if (!userId || !userEmail || !UUID_PATTERN.test(userId) || !EMAIL_PATTERN.test(userEmail)) {
    return { allowed: false, reason: "invalid_user_identity" };
  }

  const headers = {
    apikey: credential.serviceRoleKey,
    Authorization: `Bearer ${credential.serviceRoleKey}`,
    Accept: "application/json"
  };

  const query = async (filter: string): Promise<AdminUserRow[] | null> => {
    let response: Response;
    try {
      response = await fetchImpl(
        `${credential.supabaseUrl}/rest/v1/admin_users` +
          `?select=auth_user_id,email,status&status=eq.active&${filter}&limit=${ROW_LIMIT}`,
        { headers, cache: "no-store" }
      );
    } catch {
      return null;
    }
    if (!response.ok) return null;
    try {
      return parseRows(await response.json());
    } catch {
      return null;
    }
  };

  // Stage 1 — authoritative linked identity.
  const linkedRows = await query(`auth_user_id=eq.${encodeURIComponent(userId)}`);
  if (linkedRows === null) return { allowed: false, reason: "lookup_request_failed" };

  const linked = linkedRows.filter((row) => row.status === "active" && row.auth_user_id === userId);
  if (linked.length > 1) return { allowed: false, reason: "ambiguous_identity" };
  if (linked.length === 1) return { allowed: true, reason: "active_admin_linked" };

  // Stage 2 — first-login legacy row seeded by email and not yet linked.
  // Restricted to `auth_user_id IS NULL` so an email colliding with a row that
  // belongs to a DIFFERENT auth user can never authorize this session.
  const legacyRows = await query(
    `email=eq.${encodeURIComponent(userEmail)}&auth_user_id=is.null`
  );
  if (legacyRows === null) return { allowed: false, reason: "lookup_request_failed" };

  const legacy = legacyRows.filter(
    (row) => row.status === "active" && row.auth_user_id === null && row.email === userEmail
  );
  if (legacy.length > 1) return { allowed: false, reason: "ambiguous_identity" };
  if (legacy.length === 1) return { allowed: true, reason: "active_admin_legacy_email" };

  return { allowed: false, reason: "no_active_admin_row" };
}
