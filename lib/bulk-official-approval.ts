import "server-only";

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { MAX_BULK_APPROVAL_IDS, type BulkApprovalRowResult } from "@/lib/bulk-official-approval-types";

// -----------------------------------------------------------------------
// M092 — Bulk Official Approval.
//
// This module is a thin, non-mutating wrapper around the single trusted
// database RPC vam092_bulk_official_approve_applications. Every mutation —
// identity resolution, person/profile create-or-reuse, application status
// finalization, and the per-row audit trail — happens inside that RPC,
// under one PL/pgSQL savepoint per application row. This module never
// touches applications/people/mentor_profiles/mentee_profiles directly and
// deliberately does NOT reuse vam084_apply_application_decisions or add
// approved_as_mentor/approved_as_mentee to the generic decision allowlist —
// see supabase/migrations/20260831120000_s12_m092_bulk_official_approval.sql
// for why that would be unsafe.
// -----------------------------------------------------------------------

const SAFE_ERROR = "Không thể thực hiện thao tác. Vui lòng thử lại hoặc liên hệ admin.";

function serviceClient() {
  const client = getSupabaseServiceRoleClient();
  if (!client) {
    console.error("[bulk-official-approval] service-role client unavailable");
    return null;
  }
  return client;
}

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string };
  console.error("[bulk-official-approval]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint
  });
}

export type BulkOfficialApproveInput = {
  applicationIds: string[];
  actorAdminUserId: string;
};

export type BulkOfficialApproveResult =
  | { ok: true; rows: BulkApprovalRowResult[]; approved: number; skipped: number; manualRequired: number; failed: number }
  | { ok: false; message: string };

/**
 * Machine reason_code (from the RPC or from this module's own request-shape
 * validation) → operator-facing Vietnamese message. Kept separate from the
 * database layer so wording can change without touching SQL, matching the
 * REASON_MESSAGES convention in lib/application-decisions.ts.
 */
const REASON_MESSAGES: Record<string, string> = {
  approved: "Đã duyệt thành công.",
  application_not_found: "Không tìm thấy đơn ứng tuyển.",
  scope_denied: "Bạn không có quyền vận hành mùa của đơn này.",
  unsupported_role: "Vai trò ứng tuyển không được hỗ trợ cho duyệt chính thức hàng loạt.",
  already_approved: "Đơn đã ở trạng thái duyệt chính thức (bỏ qua an toàn khi chạy lại).",
  renewal_requires_individual_path: "Đơn gia hạn cần được duyệt qua luồng gia hạn riêng, không qua duyệt chính thức thông thường.",
  returning_mentor_renewal_path_required:
    "Người này đã có mentor profile hoặc đang trong luồng gia hạn Season 12 — cần xử lý thủ công qua quy trình gia hạn, không duyệt như đơn mới.",
  linked_person_not_found: "Không thể xác định hồ sơ người đã liên kết với đơn này.",
  person_link_identity_conflict: "Người đã liên kết với đơn không khớp với email trên đơn. Cần xử lý thủ công.",
  blank_email: "Đơn không có email — cần xử lý thủ công, không tự tạo hồ sơ người.",
  ambiguous_identity: "Có nhiều hồ sơ người trùng email — cần xử lý thủ công.",
  ambiguous_profile: "Người này có nhiều hơn một mentor/mentee profile — cần xử lý thủ công, không tự chọn profile.",
  blank_full_name: "Đơn không có họ tên — cần xử lý thủ công.",
  internal_error: "Lỗi hệ thống khi duyệt đơn này. Có thể thử lại an toàn.",
  // vam084_application_decision_eligibility reason codes (reused verbatim as the gate)
  stage_requirement_missing: "Chưa cấu hình số review tối thiểu cho mùa tuyển sinh.",
  profile_review_minimum_not_met: "Đơn chưa đủ số review hồ sơ tối thiểu.",
  interview_review_minimum_not_met: "Đơn chưa đủ số đánh giá phỏng vấn tối thiểu.",
  application_role_mismatch: "Vai trò duyệt không khớp với vai trò ứng tuyển.",
  additional_review_not_submitted: "Review bổ sung được yêu cầu nhưng chưa được hoàn tất.",
  invalid_transition: "Trạng thái hiện tại không cho phép duyệt chính thức.",
  terminal_status: "Đơn đã ở trạng thái kết thúc.",
  unsupported_decision: "Đơn chưa đủ điều kiện vòng đời để duyệt chính thức."
};

function reasonMessage(reasonCode: string): string {
  return REASON_MESSAGES[reasonCode] ?? SAFE_ERROR;
}

type RpcRow = {
  application_id: string;
  target_role: "mentor" | "mentee" | null;
  outcome: "approved" | "skipped" | "manual_required" | "failed";
  reason_code: string;
  person_id: string | null;
  person_created: boolean | null;
  profile_id: string | null;
  profile_created: boolean | null;
};

export async function bulkOfficialApproveApplications(
  input: BulkOfficialApproveInput
): Promise<BulkOfficialApproveResult> {
  // Deterministic de-dup, first-occurrence order — mirrors the RPC's own
  // de-dup so the app-layer count check below matches what the RPC sees.
  const ids = Array.from(new Set(input.applicationIds));
  if (ids.length < 1 || ids.length > MAX_BULK_APPROVAL_IDS) {
    return { ok: false, message: `Chọn từ 1 đến ${MAX_BULK_APPROVAL_IDS} đơn.` };
  }

  const client = serviceClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const { data, error } = await client.rpc("vam092_bulk_official_approve_applications", {
    p_application_ids: ids,
    p_actor: input.actorAdminUserId
  });
  if (error) {
    log("vam092_bulk_official_approve_applications failed", error);
    return { ok: false, message: SAFE_ERROR };
  }

  const rawRows = (data ?? []) as RpcRow[];
  const rows: BulkApprovalRowResult[] = rawRows.map((row) => ({
    applicationId: row.application_id,
    targetRole: row.target_role,
    outcome: row.outcome,
    reasonCode: row.reason_code,
    reasonMessage: reasonMessage(row.reason_code),
    personId: row.person_id,
    personCreated: row.person_created,
    profileId: row.profile_id,
    profileCreated: row.profile_created
  }));

  return {
    ok: true,
    rows,
    approved: rows.filter((r) => r.outcome === "approved").length,
    skipped: rows.filter((r) => r.outcome === "skipped").length,
    manualRequired: rows.filter((r) => r.outcome === "manual_required").length,
    failed: rows.filter((r) => r.outcome === "failed").length
  };
}
