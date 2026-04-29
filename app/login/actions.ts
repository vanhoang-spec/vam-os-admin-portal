"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { clearAuthCookies, getSupabaseAuthClientForPasswordSignIn, getSupabaseAuthClientWithAccessToken, setAuthCookies } from "@/lib/admin-auth";
import { ADMIN_UNLOCK_COOKIE } from "@/lib/password-gate";

export type LoginActionState = {
  error: string | null;
};

function safeNext(value: FormDataEntryValue | null) {
  const next = String(value ?? "/operations");
  if (!next.startsWith("/") || next.startsWith("//")) return "/operations";
  if (next.startsWith("/login") || next.startsWith("/unlock")) return "/operations";
  return next;
}

export async function loginAction(_previousState: LoginActionState, formData: FormData): Promise<LoginActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  if (!email || !password) {
    return { error: "Vui lòng nhập email và mật khẩu." };
  }

  const client = getSupabaseAuthClientForPasswordSignIn();
  if (!client) {
    return { error: "Thiếu cấu hình Supabase. Cần NEXT_PUBLIC_SUPABASE_URL và NEXT_PUBLIC_SUPABASE_ANON_KEY." };
  }

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user.email) {
    await clearAuthCookies();
    return { error: "Đăng nhập không thành công. Vui lòng kiểm tra email/mật khẩu." };
  }

  const authedClient = getSupabaseAuthClientWithAccessToken(data.session.access_token);
  if (!authedClient) {
    await clearAuthCookies();
    return { error: "Thiáº¿u cáº¥u hĂ¬nh Supabase. Cáº§n NEXT_PUBLIC_SUPABASE_URL vĂ  NEXT_PUBLIC_SUPABASE_ANON_KEY." };
  }

  const { data: adminUser, error: adminError } = await authedClient
    .from("admin_users")
    .select("email,status")
    .eq("status", "active")
    .or(`auth_user_id.eq.${data.user.id},email.eq.${data.user.email}`)
    .limit(1)
    .maybeSingle();

  if (adminError || !adminUser) {
    await client.auth.signOut();
    await clearAuthCookies();
    return { error: "Tài khoản này chưa có quyền active trong VAM OS." };
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
  cookies().delete(ADMIN_UNLOCK_COOKIE);
  redirect("/login");
}
