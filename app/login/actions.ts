"use server";

import { redirect } from "next/navigation";
import { clearAuthCookies, getSupabaseAuthClientForPasswordSignIn, setAuthCookies, findAdminUserForAuthUser } from "@/lib/admin-auth";
import { getSafeAuthErrorType, mapAuthError, safeNext } from "@/lib/auth-error-messages";

export type LoginActionState = {
  error: string | null;
};

export async function loginAction(_previousState: LoginActionState, formData: FormData): Promise<LoginActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  if (!email || !password) {
    return { error: "Vui lòng nhập email và mật khẩu." };
  }

  const client = getSupabaseAuthClientForPasswordSignIn();
  if (!client) {
    return { error: mapAuthError("network_unavailable") };
  }

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user.email) {
    console.warn("[login] Supabase signInWithPassword failed", {
      errorName: error?.name ?? null,
      errorStatus: error?.status ?? null
    });
    await clearAuthCookies();
    return { error: mapAuthError(getSafeAuthErrorType(error)) };
  }

  let adminUser = null;
  try {
    adminUser = await findAdminUserForAuthUser(data.user);
  } catch (err: any) {
    console.warn("[login] identity linking or resolution failed", err.message);
    await client.auth.signOut();
    await clearAuthCookies();
    return { error: mapAuthError("unauthorized_admin") };
  }

  if (!adminUser) {
    console.warn("[login] active admin_users lookup failed (no match)");
    await client.auth.signOut();
    await clearAuthCookies();
    return { error: mapAuthError("unauthorized_admin") };
  }

  await setAuthCookies(data.session.access_token, data.session.refresh_token, data.session.expires_in);
  redirect(next);
}

export async function logoutAction() {
  const client = getSupabaseAuthClientForPasswordSignIn();
  if (client) await client.auth.signOut();
  await clearAuthCookies();
  redirect("/login");
}
