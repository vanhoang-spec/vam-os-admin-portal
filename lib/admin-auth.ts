import { cookies } from "next/headers";
import { createClient, type User } from "@supabase/supabase-js";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase";
import { getSupabaseServiceRoleClient, getSupabaseServiceRoleEnvStatus } from "@/lib/supabase-server";
import { AUTH_ACCESS_COOKIE, AUTH_REFRESH_COOKIE, type CurrentAdminUser } from "@/lib/auth-constants";

type AdminUserRow = {
  id: string;
  auth_user_id: string | null;
  email: string;
  full_name: string | null;
  role: CurrentAdminUser["role"];
  status: CurrentAdminUser["status"];
};

function logAdminAuthError(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string; details?: string };
  console.error("[admin-auth]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint,
    details: err?.details
  });
}

function authClient(accessToken?: string) {
  if (!supabaseUrl || !supabaseAnonKey) return null;
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" })
    }
  });
}

export async function getCurrentSupabaseAuthUser(): Promise<User | null> {
  const accessToken = (await cookies()).get(AUTH_ACCESS_COOKIE)?.value;
  if (!accessToken) return null;

  const client = authClient(accessToken);
  if (!client) return null;

  const { data, error } = await client.auth.getUser();
  if (error) {
    logAdminAuthError("getUser failed", error);
    return null;
  }
  return data.user ?? null;
}

/**
 * Server-side resolver: given a Supabase Auth user, return the
 * matching active row in `public.admin_users`.
 *
 * IMPORTANT: this MUST use the service-role client. The
 * `admin_users` table has RLS enabled (migration 018) which only
 * lets a user read their own row when `auth.uid() = auth_user_id`.
 * Reading via the anon-bearer client therefore silently returned
 * null in any of these failure modes:
 *   - the row's `auth_user_id` didn't match (e.g. duplicate row,
 *     stale link, just-edited via the dashboard)
 *   - PostgREST cache lag right after an insert/update
 *   - any other RLS edge case
 * That silent null then propagated up as "no role" and the entire
 * UI degraded to the viewer-equivalent state — the exact bug
 * report we are fixing here.
 *
 * Failure policy:
 *   - DB / config error  → THROW (caller must surface a 500;
 *                          no silent viewer fallback)
 *   - ambiguous identity → THROW. More than one active row linked to
 *                          the same auth user, or more than one
 *                          unlinked row for the same normalized
 *                          email, means the data is corrupt. We never
 *                          pick one arbitrarily: the chosen row's
 *                          `role` would decide the granted privilege.
 *   - identity-link race lost → THROW (see the backfill block below)
 *   - row genuinely not found → return null (legitimate "not an
 *                               admin" — caller treats as denied)
 *   - row found → return it
 */
