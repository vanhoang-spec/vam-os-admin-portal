"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canAccessAdminUser } from "@/lib/permissions";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import {
  confirmRenewalAndApprove,
  createRenewalInvite,
  regenerateRenewalInvite,
  revokeRenewalInvite,
  submitRenewalAccepted,
  submitRenewalDeclined,
  type RenewalAdminActionState,
  type RenewalConfirmationIntent,
  type RenewalPublicActionState
} from "@/lib/renewal-runtime";
import { SEASON_CONFIG } from "@/lib/season-config";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

import { isValidUuid } from "@/lib/events";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function adminFail(message: string): RenewalAdminActionState {
  return { ok: false, message };
}

async function authorizedOperator(seasonId: string) {
  const context = await getAdminScopeContext();
  const admin = context.adminUser ?? (await getCurrentAdminUser());
  if (
    !admin?.id ||
    admin.status !== "active" ||
    !canAccessAdminUser(admin.role) ||
    !(await canOperateSeason(context, seasonId))
  ) {
    return null;
  }
  return admin;
}

async function scopedInvite(inviteId: string) {
  if (!isValidUuid(inviteId)) return null;
  const client = getSupabaseServiceRoleClient();
  if (!client) return null;
  const { data, error } = await client
    .from("person_season_invites")
    .select("id,season_id")
    .eq("id", inviteId)
    .maybeSingle();
  if (error || !data) return null;
  const admin = await authorizedOperator(String(data.season_id));
  return admin ? { admin, client } : null;
}

export async function acceptRenewalAction(
  rawToken: string,
  _previous: RenewalPublicActionState,
  formData: FormData
): Promise<RenewalPublicActionState> {
  return submitRenewalAccepted(rawToken, formData);
}

export async function declineRenewalAction(
  rawToken: string,
  _previous: RenewalPublicActionState,
  formData: FormData
): Promise<RenewalPublicActionState> {
  return submitRenewalDeclined(rawToken, formData);
}

export async function createRenewalInviteAction(
  _previous: RenewalAdminActionState,
  formData: FormData
): Promise<RenewalAdminActionState> {
  try {
    const personId = value(formData, "person_id");
    const programId = value(formData, "program_id");
    const seasonId = value(formData, "season_id");
    const days = Number(value(formData, "expires_days") || "14");
    if (!isValidUuid(personId) || !isValidUuid(programId) || !isValidUuid(seasonId)) {
      return adminFail("Person, program hoặc season không hợp lệ.");
    }
    if (!Number.isInteger(days) || days < 1 || days > 60) {
      return adminFail("Thời hạn link phải từ 1 đến 60 ngày.");
    }
    const admin = await authorizedOperator(seasonId);
    const client = getSupabaseServiceRoleClient();
    if (!admin || !client) return adminFail("Bạn không có quyền operations trong Season 12.");

    const [seasonResult, profileResult] = await Promise.all([
      client
        .from("seasons")
        .select("id,program_id,code")
        .eq("id", seasonId)
        .eq("program_id", programId)
        .maybeSingle(),
      client.from("mentor_profiles").select("id").eq("person_id", personId).maybeSingle()
    ]);
    if (
      seasonResult.error ||
      !seasonResult.data ||
      seasonResult.data.code !== SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE ||
      profileResult.error ||
      !profileResult.data
    ) {
      return adminFail("Chỉ mentor có hồ sơ canonical mới được mời gia hạn Season 12.");
    }

    const result = await createRenewalInvite({
      actorAdminUserId: admin.id as string,
      personId,
      programId,
      seasonId,
      expiresAt: new Date(Date.now() + days * 86_400_000).toISOString()
    }, client);
    revalidatePath("/admin/renewals");
    return result;
  } catch (error) {
    console.error("[renewal-actions] create failed", { code: (error as { code?: string })?.code ?? "UNKNOWN" });
    return adminFail("Không thể tạo link gia hạn an toàn.");
  }
}

export async function revokeRenewalInviteAction(
  _previous: RenewalAdminActionState,
  formData: FormData
): Promise<RenewalAdminActionState> {
  try {
    const inviteId = value(formData, "invite_id");
    const scoped = await scopedInvite(inviteId);
    if (!scoped) return adminFail("Link không hợp lệ hoặc bạn không có quyền operations.");
    const result = await revokeRenewalInvite({
      actorAdminUserId: scoped.admin.id as string,
      inviteId,
      reason: value(formData, "reason") || "Revoked from admin renewal console"
    }, scoped.client);
    revalidatePath("/admin/renewals");
    return result;
  } catch (error) {
    console.error("[renewal-actions] revoke failed", { code: (error as { code?: string })?.code ?? "UNKNOWN" });
    return adminFail("Không thể thu hồi link gia hạn an toàn.");
  }
}

