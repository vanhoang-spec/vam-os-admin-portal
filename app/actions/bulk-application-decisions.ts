"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { applyApplicationDecisions } from "@/lib/application-decisions";
import { ALLOWED_DECISION_STATUSES, type DecisionActionState } from "@/lib/decision-action-types";
import { canDecide } from "@/lib/permissions";

const allowed = new Set<string>(ALLOWED_DECISION_STATUSES);

export async function bulkApplicationDecisionAction(
  _previous: DecisionActionState,
  formData: FormData
): Promise<DecisionActionState> {
  const actor = await getCurrentAdminUser();
  if (!actor?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canDecide(actor.role)) return { ok: false, message: "Bạn không có quyền ra quyết định." };

  const ids = Array.from(new Set(formData.getAll("application_id").map(String).filter(Boolean)));
  const newStatus = String(formData.get("new_status") ?? "").trim();
  const note = String(formData.get("decision_note") ?? "").trim() || null;
  if (!ids.length || ids.length > 500) return { ok: false, message: "Chọn từ 1 đến 500 đơn." };
  if (!allowed.has(newStatus) || newStatus === "withdrawn") {
    return { ok: false, message: "Quyết định hàng loạt không hợp lệ." };
  }
  const expectedStatuses: Record<string, string> = {};
  for (const id of ids) expectedStatuses[id] = String(formData.get(`expected_status_${id}`) ?? "");

  const result = await applyApplicationDecisions({
    applicationIds: ids,
    decidedByAdminUserId: actor.id,
    newStatus,
    decisionNote: note,
    expectedStatuses
  });
  if (!result.ok) return result;
  revalidatePath("/applications");
  revalidatePath("/applications/bulk-decision");
  return { ok: true, message: result.message ?? `Đã cập nhật ${result.applied} đơn.` };
}
