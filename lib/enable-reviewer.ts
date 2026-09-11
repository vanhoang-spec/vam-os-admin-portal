import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canManageReviewers } from "@/lib/permissions";
import { getAuthCallbackUrl } from "@/lib/public-url";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

const SAFE_ERROR = "Không thể cấp quyền tham gia tuyển sinh. Vui lòng thử lại hoặc liên hệ admin.";

/**
 * Hard cap on Auth pages walked while looking for an existing account.
 * GoTrue caps `perPage` server-side (commonly 50) regardless of what we ask
 * for, so we must never infer "no more users" from a short page — only an
 * EMPTY page ends the walk.
 */
const AUTH_PAGE_LIMIT = 200;

export class AuthLookupIncomplete extends Error {
  constructor() {
    super("Auth user directory exceeded the safe pagination limit");
    this.name = "AuthLookupIncomplete";
  }
}

/**
 * Returns the Auth user for `email`, or null when the directory was walked to
 * completion and no such user exists.
 *
 * Throws AuthLookupIncomplete if the page cap is reached while pages are still
 * non-empty. That distinction matters: returning null in that case would make
 * the caller invite an account that may already exist, creating a duplicate
 * identity. We fail closed instead.
 */
/**
 * Tra một hòm thư trong danh bạ Auth, đọc hết mọi trang.
 *
 * Xuất ra để lời mời participant dùng chung — hai phép tra danh bạ Auth là hai
 * chỗ có thể lệch nhau về cách xử lý trang cuối, và lệch ở đó nghĩa là tạo
 * tài khoản thứ hai cho cùng một hòm thư.
 */
export async function findAuthUserByEmail(client: any, email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  for (let page = 1; page <= AUTH_PAGE_LIMIT; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const users = (data?.users ?? []) as Array<{ id: string; email?: string }>;
    // Only an empty page proves the directory is exhausted.
    if (users.length === 0) return null;

    const found = users.find(user => String(user.email ?? "").trim().toLowerCase() === normalizedEmail);
    if (found) return found;
  }
  throw new AuthLookupIncomplete();
}

export type EnableReviewerResult = {
  ok: boolean;
  message: string;
  adminUserId?: string;
  authInvited?: boolean;
};

export async function enableMentorAsReviewer(input: {
  personId: string;
  seasonId: string;
  participationRole: "reviewer" | "interviewer";
}): Promise<EnableReviewerResult> {
  const actor = await getCurrentAdminUser();
  if (!actor?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canManageReviewers(actor.role)) return { ok: false, message: "Bạn không có quyền quản lý reviewer/interviewer." };
  if (!(await canOperateSeason(await getAdminScopeContext(), input.seasonId))) {
    return { ok: false, message: "Bạn không có quyền vận hành mùa này." };
  }
  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };
  const { data: person, error: personError } = await client
    .from("people").select("id,full_name,email_primary").eq("id", input.personId).maybeSingle();
  if (personError || !person) return { ok: false, message: "Không tìm thấy người trong hệ thống." };
  const email = String(person.email_primary ?? "").trim().toLowerCase();
  if (!email.includes("@")) return { ok: false, message: "Người này chưa có email hợp lệ." };

  let authUser: { id: string; email?: string } | null;
  try {
    authUser = await findAuthUserByEmail(client, email);
  } catch (lookupError) {
    // Never fall through to an invite on an inconclusive lookup.
    console.error("[enable-reviewer] auth lookup failed", lookupError);
    return { ok: false, message: SAFE_ERROR };
  }
  let invited = false;
  if (!authUser) {
    // Without an explicit destination Supabase falls back to the project's
    // Site URL, and the tokens arrive in the fragment of whatever page that
    // names. Only /auth/callback can turn them into a session, so the invite
    // has to say so — otherwise the account is created and can never be
    // entered. (The URL must also sit in the project's Redirect Allow List.)
    const redirectTo = await getAuthCallbackUrl();
    const { data, error } = await (client as any).auth.admin.inviteUserByEmail(
      email,
      redirectTo ? { redirectTo } : undefined
    );
    if (error || !data?.user?.id) return { ok: false, message: "Không thể tạo lời mời đăng nhập cá nhân." };
    authUser = data.user;
    invited = true;
  }
  if (!authUser?.id) return { ok: false, message: "Không thể xác định tài khoản Auth cá nhân." };
  const { data, error } = await client.rpc("vam084_grant_recruitment_participation", {
    p_actor: actor.id,
    p_person_id: input.personId,
    p_season_id: input.seasonId,
    p_participation_role: input.participationRole,
    p_auth_user_id: authUser.id,
    p_email: email
  });
  if (error || !data) {
    if (invited) await (client as any).auth.admin.deleteUser(authUser.id);
    console.error("[enable-reviewer] atomic grant failed", error);
    return { ok: false, message: SAFE_ERROR };
  }
  const label = input.participationRole === "reviewer" ? "Reviewer hồ sơ" : "Interviewer";
  return { ok: true, message: `Đã cấp quyền ${label} cho đúng mùa.`, adminUserId: String(data), authInvited: invited };
}

export async function revokeMentorRecruitmentParticipation(input: {
  personId: string;
  seasonId: string;
  participationRole: "reviewer" | "interviewer";
}): Promise<EnableReviewerResult> {
  const actor = await getCurrentAdminUser();
  if (!actor?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canManageReviewers(actor.role)) {
    return { ok: false, message: "Bạn không có quyền quản lý reviewer/interviewer." };
  }
  if (!(await canOperateSeason(await getAdminScopeContext(), input.seasonId))) {
    return { ok: false, message: "Bạn không có quyền vận hành mùa này." };
  }
  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };
  const { data, error } = await client.rpc("vam084_revoke_recruitment_participation", {
    p_actor: actor.id,
    p_person_id: input.personId,
    p_season_id: input.seasonId,
    p_participation_role: input.participationRole
  });
  if (error || !data) {
    console.error("[enable-reviewer] atomic revoke failed", error);
    return { ok: false, message: "Không thể thu hồi quyền tham gia tuyển sinh. Vui lòng thử lại hoặc liên hệ admin." };
  }
  const label = input.participationRole === "reviewer" ? "Reviewer hồ sơ" : "Interviewer";
  return { ok: true, message: `Đã thu hồi quyền ${label} trong đúng mùa.`, adminUserId: String(data) };
}
