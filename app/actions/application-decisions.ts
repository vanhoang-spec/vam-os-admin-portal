"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { recordApplicationDecision } from "@/lib/application-decisions";
import { canDecide } from "@/lib/permissions";
import type { DecisionActionState } from "@/lib/decision-action-types";
import { ALLOWED_DECISION_STATUSES } from "@/lib/decision-action-types";

const allowedDecisionStatuses = new Set<string>(ALLOWED_DECISION_STATUSES);

function fail(message: string): DecisionActionState {
  return { ok: false, message };
}

export async function updateApplicationDecisionAction(
  _prev: DecisionActionState,
  formData: FormData
): Promise<DecisionActionState> {
  try {
    const adminUser = await getCurrentAdminUser();
    if (!adminUser?.id) return fail("Bạn chưa đăng nhập.");
    if (!canDecide(adminUser.role)) return fail("Bạn không có quyền ra quyết định cho đơn ứng tuyển.");

    const applicationId = String(formData.get("application_id") ?? "").trim();
    const newStatus = String(formData.get("new_status") ?? "").trim();
    const previousStatus = String(formData.get("previous_status") ?? "").trim() || null;
    const decisionNote = String(formData.get("decision_note") ?? "").trim() || null;

    if (!applicationId) return fail("Thiếu application_id.");
    if (!newStatus) return fail("Vui lòng chọn quyết định.");
    if (!allowedDecisionStatuses.has(newStatus)) {
      return fail(`Quyết định không hợp lệ: ${newStatus}`);
    }

    const decidedByName =
      (adminUser.full_name?.trim() || null) ?? adminUser.email ?? null;

    const result = await recordApplicationDecision({
      applicationId,
      decidedByAdminUserId: adminUser.id as string,
      decidedByName,
      previousStatus,
      newStatus,
      decisionNote
    });

    if (!result.ok) return fail(result.message);

    revalidatePath(`/applications/${applicationId}`);
    revalidatePath("/applications");
    return { ok: true, message: "Đã ghi nhận quyết định thành công." };
  } catch (err) {
    console.error("[updateApplicationDecisionAction]", err);
    return fail("Lỗi hệ thống. Vui lòng thử lại.");
  }
}
