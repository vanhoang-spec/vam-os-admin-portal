import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { INTERVIEW_ELIGIBLE_STATUSES } from "@/lib/interview-claim";
import { canBulkAssignReviews } from "@/lib/permissions";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

const SAFE_ERROR = "Không thể thực hiện thao tác. Vui lòng thử lại hoặc liên hệ admin.";

const PROFILE_ASSIGNMENT_STATUSES = new Set([
  "submitted",
  "under_data_check",
  "ready_for_screening",
  "screening_assigned"
]);

function serviceClient() {
  const client = getSupabaseServiceRoleClient();
  if (!client) console.error("[bulk-assignment] service-role client unavailable");
  return client;
}

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string };
  console.error("[bulk-assignment]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint
  });
}

export type BulkAssignInput = {
  intakeBatchId: string | null;
  roleApplied: string;
  statuses: string[];
  reviewerAdminUserIds: string[];
  reviewRound?: "profile_screening" | "interview";
  dueAt: string | null;
  excludeAlreadyAssigned: boolean;
  assignmentNote: string | null;
  assignedByAdminUserId: string;
};

export type BulkAssignResult =
  | {
      ok: true;
      applicationsAssigned: number;
      reviewersCount: number;
      minPerReviewer: number;
      maxPerReviewer: number;
      skippedAlreadyAssigned: number;
      batchId: string;
    }
  | { ok: false; message: string };

type BulkAssignmentRpcRow = {
  batch_id: string;
  applications_assigned: number;
  reviewers_count: number;
  min_per_reviewer: number;
  max_per_reviewer: number;
  skipped_already_assigned: number;
};

export async function bulkAssignApplicationReviews(
  input: BulkAssignInput
): Promise<BulkAssignResult> {
  const reviewRound = input.reviewRound ?? "profile_screening";
  const reviewerIds = Array.from(new Set(input.reviewerAdminUserIds.filter(Boolean)));
  const statuses = Array.from(new Set(input.statuses.filter(Boolean)));

  if (!input.intakeBatchId) {
    return { ok: false, message: "Vui lòng chọn một batch trước khi giao hồ sơ." };
  }
  if (!reviewerIds.length) {
    return { ok: false, message: "Vui lòng chọn ít nhất một reviewer." };
  }
  if (!statuses.length) {
    return { ok: false, message: "Vui lòng chọn ít nhất một trạng thái đơn." };
  }
  if (!input.roleApplied.trim()) {
    return { ok: false, message: "Vui lòng chọn role ứng tuyển." };
  }
  const allowedStatuses = reviewRound === "interview"
    ? INTERVIEW_ELIGIBLE_STATUSES
    : PROFILE_ASSIGNMENT_STATUSES;
  if (statuses.some((status) => !allowedStatuses.has(status))) {
    return { ok: false, message: "Bộ lọc chứa trạng thái không phù hợp với vòng review." };
  }

  const client = serviceClient();
  if (!client) return { ok: false, message: SAFE_ERROR };
  const actor = await getCurrentAdminUser();
  if (!actor?.id || actor.id !== input.assignedByAdminUserId || !canBulkAssignReviews(actor.role)) {
    return { ok: false, message: "Bạn không có quyền thực hiện thao tác giao review." };
  }

  const { data: batch, error: batchError } = await client
    .from("intake_batches")
    .select("id,season_id")
    .eq("id", input.intakeBatchId)
    .maybeSingle();
  if (batchError || !batch?.season_id) {
    log("load assignment batch", batchError);
    return { ok: false, message: "Không thể xác định mùa của batch đã chọn." };
  }
  if (!(await canOperateSeason(await getAdminScopeContext(), String(batch.season_id)))) {
    return { ok: false, message: "Bạn không có quyền vận hành mùa của batch này." };
  }

  const { data, error } = await client.rpc("vam090_bulk_assign_application_reviews", {
    p_intake_batch_id: input.intakeBatchId,
    p_role_applied: input.roleApplied.trim(),
    p_statuses: statuses,
    p_reviewer_ids: reviewerIds,
    p_review_round: reviewRound,
    p_due_at: input.dueAt,
    p_exclude_already_assigned: input.excludeAlreadyAssigned,
    p_assignment_note: input.assignmentNote,
    p_actor: input.assignedByAdminUserId
  });
  if (error) {
    log("atomic bulk assignment failed", error);
    return { ok: false, message: SAFE_ERROR };
  }
  const row = (Array.isArray(data) ? data[0] : data) as BulkAssignmentRpcRow | null;
  if (!row?.batch_id || !Number.isInteger(row.applications_assigned) || row.applications_assigned < 1) {
    return { ok: false, message: SAFE_ERROR };
  }

  return {
    ok: true,
    applicationsAssigned: row.applications_assigned,
    reviewersCount: row.reviewers_count,
    minPerReviewer: row.min_per_reviewer,
    maxPerReviewer: row.max_per_reviewer,
    skippedAlreadyAssigned: row.skipped_already_assigned,
    batchId: row.batch_id
  };
}
