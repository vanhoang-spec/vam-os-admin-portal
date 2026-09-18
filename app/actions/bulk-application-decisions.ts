"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import {
  applyApplicationDecisions,
  refuseApplicationsBeyondDecisionRole
} from "@/lib/application-decisions";
import {
  ALLOWED_DECISION_STATUSES,
  RETIRED_FORWARD_DECISION_MESSAGE,
  RETIRED_FORWARD_DECISION_STATUSES,
  type DecisionActionState
} from "@/lib/decision-action-types";
import { canDecideAnyApplicationResult } from "@/lib/permissions";

const allowed = new Set<string>(ALLOWED_DECISION_STATUSES);

export async function bulkApplicationDecisionAction(
  _previous: DecisionActionState,
  formData: FormData
): Promise<DecisionActionState> {
  const actor = await getCurrentAdminUser();
  if (!actor?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canDecideAnyApplicationResult(actor.role)) {
    return { ok: false, message: "Bạn không có quyền ra quyết định." };
  }

  const ids = Array.from(new Set(formData.getAll("application_id").map(String).filter(Boolean)));
  const newStatus = String(formData.get("new_status") ?? "").trim();
  const note = String(formData.get("decision_note") ?? "").trim() || null;
  if (!ids.length || ids.length > 500) return { ok: false, message: "Chọn từ 1 đến 500 đơn." };
  if (!allowed.has(newStatus) || newStatus === "withdrawn") {
    return { ok: false, message: "Quyết định hàng loạt không hợp lệ." };
  }
  // Checked at the mutation boundary, not only where a control is rendered:
  // this route is reachable by URL, and hiding a <option> is not a guard.
  if (RETIRED_FORWARD_DECISION_STATUSES.has(newStatus)) {
    return { ok: false, message: RETIRED_FORWARD_DECISION_MESSAGE };
  }
  const roleGate = await refuseApplicationsBeyondDecisionRole({ applicationIds: ids, actorRole: actor.role });
  if (!roleGate.ok) return { ok: false, message: roleGate.message };
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
