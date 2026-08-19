"use server";

import { redirect } from "next/navigation";
import { clearAuthCookies, getSupabaseAuthClientForPasswordSignIn, setAuthCookies, findAdminUserForAuthUser } from "@/lib/admin-auth";
import { getSafeAuthErrorType, mapAuthError, safeNext } from "@/lib/auth-error-messages";
import { resolveParticipantForAuthUser } from "@/lib/participant-auth";
import { getProgramsForPerson } from "@/lib/participant-programs";
import { resolvePostLogin } from "@/lib/participant-auth-core";

export type LoginActionState = {
  error: string | null;
};

/**
 * The form asks for an email and a password. Everything else is worked out here.
 *
 * Staff are resolved first and keep the behaviour they have always had. Only if
 * there is no `admin_users` row does the participant path run — a mentor or
 * mentee signing in, either after an invitation or by matching the address the
 * programme already holds for them.
 *
 * Where they land is decided by `resolvePostLogin`, which is pure and tested:
 * one programme goes straight in, several show the picker, none says so plainly,
 * and an unrecognised account is refused rather than partially admitted.
 */
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

  // Not staff — try the participant path before refusing. This is the whole of
  // what migration 071 opened up.
  if (!adminUser) {
    const participant = await resolveParticipantForAuthUser(data.user);

    // Say what actually happened. "Contact your organiser" is useful; the
    // generic staff message would send a mentee to the wrong person.
    if (participant.state !== "participant") {
      console.warn("[login] no admin row and no participant link", { state: participant.state });
      await client.auth.signOut();
      await clearAuthCookies();

      if (participant.state === "disabled") {
        return { error: "Tài khoản của bạn đang tạm khoá. Vui lòng liên hệ ban tổ chức." };
      }
      if (participant.state === "unmatched" || participant.state === "ambiguous") {
        return { error: participant.message };
      }
      if (participant.state === "error") {
        return { error: mapAuthError("network_unavailable") };
      }
      return { error: mapAuthError("unauthorized_admin") };
    }

    const programs = await getProgramsForPerson(participant.account.personId);
    const decision = resolvePostLogin({
      hasParticipantAccount: true,
      programs,
      requestedNext: formData.get("next") ? next : null
    });

    await setAuthCookies(data.session.access_token, data.session.refresh_token, data.session.expires_in);
    redirect(decision.redirectTo);
  }

  const decision = resolvePostLogin({
    adminRole: adminUser.role,
    // Programme access for staff comes from admin_scope_access, which the picker
    // itself reads; the decision only needs to know whether to show it.
    requestedNext: formData.get("next") ? next : null
  });

  await setAuthCookies(data.session.access_token, data.session.refresh_token, data.session.expires_in);
  redirect(decision.redirectTo);
}

export async function logoutAction() {
  const client = getSupabaseAuthClientForPasswordSignIn();
  if (client) await client.auth.signOut();
  await clearAuthCookies();
  redirect("/login");
}
