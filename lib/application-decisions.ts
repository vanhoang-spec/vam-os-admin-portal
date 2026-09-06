import "server-only";

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import type { DirectInviteEvaluation, DirectInviteReason } from "@/lib/direct-interview-eligibility";

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

/** One application's outcome, straight from the RPC. Never collapsed away. */
export type DecisionRowResult = {
  applicationId: string;
  applied: boolean;
  reason: string;
  /** Operator-facing text for `reason`. */
  message: string;
};

export type DecisionResult =
  | { ok: true; id: string; applied: number; failed: number; message?: string; rows?: DecisionRowResult[] }
  | { ok: false; message: string; rows?: DecisionRowResult[] };

/** Vietnamese text for an RPC refusal reason, for row-level reporting. */
export function decisionReasonMessage(reason: string): string {
  return REASON_MESSAGES[reason] ?? reason;
}

export type RestoreWithdrawnResult =
  | { ok: true; applicationId: string; restoredStatus: string }
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
  // Carried through per application. An operator asked to stand behind 100
  // names needs to know WHICH one was blocked and why, not a count.
  const rowResults: DecisionRowResult[] = rows.map((row) => ({
    applicationId: String(row.application_id),
    applied: row.applied,
    reason: String(row.reason ?? ""),
    message: row.applied ? "Đã mời phỏng vấn." : decisionReasonMessage(String(row.reason ?? ""))
  }));
  const applied = rows.filter((row) => row.applied).length;
  const failedRows = rows.filter((row) => !row.applied);
  const failureSummary = Array.from(
    failedRows.reduce((counts, row) => counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1), new Map<string, number>())
  ).map(([reason, count]) => `${REASON_MESSAGES[reason] ?? reason}: ${count}`).join("; ");
  if (!applied) {
    const reason = failedRows[0]?.reason;
    return { ok: false, message: REASON_MESSAGES[reason] ?? SAFE_ERROR, rows: rowResults };
  }
  return {
    ok: true,
    id: rows.find((row) => row.applied)?.application_id ?? input.applicationIds[0],
    applied,
    failed: failedRows.length,
    message: failedRows.length
      ? `Đã cập nhật ${applied} đơn; ${failedRows.length} đơn bị chặn. ${failureSummary}`
      : `Đã cập nhật ${applied} đơn.`,
    rows: rowResults
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

export async function restoreWithdrawnApplication(input: {
  applicationId: string;
  actorAdminUserId: string;
  reason: string;
}): Promise<RestoreWithdrawnResult> {
  const client = serviceClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const { data, error } = await client.rpc("vam095_restore_withdrawn_application", {
    p_application_id: input.applicationId,
    p_actor: input.actorAdminUserId,
    p_reason: input.reason
  });
  if (error) {
    log("restore withdrawn application failed", error);
    const message = String(error.message ?? "");
    if (message.includes("provenance")) {
      return {
        ok: false,
        message: "Không xác định được trạng thái trước khi rút hồ sơ. Cần xử lý thủ công có kiểm soát."
      };
    }
    if (message.includes("Only a withdrawn application")) {
      return { ok: false, message: "Hồ sơ không còn ở trạng thái đã rút. Vui lòng tải lại trang." };
    }
    return { ok: false, message: SAFE_ERROR };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { application_id: string; new_status: string; decision_id: string }
    | null;
  if (!row?.application_id || !row.new_status || !row.decision_id) {
    return { ok: false, message: SAFE_ERROR };
  }
  return { ok: true, applicationId: row.application_id, restoredStatus: row.new_status };
}


/**
 * Asks the DATABASE whether a decision is currently allowed.
 *
 * `vam084_application_decision_eligibility` is the same function
 * `vam084_apply_application_decisions` consults before it writes, so this is the
 * authoritative answer rather than a re-implementation of it. The decision panel
 * uses it so the control an operator sees and the transition the server would
 * perform can never disagree.
 *
 * FAIL CLOSED. An unreadable answer is reported as `eligibility_unknown`, never
 * as permission — the panel then renders the decision as unavailable and says
 * why, instead of offering a control that will be refused.
 */
export async function getApplicationDecisionEligibility(
  applicationId: string,
  newStatus: string,
  client = getSupabaseServiceRoleClient()
): Promise<DirectInviteEvaluation> {
  if (!client) return { eligible: false, reason: "eligibility_unknown" };
  const { data, error } = await client.rpc("vam084_application_decision_eligibility", {
    p_application_id: applicationId,
    p_new_status: newStatus
  });
  if (error) {
    log("decision eligibility read failed", error);
    return { eligible: false, reason: "eligibility_unknown" };
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { eligible?: unknown; reason?: unknown }
    | null;
  if (!row || typeof row.eligible !== "boolean") {
    return { eligible: false, reason: "eligibility_unknown" };
  }
  const reason = String(row.reason ?? "");
  const known: DirectInviteReason[] = [
    "eligible",
    "profile_review_minimum_not_met",
    "additional_review_not_submitted",
    "invalid_transition"
  ];
  return {
    eligible: row.eligible,
    // An unrecognised reason is still a refusal; it just cannot be explained
    // more precisely than "unknown".
    reason: known.includes(reason as DirectInviteReason)
      ? (reason as DirectInviteReason)
      : row.eligible
        ? "eligible"
        : "eligibility_unknown"
  };
}