export async function findAdminUserForAuthUser(user: User): Promise<AdminUserRow | null> {
  const client = getSupabaseServiceRoleClient();
  if (!client) {
    const status = getSupabaseServiceRoleEnvStatus();
    logAdminAuthError("service-role client unavailable for admin_users lookup", status);
    throw new Error(
      "[admin-auth] Cannot resolve admin role: SUPABASE_SERVICE_ROLE_KEY is missing or misconfigured. " +
        "Check the service-role env var on the server."
    );
  }
  if (!user.email && !user.id) {
    throw new Error("[admin-auth] Supabase auth user has neither id nor email — cannot resolve admin role.");
  }

  // Prefer auth_user_id match (single source of truth once linked).
  // Fall back to email match for the first-login backfill case where
  // the admin_users row was seeded by email and has no auth_user_id yet.
  const filterParts: string[] = [];
  if (user.id) filterParts.push(`auth_user_id.eq.${user.id}`);
  if (user.email) filterParts.push(`email.eq.${user.email}`);
  const orFilter = filterParts.join(",");

  // limit(3) rather than limit(2): with at most one legitimate linked row and
  // at most one legitimate legacy row, a third row can only mean the data is
  // corrupt. Reading one extra row is what makes that corruption *detectable*
  // instead of being silently truncated away by the limit itself.
  const { data, error } = await client
    .from("admin_users")
    .select("id,auth_user_id,email,full_name,role,status")
    .eq("status", "active")
    .or(orFilter)
    .limit(3);

  if (error) {
    logAdminAuthError("admin_users lookup failed", error);
    throw new Error(`[admin-auth] admin_users lookup failed: ${error.message}`);
  }

  const rows = (data ?? []) as AdminUserRow[];
  if (rows.length === 0) {
    console.warn("[admin-auth] no active admin_users row for auth user", {
      hasAuthUserId: Boolean(user.id),
      hasEmail: Boolean(user.email)
    });
    return null;
  }

  // Partition explicitly into the two identity classes. `find()` is
  // deliberately NOT used here: taking the first element would silently pick an
  // arbitrary row when the data is ambiguous, and that row's `role` is what
  // determines the privilege level the session is granted.
  //
  // Database uniqueness invariant this relies on:
  //   `admin_users.email` is NOT NULL UNIQUE (migration 017) and the live shape
  //   keys the table on email, so at most one row can match a given normalized
  //   email. `admin_users.auth_user_id` has only a NON-unique index, so the DB
  //   does not by itself prevent two rows sharing one auth user.
  // We do not trust either invariant at runtime. If the data ever violates them
  // (corruption, a relaxed constraint, a partial migration, a bad backfill) we
  // fail closed rather than authorize against an arbitrarily chosen row.
  const linkedRows = rows.filter((row) => Boolean(row.auth_user_id) && row.auth_user_id === user.id);
  const legacyRows = rows.filter(
    (row) => !row.auth_user_id && Boolean(user.email) && row.email === user.email
  );

  if (linkedRows.length > 1) {
    console.warn("[admin-auth] ambiguous identity: multiple active rows linked to one auth user", {
      linkedRowsSeen: linkedRows.length
    });
    throw new Error("[admin-auth] ambiguous admin identity: multiple rows linked to this auth user");
  }

  // Only relevant when no linked row exists — if the authoritative linked row is
  // present it wins outright and duplicate legacy rows are irrelevant.
  if (linkedRows.length === 0 && legacyRows.length > 1) {
    console.warn("[admin-auth] ambiguous identity: multiple unlinked rows for one normalized email", {
      legacyRowsSeen: legacyRows.length
    });
    throw new Error("[admin-auth] ambiguous admin identity: multiple legacy rows for this email");
  }

  // If a linked row and a legacy row BOTH exist, always prefer the linked one —
  // it is the authoritative identity and avoids the historical
  // "stale viewer row wins" bug.
  const row = linkedRows[0] ?? legacyRows[0] ?? null;

  if (!row) {
    console.warn("[admin-auth] admin_users rows present but none matched the auth user identity", {
      rowsSeen: rows.length
    });
    return null;
  }

  // First-login backfill: link the email-seeded row to this auth user.
  if (!row.auth_user_id) {
    const { data: updatedRows, error: updateError } = await client
      .from("admin_users")
      .update({ auth_user_id: user.id })
      .eq("id", row.id)
      .is("auth_user_id", null)
      .select("id");

    if (updateError) {
      logAdminAuthError("admin_users auth_user_id backfill failed", updateError);
      throw new Error(`[admin-auth] failed to link admin_users to auth user: ${updateError.message}`);
    }

    if (!updatedRows || updatedRows.length === 0) {
      // 0 rows updated, meaning auth_user_id is no longer null (race condition)
      // Re-read row
      const { data: reReadData, error: reReadError } = await client
        .from("admin_users")
        .select("auth_user_id")
        .eq("id", row.id)
        .maybeSingle();

      if (reReadError) {
        logAdminAuthError("admin_users auth_user_id re-read failed", reReadError);
        throw new Error(`[admin-auth] failed to re-read admin_users after race: ${reReadError.message}`);
      }

      if (!reReadData || reReadData.auth_user_id !== user.id) {
        // deny access if it is linked to any different UUID or result remains missing
        console.warn("[admin-auth] identity link race lost or row missing", {
          expectedAuthUserId: user.id,
          actualAuthUserId: reReadData?.auth_user_id
        });
        throw new Error("[admin-auth] identity link conflict");
      }
    }

    row.auth_user_id = user.id;
  }

  return row;
}

/**
 * Returns the current admin user resolved via Supabase Auth.
 *
 *   - null  → the visitor has no Supabase session OR has no
 *             active admin_users row (legitimate "not an admin").
 *             Callers should treat this as denied.
 *   - throws → real failure (missing env, DB error, mis-linked
 *             rows). NOT silently demoted to viewer — the previous
 *             silent fallback was the exact bug being fixed.
 */
export async function getCurrentAdminUser(): Promise<CurrentAdminUser | null> {
  const authUser = await getCurrentSupabaseAuthUser();
  if (!authUser) return null;

  const adminUser = await findAdminUserForAuthUser(authUser);
  if (!adminUser) return null;

  return {
    id: adminUser.id,
    email: adminUser.email,
    full_name: adminUser.full_name,
    role: adminUser.role,
    status: adminUser.status,
    auth_user_id: adminUser.auth_user_id
  };
}

export async function clearAuthCookies() {
  const jar = await cookies();
  jar.delete(AUTH_ACCESS_COOKIE);
  jar.delete(AUTH_REFRESH_COOKIE);
}

export async function setAuthCookies(accessToken: string, refreshToken: string, maxAge: number) {
  const secure = process.env.NODE_ENV === "production";
  const jar = await cookies();
  jar.set(AUTH_ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge
  });
  jar.set(AUTH_REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });
}

export function getSupabaseAuthClientForPasswordSignIn() {
  return authClient();
}

export function getSupabaseAuthClientWithAccessToken(accessToken: string) {
  return authClient(accessToken);
}
