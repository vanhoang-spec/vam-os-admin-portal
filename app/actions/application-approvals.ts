"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { approveApplication } from "@/lib/application-approvals";
import { canDecide } from "@/lib/permissions";
import type { ApprovalActionState } from "@/lib/approval-action-types";

function fail(message: string): ApprovalActionState {
  return { ok: false, message };
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
    const previousStatus = String(formData.get("previous_status") ?? "").trim() || null;

    if (!applicationId) return fail("Thiếu application_id.");
    if (targetRole !== "mentor" && targetRole !== "mentee") {
      return fail("target_role phải là 'mentor' hoặc 'mentee'.");
    }
    if (!fullName) return fail("Họ tên ứng viên không được để trống.");

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