export async function regenerateRenewalInviteAction(
  _previous: RenewalAdminActionState,
  formData: FormData
): Promise<RenewalAdminActionState> {
  try {
    const inviteId = value(formData, "invite_id");
    const days = Number(value(formData, "expires_days") || "14");
    if (!Number.isInteger(days) || days < 1 || days > 60) {
      return adminFail("Thời hạn link phải từ 1 đến 60 ngày.");
    }
    const scoped = await scopedInvite(inviteId);
    if (!scoped) return adminFail("Link không hợp lệ hoặc bạn không có quyền operations.");
    const result = await regenerateRenewalInvite({
      actorAdminUserId: scoped.admin.id as string,
      inviteId,
      expiresAt: new Date(Date.now() + days * 86_400_000).toISOString()
    }, scoped.client);
    revalidatePath("/admin/renewals");
    return result;
  } catch (error) {
    console.error("[renewal-actions] regenerate failed", { code: (error as { code?: string })?.code ?? "UNKNOWN" });
    return adminFail("Không thể tạo lại link gia hạn an toàn.");
  }
}

/**
 * Parses the reviewed CURRENT/PROPOSED snapshot the console rendered.
 *
 * It arrives as a form field rather than as a bound Server Action argument.
 * The previous shape closed over `reviewed` in an INLINE Server Action, which
 * made the confirm control the only action on this page carrying an encrypted
 * bound closure — and the only one that failed. Nothing here trusts the parsed
 * value: it is a claim about what the admin was shown, and every part of it is
 * re-bound to the database downstream.
 *
 *   profileUpdate  must equal buildRenewalProfileRefresh() over the mentor's
 *                  own stored raw_payload, checked in confirmRenewalAndApprove.
 *                  A tampered value cannot match and is refused.
 *   expectedProfile must equal the LIVE mentor_profiles row, checked inside
 *                  vam071_confirm_renewal_profile. A tampered value refuses on
 *                  drift instead of writing.
 *   applicationId  selects the row; authorization is re-resolved from the
 *                  invite's own season below, never from the client.
 *
 * So the form field can be edited, and editing it can only cause a refusal.
 */
function parseReviewedIntent(raw: string): RenewalConfirmationIntent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const candidate = parsed as Record<string, unknown>;
  const isScalar = (v: unknown) => typeof v === "string" || typeof v === "number" || v === null;
  const isRecord = (v: unknown) =>
    Boolean(v) && typeof v === "object" && !Array.isArray(v) &&
    Object.values(v as Record<string, unknown>).every(isScalar);

  if (typeof candidate.applicationId !== "string") return null;
  if (!isRecord(candidate.expectedProfile) || !isRecord(candidate.profileUpdate)) return null;
  if (!Array.isArray(candidate.diff)) return null;
  const diffOk = candidate.diff.every((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const e = entry as Record<string, unknown>;
    return typeof e.field === "string" && isScalar(e.before) && isScalar(e.after);
  });
  if (!diffOk) return null;

  return {
    applicationId: candidate.applicationId,
    expectedProfile: candidate.expectedProfile as RenewalConfirmationIntent["expectedProfile"],
    profileUpdate: candidate.profileUpdate as RenewalConfirmationIntent["profileUpdate"],
    diff: candidate.diff as RenewalConfirmationIntent["diff"]
  };
}

export async function confirmRenewalAction(
  _previous: RenewalAdminActionState,
  formData: FormData
): Promise<RenewalAdminActionState> {
  try {
    const reviewed = parseReviewedIntent(value(formData, "reviewed"));
    if (!reviewed) return adminFail("Diff xác nhận không hợp lệ. Vui lòng tải lại trang.");
    const applicationId = String(reviewed.applicationId ?? "").trim();
    if (!isValidUuid(applicationId)) return adminFail("Application không hợp lệ.");
    if (applicationId !== value(formData, "application_id")) {
      return adminFail("Diff xác nhận không khớp đơn gia hạn. Vui lòng tải lại trang.");
    }
    const client = getSupabaseServiceRoleClient();
    if (!client) return adminFail("Dịch vụ gia hạn chưa sẵn sàng.");
    const { data: invite, error } = await client
      .from("person_season_invites")
      .select("season_id")
      .eq("application_id", applicationId)
      .maybeSingle();
    if (error || !invite) return adminFail("Không tìm thấy invite gắn với đơn gia hạn.");
    const admin = await authorizedOperator(String(invite.season_id));
    if (!admin) return adminFail("Bạn không có quyền operations trong Season 12.");

    const result = await confirmRenewalAndApprove({
      applicationId,
      actorAdminUserId: admin.id as string,
      actorName: admin.full_name?.trim() || admin.email || null,
      reviewed
    }, client);
    revalidatePath("/admin/renewals");
    revalidatePath(`/applications/${applicationId}`);
    revalidatePath("/applications");
    return result;
  } catch (error) {
    console.error("[renewal-actions] confirm failed", { code: (error as { code?: string })?.code ?? "UNKNOWN" });
    return adminFail("Không thể hoàn tất gia hạn an toàn.");
  }
}
