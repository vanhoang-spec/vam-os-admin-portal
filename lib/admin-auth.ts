import { createHash } from "crypto";
import { cookies } from "next/headers";
import { createClient, type User } from "@supabase/supabase-js";
import { ADMIN_UNLOCK_COOKIE, ADMIN_UNLOCK_SALT } from "@/lib/password-gate";
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

function passwordGateToken(password: string) {
  return createHash("sha256").update(`${ADMIN_UNLOCK_SALT}:${password}`).digest("hex");
}

export function hasPasswordGateFallback() {
  const configuredPassword = process.env.VAM_OS_ADMIN_PASSWORD;
  if (!configuredPassword) return false;
  return cookies().get(ADMIN_UNLOCK_COOKIE)?.value === passwordGateToken(configuredPassword);
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
  const accessToken = cookies().get(AUTH_ACCESS_COOKIE)?.value;
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
 *   - row genuinely not found → return null (legitimate "not an
 *                               admin" — caller treats as denied)
 *   - row found → return it
 */
async function findAdminUserForAuthUser(user: User): Promise<AdminUserRow | null> {
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

  const { data, error } = await client
    .from("admin_users")
    .select("id,auth_user_id,email,full_name,role,status")
    .eq("status", "active")
    .or(orFilter)
    .limit(2);

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

  // If auth_user_id-linked and email-only rows BOTH exist, always
  // prefer the auth_user_id-linked one — it is the authoritative
  // identity and avoids the historical "stale viewer row wins" bug.
  const linked = rows.find((row) => row.auth_user_id === user.id) ?? null;
  const emailMatch = rows.find((row) => !row.auth_user_id && row.email === user.email) ?? null;
  const row = linked ?? emailMatch;

  if (!row) {
    console.warn("[admin-auth] admin_users rows present but none matched the auth user identity", {
      rowsSeen: rows.length
    });
    return null;
  }

  // First-login backfill: link the email-seeded row to this auth user.
  if (!row.auth_user_id) {
    const { error: updateError } = await client
      .from("admin_users")
      .update({ auth_user_id: user.id })
      .eq("email", row.email)
      .is("auth_user_id", null);
    if (updateError) {
      logAdminAuthError("admin_users auth_user_id backfill failed", updateError);
      throw new Error(`[admin-auth] failed to link admin_users to auth user: ${updateError.message}`);
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
  cookies().delete(AUTH_ACCESS_COOKIE);
  cookies().delete(AUTH_REFRESH_COOKIE);
}

export async function setAuthCookies(accessToken: string, refreshToken: string, maxAge: number) {
  const secure = process.env.NODE_ENV === "production";
  cookies().set(AUTH_ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge
  });
  cookies().set(AUTH_REFRESH_COOKIE, refreshToken, {
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
