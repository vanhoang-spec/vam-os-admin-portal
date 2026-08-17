"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { approveApplication } from "@/lib/application-approvals";
import { canDecide } from "@/lib/permissions";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import type { ApprovalActionState } from "@/lib/approval-action-types";

function fail(message: string): ApprovalActionState {
  return { ok: false, message };
}

type ApprovalScope = { programId: string; seasonId: string };

async function resolveApplicationApprovalScope(
  client: NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>,
  applicationId: string
): Promise<ApprovalScope | null> {
  const { data: application, error: applicationError } = await client
    .from("applications")
    .select("id,season_id")
    .eq("id", applicationId)
    .maybeSingle();
  const seasonId = String(application?.season_id ?? "").trim();
  if (applicationError || !application || !seasonId) return null;

  const { data: season, error: seasonError } = await client
    .from("seasons")
    .select("id,program_id")
    .eq("id", seasonId)
    .maybeSingle();
  const programId = String(season?.program_id ?? "").trim();
  if (seasonError || !season || String(season.id) !== seasonId || !programId) return null;
  return { programId, seasonId };
}

export async function approveApplicationAction(
  _prev: ApprovalActionState,
  formData: FormData
): Promise<ApprovalActionState> {
  try {
    const adminUser = await getCurrentAdminUser();
    if (!adminUser?.id) return fail("Bạn chưa đăng nhập.");
    if (!canDecide(adminUser.role)) {
      return fail("Chỉ admin / core team mới có thể duyệt đơn ứng tuyển.");
    }

    const applicationId = String(formData.get("application_id") ?? "").trim();
    const targetRole = String(formData.get("target_role") ?? "").trim();
    const fullName = String(formData.get("full_name") ?? "").trim() || null;
    const emailPrimary = String(formData.get("email_primary") ?? "").trim() || null;
    const phonePrimary = String(formData.get("phone_primary") ?? "").trim() || null;
    const gender = String(formData.get("gender") ?? "").trim() || null;
    const seasonCode = String(formData.get("season_code") ?? "").trim() || null;
    const intakeBatchId = String(formData.get("intake_batch_id") ?? "").trim() || null;
    const previousStatus = String(formData.get("previous_status") ?? "").trim() || null;

    if (!applicationId) return fail("Thiếu application_id.");
    if (targetRole !== "mentor" && targetRole !== "mentee") {
      return fail("target_role phải là 'mentor' hoặc 'mentee'.");
    }
    if (!fullName) return fail("Họ tên ứng viên không được để trống.");

    const scopeContext = await getAdminScopeContext();
    if (scopeContext.scopeError) {
      return fail("Không thể xác minh phạm vi duyệt đơn của bạn.");
    }
    const client = getSupabaseServiceRoleClient();
    if (!client) return fail("Không thể tải phạm vi của đơn ứng tuyển.");
    const approvalScope = await resolveApplicationApprovalScope(client, applicationId);
    if (!approvalScope) return fail("Không thể xác định chương trình và mùa của đơn ứng tuyển.");
    if (!(await canOperateSeason(scopeContext, approvalScope.seasonId))) {
      return fail("Bạn không có quyền duyệt đơn trong chương trình và mùa này.");
    }

    const decidedByName =
      (adminUser.full_name?.trim() || null) ?? adminUser.email ?? null;

    const result = await approveApplication({
      applicationId,
      approvedByAdminUserId: adminUser.id as string,
      approvedByName: decidedByName,
      fullName,
      emailPrimary,
      phonePrimary,
      gender,
      seasonCode,
      intakeBatchId,
      targetRole,
      previousStatus
    });

    if (!result.ok) return fail(result.message);

    revalidatePath(`/applications/${applicationId}`);
    revalidatePath("/applications");

    const personLabel = result.personCreated ? "Đã tạo người mới" : "Đã liên kết người sẵn có";
    const profileLabel = result.profileCreated
      ? `Đã tạo ${targetRole === "mentor" ? "mentor" : "mentee"} profile mới`
      : `Đã liên kết ${targetRole === "mentor" ? "mentor" : "mentee"} profile sẵn có`;

    return {
      ok: true,
      message: `Duyệt thành công. ${personLabel}. ${profileLabel}.`,
      personId: result.personId,
      profileId: result.profileId,
      personCreated: result.personCreated,
      profileCreated: result.profileCreated
    };
  } catch (err) {
    console.error("[approveApplicationAction]", err);
    return fail("Lỗi hệ thống. Vui lòng thử lại.");
  }
}
