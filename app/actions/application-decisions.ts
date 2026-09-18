"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import {
  recordApplicationDecision,
  refuseApplicationsBeyondDecisionRole,
  restoreWithdrawnApplication
} from "@/lib/application-decisions";
import { canDecide, canDecideAnyApplicationResult } from "@/lib/permissions";
import type { DecisionActionState } from "@/lib/decision-action-types";
import {
  ALLOWED_DECISION_STATUSES,
  RETIRED_FORWARD_DECISION_MESSAGE,
  RETIRED_FORWARD_DECISION_STATUSES
} from "@/lib/decision-action-types";

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
    if (!canDecideAnyApplicationResult(adminUser.role)) {
      return fail("Bạn không có quyền ra quyết định cho đơn ứng tuyển.");
    }

    const applicationId = String(formData.get("application_id") ?? "").trim();
    const newStatus = String(formData.get("new_status") ?? "").trim();
    const previousStatus = String(formData.get("previous_status") ?? "").trim() || null;
    const decisionNote = String(formData.get("decision_note") ?? "").trim() || null;

    if (!applicationId) return fail("Thiếu application_id.");
    // Vai trò ứng tuyển đọc từ đơn đã lưu: mentor là việc của Core Team trở lên.
    const roleGate = await refuseApplicationsBeyondDecisionRole({
      applicationIds: [applicationId],
      actorRole: adminUser.role
    });
    if (!roleGate.ok) return fail(roleGate.message);
    if (!newStatus) return fail("Vui lòng chọn quyết định.");
    if (!allowedDecisionStatuses.has(newStatus)) {
      return fail(`Quyết định không hợp lệ: ${newStatus}`);
    }
    // The same backdoor as the bulk route: no control offers this any more, and
    // a crafted request must not be the one exception.
    if (RETIRED_FORWARD_DECISION_STATUSES.has(newStatus)) {
      return fail(RETIRED_FORWARD_DECISION_MESSAGE);
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
    revalidatePath("/reviews");
    revalidatePath("/my-work");
    revalidatePath("/interviews");
    return { ok: true, message: "Đã ghi nhận quyết định thành công." };
  } catch (err) {
    console.error("[updateApplicationDecisionAction]", err);
    return fail("Lỗi hệ thống. Vui lòng thử lại.");
  }
}

export async function restoreWithdrawnApplicationAction(
  _prev: DecisionActionState,
  formData: FormData
): Promise<DecisionActionState> {
  try {
    const adminUser = await getCurrentAdminUser();
    if (!adminUser?.id) return fail("Bạn chưa đăng nhập.");
    if (!canDecide(adminUser.role)) return fail("Bạn không có quyền khôi phục hồ sơ.");

    const applicationId = String(formData.get("application_id") ?? "").trim();
    const reason = String(formData.get("restore_reason") ?? "").trim();
    if (!applicationId) return fail("Thiếu application_id.");
    if (reason.length < 3) return fail("Vui lòng nhập lý do nội bộ để khôi phục hồ sơ.");

    const result = await restoreWithdrawnApplication({
      applicationId,
      actorAdminUserId: adminUser.id,
      reason
    });
    if (!result.ok) return fail(result.message);

    revalidatePath(`/applications/${applicationId}`);
    revalidatePath("/applications");
    revalidatePath("/reviews");
    revalidatePath("/my-work");
    revalidatePath("/interviews");
    return { ok: true, message: `Đã khôi phục hồ sơ về trạng thái ${result.restoredStatus}.` };
  } catch (err) {
    console.error("[restoreWithdrawnApplicationAction]", err);
    return fail("Lỗi hệ thống. Vui lòng thử lại.");
  }
}
