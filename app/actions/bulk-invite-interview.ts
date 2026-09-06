"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { applyApplicationDecisions } from "@/lib/application-decisions";
import { BULK_INVITE_MAX, BULK_INVITE_TARGET_STATUS } from "@/lib/bulk-invite-interview";
import {
  initialBulkInviteState,
  type BulkInviteRowResult,
  type BulkInviteState
} from "@/lib/bulk-invite-action-types";
import { canDecide } from "@/lib/permissions";

/**
 * Bulk "Mời phỏng vấn".
 *
 * The only status this action can ever send is `invited_to_interview` — it is a
 * constant here, not a form field, so a crafted request cannot turn the bulk
 * invite screen into a bulk anything-else screen.
 *
 * Every row goes to `vam084_apply_application_decisions`, which re-derives
 * eligibility per application under a row lock and enforces the expected-status
 * check. Per-application outcomes come back and are reported per applicant;
 * nothing is skipped silently.
 */

function fail(message: string): BulkInviteState {
  return { ...initialBulkInviteState, message };
}

export async function bulkInviteInterviewAction(
  _previous: BulkInviteState,
  formData: FormData
): Promise<BulkInviteState> {
  try {
    const actor = await getCurrentAdminUser();
    if (!actor?.id) return fail("Bạn chưa đăng nhập.");
    if (!canDecide(actor.role)) return fail("Bạn không có quyền ra quyết định.");

    const ids = Array.from(
      new Set(formData.getAll("application_id").map(String).map((v) => v.trim()).filter(Boolean))
    );
    if (!ids.length) return fail("Chưa chọn hồ sơ nào.");
    if (ids.length > BULK_INVITE_MAX) {
      return fail(`Mỗi lần chỉ mời tối đa ${BULK_INVITE_MAX} hồ sơ.`);
    }

    // Names are display-only; the decision is keyed by id.
    const names = new Map<string, string>();
    for (const id of ids) {
      names.set(id, String(formData.get(`applicant_name_${id}`) ?? "").trim() || id);
    }

    // Each row carries the status the page rendered, so an application whose
    // status moved since then is blocked rather than decided on stale grounds.
    const expectedStatuses: Record<string, string> = {};
    for (const id of ids) {
      expectedStatuses[id] = String(formData.get(`expected_status_${id}`) ?? "");
    }

    const result = await applyApplicationDecisions({
      applicationIds: ids,
      decidedByAdminUserId: actor.id,
      newStatus: BULK_INVITE_TARGET_STATUS,
      decisionNote: String(formData.get("decision_note") ?? "").trim() || null,
      expectedStatuses
    });

    const rows: BulkInviteRowResult[] = (result.rows ?? []).map((row) => ({
      applicationId: row.applicationId,
      applicantName: names.get(row.applicationId) ?? row.applicationId,
      applied: row.applied,
      message: row.message
    }));

    revalidatePath("/applications");
    revalidatePath("/applications/bulk-invite-interview");

    if (!result.ok) {
      return {
        ok: false,
        message: result.message,
        appliedCount: 0,
        blockedCount: rows.length || ids.length,
        rows
      };
    }

    return {
      ok: true,
      message: result.message ?? `Đã mời ${result.applied} hồ sơ.`,
      appliedCount: result.applied,
      blockedCount: result.failed,
      rows
    };
  } catch (error) {
    console.error("[bulkInviteInterviewAction]", {
      code: (error as { code?: string })?.code ?? "UNKNOWN"
    });
    return fail("Lỗi hệ thống. Vui lòng thử lại.");
  }
}
