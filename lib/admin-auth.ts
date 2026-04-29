import { createHash } from "crypto";
import { cookies } from "next/headers";
import { createClient, type User } from "@supabase/supabase-js";
import { ADMIN_UNLOCK_COOKIE, ADMIN_UNLOCK_SALT } from "@/lib/password-gate";
import { supabase, supabaseAnonKey, supabaseUrl } from "@/lib/supabase";
import { AUTH_ACCESS_COOKIE, AUTH_REFRESH_COOKIE, type CurrentAdminUser } from "@/lib/auth-constants";

type AdminUserRow = {
  auth_user_id: string | null;
  email: string;
  full_name: string | null;
  role: CurrentAdminUser["role"];
  status: CurrentAdminUser["status"];
};

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
  if (error) return null;
  return data.user ?? null;
}

async function findAdminUserForAuthUser(user: User): Promise<AdminUserRow | null> {
  if (!supabase || !user.email) return null;

  const { data, error } = await supabase
    .from("admin_users")
    .select("auth_user_id,email,full_name,role,status")
    .eq("status", "active")
    .or(`auth_user_id.eq.${user.id},email.eq.${user.email}`)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as AdminUserRow;
  if (!row.auth_user_id) {
    await supabase
      .from("admin_users")
      .update({ auth_user_id: user.id })
      .eq("email", row.email)
      .is("auth_user_id", null);
    row.auth_user_id = user.id;
  }

  return row;
}

export async function getCurrentAdminUser(): Promise<CurrentAdminUser | null> {
  const authUser = await getCurrentSupabaseAuthUser();
  if (authUser) {
    const adminUser = await findAdminUserForAuthUser(authUser);
    if (adminUser) {
      return {
        email: adminUser.email,
        full_name: adminUser.full_name,
        role: adminUser.role,
        status: adminUser.status,
        auth_user_id: adminUser.auth_user_id
      };
    }
  }

  return null;
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
