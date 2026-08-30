import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canManageReviewers } from "@/lib/permissions";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

const SAFE_ERROR = "Không thể cấp quyền tham gia tuyển sinh. Vui lòng thử lại hoặc liên hệ admin.";

async function findAuthUserByEmail(client: any, email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const users = (data?.users ?? []) as Array<{ id: string; email?: string }>;
    const found = users.find(user => String(user.email ?? "").trim().toLowerCase() === email);
    if (found || users.length < 1000) return found ?? null;
  }
  return null;
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

  let authUser = await findAuthUserByEmail(client, email);
  let invited = false;
  if (!authUser) {
    const { data, error } = await (client as any).auth.admin.inviteUserByEmail(email);
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
