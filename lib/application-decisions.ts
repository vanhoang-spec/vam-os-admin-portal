import "server-only";

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

// All writes use service-role to bypass RLS.

const SAFE_ERROR = "Không thể thực hiện thao tác. Vui lòng thử lại hoặc liên hệ admin.";

function serviceClient() {
  const client = getSupabaseServiceRoleClient();
  if (!client) {
    console.error("[application-decisions] service-role client unavailable");
    return null;
  }
  return client;
}

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string };
  console.error("[application-decisions]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint
  });
}

export type RecordDecisionInput = {
  applicationId: string;
  decidedByAdminUserId: string;
  decidedByName: string | null;
  previousStatus: string | null;
  newStatus: string;
  decisionNote: string | null;
};

export type ApplyDecisionsInput = {
  applicationIds: string[];
  decidedByAdminUserId: string;
  newStatus: string;
  decisionNote: string | null;
  expectedStatuses: Record<string, string>;
};

export type DecisionResult =
  | { ok: true; id: string; applied: number; failed: number; message?: string }
  | { ok: false; message: string };

const REASON_MESSAGES: Record<string, string> = {
  scope_denied: "Bạn không có quyền vận hành mùa của đơn này.",
  expected_status_missing: "Thiếu trạng thái dự kiến. Vui lòng tải lại trước khi quyết định.",
  stale_status: "Trạng thái đơn đã thay đổi. Vui lòng tải lại trước khi quyết định.",
  stage_requirement_missing: "Chưa cấu hình số review tối thiểu cho mùa tuyển sinh.",
  profile_review_minimum_not_met: "Đơn chưa đủ số review hồ sơ tối thiểu.",
  interview_review_minimum_not_met: "Đơn chưa đủ số đánh giá phỏng vấn tối thiểu.",
  application_role_mismatch: "Vai trò duyệt không khớp với vai trò ứng tuyển.",
  additional_review_not_submitted: "Review bổ sung được yêu cầu nhưng chưa được hoàn tất.",
  invalid_transition: "Trạng thái hiện tại không cho phép quyết định này.",
  terminal_status: "Đơn đã ở trạng thái kết thúc.",
  unsupported_decision: "Quyết định không được hỗ trợ."
};

export async function applyApplicationDecisions(input: ApplyDecisionsInput): Promise<DecisionResult> {
  const client = serviceClient();
  if (!client) return { ok: false, message: SAFE_ERROR };
  const { data, error } = await client.rpc("vam084_apply_application_decisions", {
    p_application_ids: input.applicationIds,
    p_new_status: input.newStatus,
    p_actor: input.decidedByAdminUserId,
    p_decision_note: input.decisionNote,
    p_expected_statuses: input.expectedStatuses
  });
  if (error) {
    log("atomic application decision failed", error);
    return { ok: false, message: SAFE_ERROR };
  }
  const rows = (data ?? []) as Array<{ application_id: string; applied: boolean; reason: string }>;
  if (rows.length !== input.applicationIds.length) return { ok: false, message: SAFE_ERROR };
  const applied = rows.filter((row) => row.applied).length;
  const failedRows = rows.filter((row) => !row.applied);
  const failureSummary = Array.from(
    failedRows.reduce((counts, row) => counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1), new Map<string, number>())
  ).map(([reason, count]) => `${REASON_MESSAGES[reason] ?? reason}: ${count}`).join("; ");
  if (!applied) {
    const reason = failedRows[0]?.reason;
    return { ok: false, message: REASON_MESSAGES[reason] ?? SAFE_ERROR };
  }
  return {
    ok: true,
    id: rows.find((row) => row.applied)?.application_id ?? input.applicationIds[0],
    applied,
    failed: failedRows.length,
    message: failedRows.length
      ? `Đã cập nhật ${applied} đơn; ${failedRows.length} đơn bị chặn. ${failureSummary}`
      : `Đã cập nhật ${applied} đơn.`
  };
}

export async function recordApplicationDecision(
  input: RecordDecisionInput
): Promise<DecisionResult> {
  return applyApplicationDecisions({
    applicationIds: [input.applicationId],
    decidedByAdminUserId: input.decidedByAdminUserId,
    newStatus: input.newStatus,
    decisionNote: input.decisionNote,
    expectedStatuses: { [input.applicationId]: input.previousStatus ?? "" }
  });
}
