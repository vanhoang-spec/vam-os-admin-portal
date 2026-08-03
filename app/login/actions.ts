"use server";

import { redirect } from "next/navigation";
import { clearAuthCookies, getSupabaseAuthClientForPasswordSignIn, getSupabaseAuthClientWithAccessToken, setAuthCookies } from "@/lib/admin-auth";
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

  const authedClient = getSupabaseAuthClientWithAccessToken(data.session.access_token);
  if (!authedClient) {
    await clearAuthCookies();
    return { error: mapAuthError("network_unavailable") };
  }

  const { data: adminUser, error: adminError } = await authedClient
    .from("admin_users")
    .select("email,status")
    .eq("status", "active")
    .or(`auth_user_id.eq.${data.user.id},email.eq.${data.user.email}`)
    .limit(1)
    .maybeSingle();

  if (adminError || !adminUser) {
    console.warn("[login] active admin_users lookup failed", {
      errorName: adminError?.code ?? null
    });
    await client.auth.signOut();
    await clearAuthCookies();
    return { error: mapAuthError("unauthorized_admin") };
  }

  await authedClient
    .from("admin_users")
    .update({ auth_user_id: data.user.id })
    .eq("email", data.user.email)
    .is("auth_user_id", null);

  await setAuthCookies(data.session.access_token, data.session.refresh_token, data.session.expires_in);
  redirect(next);
}

export async function logoutAction() {
  const client = getSupabaseAuthClientForPasswordSignIn();
  if (client) await client.auth.signOut();
  await clearAuthCookies();
  redirect("/login");
}
