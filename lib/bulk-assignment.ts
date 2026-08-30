import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { INTERVIEW_ELIGIBLE_STATUSES } from "@/lib/interview-claim";
import { canBulkAssignReviews } from "@/lib/permissions";
import { canOperateSeason, getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { validateReviewEligibleReviewers } from "@/lib/reviewer-eligibility";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

// ---------------------------------------------------------------------------
// Phase 044a — Bulk-assign applications to reviewers for profile screening.
//
// Algorithm:
//   1. Fetch eligible applications (batch + role + statuses).
//   2. Optionally skip apps that already have an active profile_screening review.
//   3. Sort apps: submitted_at ASC, id ASC (deterministic).
//   4. Fetch workload for each selected reviewer (count of existing active
//      profile_screening reviews across all batches).
//   5. Sort reviewers: current_workload ASC, email ASC (deterministic).
//   6. Create a review_assignment_batches audit row.
//   7. Round-robin assign: app[i] → reviewer[i % reviewerCount].
//   8. Bulk-insert application_reviews rows.
//   9. Advance application.status to screening_assigned where safe (non-fatal).
// ---------------------------------------------------------------------------

const SAFE_ERROR = "Không thể thực hiện thao tác. Vui lòng thử lại hoặc liên hệ admin.";

// Statuses that may be moved forward to screening_assigned after assignment.
const ADVANCE_STATUSES = new Set(["submitted", "under_data_check", "ready_for_screening"]);

function serviceClient() {
  const client = getSupabaseServiceRoleClient();
  if (!client) {
    console.error("[bulk-assignment] service-role client unavailable");
    return null;
  }
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

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type BulkAssignInput = {
  intakeBatchId: string | null;
  roleApplied: string;
  /** Application statuses to include (must be subset of screeable set). */
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

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

export async function bulkAssignApplicationReviews(
  input: BulkAssignInput
): Promise<BulkAssignResult> {
  const reviewRound = input.reviewRound ?? "profile_screening";
  // --- Basic validation
  if (!input.reviewerAdminUserIds.length) {
    return { ok: false, message: "Vui lòng chọn ít nhất một reviewer." };
  }
  if (!input.statuses.length) {
    return { ok: false, message: "Vui lòng chọn ít nhất một trạng thái đơn." };
  }
  if (!input.roleApplied.trim()) {
    return { ok: false, message: "Vui lòng chọn role ứng tuyển." };
  }
  if (reviewRound !== "profile_screening" && reviewRound !== "interview") {
    return { ok: false, message: "Vòng review không hợp lệ." };
  }
  if (
    reviewRound === "interview" &&
    input.statuses.some((status) => !INTERVIEW_ELIGIBLE_STATUSES.has(status))
  ) {
    return { ok: false, message: "Bộ lọc chứa trạng thái không đủ điều kiện phỏng vấn." };
  }

  const client = serviceClient();
  if (!client) return { ok: false, message: SAFE_ERROR };
  const actor = await getCurrentAdminUser();
  if (
    !actor?.id ||
    actor.id !== input.assignedByAdminUserId ||
    !canBulkAssignReviews(actor.role)
  ) {
    return { ok: false, message: "Bạn không có quyền thực hiện thao tác giao review." };
  }

  const scopeContext = await getAdminScopeContext();
  const scope = await getScopeFilter(scopeContext);

  // --- 1. Fetch eligible applications
  let appQuery = client
    .from("applications")
    .select("id,submitted_at,status,season_id")
    .eq("role_applied", input.roleApplied.trim())
    .in("status", input.statuses)
    .order("submitted_at", { ascending: true })
    .order("id", { ascending: true });

  if (input.intakeBatchId) {
    const { data: batch, error: batchErr } = await client
      .from("intake_batches")
      .select("id,season_id")
      .eq("id", input.intakeBatchId)
      .maybeSingle();
    if (batchErr) {
      log("fetch intake batch", batchErr);
      return { ok: false, message: SAFE_ERROR };
    }
    if (!batch || !(await canOperateSeason(scopeContext, batch.season_id as string | null))) {
      return { ok: false, message: "Ban khong co quyen review trong batch nay." };
    }
    appQuery = appQuery.eq("intake_batch_id", input.intakeBatchId);
  } else if (scope?.allowedSeasonIds) {
    if (!scope.allowedSeasonIds.length) return { ok: false, message: "Ban khong co scope review nao de giao ho so." };
    appQuery = appQuery.in("season_id", scope.allowedSeasonIds);
  }

  const { data: rawApps, error: appsErr } = await appQuery;
  if (appsErr) {
    log("fetch applications", appsErr);
    return { ok: false, message: `Không thể tải danh sách hồ sơ: ${appsErr.message}` };
  }

  const allFetchedApps = (rawApps ?? []) as { id: string; submitted_at: string | null; status: string; season_id: string | null }[];
  const allowedAppChecks = await Promise.all(
    allFetchedApps.map(async (app) => ((await canOperateSeason(scopeContext, app.season_id)) ? app : null))
  );
  const allApps = allowedAppChecks.filter((app): app is { id: string; submitted_at: string | null; status: string; season_id: string | null } => Boolean(app));
  if (!allApps.length) {
    return { ok: false, message: "Không có hồ sơ nào phù hợp với bộ lọc đã chọn." };
  }
  const seasonIds = Array.from(new Set(allApps.map((app) => app.season_id).filter(Boolean))) as string[];
  if (seasonIds.length !== 1) {
    return { ok: false, message: "Mỗi lần phân công chỉ được chứa hồ sơ của một mùa." };
  }
  const reviewerValidation = await validateReviewEligibleReviewers(
    client,
    input.reviewerAdminUserIds,
    seasonIds[0],
    reviewRound
  );
  if (!reviewerValidation.ok) {
    if (reviewerValidation.error) log("validate bulk reviewers", reviewerValidation.error);
    return { ok: false, message: reviewerValidation.message };
  }
  const reviewerIds = reviewerValidation.reviewers.map((reviewer) => reviewer.id);

  // --- 2. Exclude already-assigned apps (if requested)
  let skippedAlreadyAssigned = 0;
  let appsToAssign = allApps;

  if (input.excludeAlreadyAssigned) {
    const appIds = allApps.map((a) => a.id);
    const { data: existingReviews } = await client
      .from("application_reviews")
      .select("application_id")
      .eq("review_round", reviewRound)
      .neq("status", "cancelled")
      .in("application_id", appIds);

    const assignedAppIds = new Set(
      (existingReviews ?? []).map((r) => r.application_id as string).filter(Boolean)
    );
    const unassigned = allApps.filter((a) => !assignedAppIds.has(a.id));
    skippedAlreadyAssigned = allApps.length - unassigned.length;
    appsToAssign = unassigned;
  }

  if (!appsToAssign.length) {
    return {
      ok: false,
      message:
        skippedAlreadyAssigned > 0
          ? `Tất cả ${skippedAlreadyAssigned} hồ sơ đã được giao reviewer. Bỏ chọn "Bỏ qua hồ sơ đã được giao" để giao lại.`
          : "Không có hồ sơ nào để giao sau khi lọc."
    };
  }

  // --- 3. Fetch current workload for each reviewer (for deterministic ordering)
  const { data: workloadRows } = await client
    .from("application_reviews")
    .select("reviewer_admin_user_id")
    .eq("review_round", reviewRound)
    .neq("status", "cancelled")
    .in("reviewer_admin_user_id", reviewerIds);

  const workloadByReviewer = new Map<string, number>(
    reviewerIds.map((id) => [id, 0])
  );
  for (const row of workloadRows ?? []) {
    const id = row.reviewer_admin_user_id as string | null;
    if (id) workloadByReviewer.set(id, (workloadByReviewer.get(id) ?? 0) + 1);
  }

  const emailById = new Map<string, string>(
    reviewerValidation.reviewers.map((reviewer) => [reviewer.id, reviewer.email ?? ""])
  );

  // --- 4. Sort reviewers: workload ASC, email ASC
  const sortedReviewers = [...reviewerIds].sort((a, b) => {
    const wDiff = (workloadByReviewer.get(a) ?? 0) - (workloadByReviewer.get(b) ?? 0);
    if (wDiff !== 0) return wDiff;
    return (emailById.get(a) ?? "").localeCompare(emailById.get(b) ?? "");
  });

  // --- 5. Build proposed review rows (round-robin by sorted reviewer index)
  const now = new Date().toISOString();
  const n = sortedReviewers.length;
  let reviewRows = appsToAssign.map((app, i) => ({
    application_id: app.id,
    review_round: reviewRound,
    reviewer_admin_user_id: sortedReviewers[i % n],
    assigned_by: input.assignedByAdminUserId,
    assigned_at: now,
    due_at: input.dueAt ?? null,
    status: "assigned" as const
  }));

  // Sequential pair-level duplicate guard, including when the caller elects
  // not to exclude candidates that already have some other reviewer.
  const { data: existingAllReviews, error: existingAllError } = await client
    .from("application_reviews")
    .select("application_id, reviewer_admin_user_id")
    .eq("review_round", reviewRound)
    .neq("status", "cancelled")
    .in("application_id", appsToAssign.map(a => a.id))
    .in("reviewer_admin_user_id", sortedReviewers);

  if (existingAllError) {
    log("check bulk assignment duplicates", existingAllError);
    return { ok: false, message: SAFE_ERROR };
  }

  if (existingAllReviews && existingAllReviews.length > 0) {
    const existingSet = new Set(existingAllReviews.map(r => `${r.application_id}-${r.reviewer_admin_user_id}`));
    const beforeDedup = reviewRows.length;
    reviewRows = reviewRows.filter(r => !existingSet.has(`${r.application_id}-${r.reviewer_admin_user_id}`));
    skippedAlreadyAssigned += beforeDedup - reviewRows.length;
  }

  if (reviewRows.length === 0) {
    return { ok: false, message: "Tất cả các ứng viên đã được giao cho những người phỏng vấn này rồi." };
  }

  const actualReviewerIds = Array.from(
    new Set(reviewRows.map((row) => row.reviewer_admin_user_id))
  );

  // --- 6. Record a batch using the rows that will actually be inserted.
  let batchId: string | null = null;
  try {
    const { data: batchRow, error: batchErr } = await client
      .from("review_assignment_batches")
      .insert({
        intake_batch_id: input.intakeBatchId ?? null,
        review_round: reviewRound,
        created_by: input.assignedByAdminUserId,
        due_at: input.dueAt ?? null,
        assignment_note: input.assignmentNote ?? null,
        application_count: reviewRows.length,
        reviewer_count: actualReviewerIds.length
      })
      .select("id")
      .maybeSingle();
    if (batchErr) {
      log("insert review_assignment_batches (non-fatal)", batchErr);
    } else {
      batchId = (batchRow as { id: string } | null)?.id ?? null;
    }
  } catch {
    log("review_assignment_batches insert threw (non-fatal)", "table may not exist");
  }

  reviewRows = reviewRows.map((row) => ({ ...row, assignment_batch_id: batchId }));

  // --- 7. Bulk insert (PostgREST insert is all-or-nothing on error).
  const { error: insertErr } = await client.from("application_reviews").insert(reviewRows);
  if (insertErr) {
    log("bulk insert application_reviews", insertErr);
    return { ok: false, message: `Không thể tạo review assignments: ${insertErr.message}` };
  }

  // --- 8. Advance applications.status -> screening_assigned / interview_in_progress
  const insertedApplicationIds = new Set(reviewRows.map((row) => row.application_id));
  const advanceIds = appsToAssign
    .filter((app) => insertedApplicationIds.has(app.id))
    .filter((app) =>
      reviewRound === "interview"
        ? ["invited_to_interview", "interview_scheduled"].includes(app.status)
        : ADVANCE_STATUSES.has(app.status)
    )
    .map((app) => app.id);

  if (advanceIds.length > 0) {
    const targetStatus = reviewRound === "interview" ? "interview_in_progress" : "screening_assigned";
    const { error: updateErr } = await client
      .from("applications")
      .update({ status: targetStatus })
      .in("id", advanceIds)
      .in(
        "status",
        reviewRound === "interview"
          ? ["invited_to_interview", "interview_scheduled"]
          : Array.from(ADVANCE_STATUSES)
      );
    if (updateErr) {
      log(`update applications.status to ${targetStatus} (non-fatal)`, updateErr);
    }
  }

  // --- Compute distribution stats
  const perReviewerCounts = actualReviewerIds.map((reviewerId) =>
    reviewRows.filter((row) => row.reviewer_admin_user_id === reviewerId).length
  );
  const minPerReviewer = perReviewerCounts.length ? Math.min(...perReviewerCounts) : 0;
  const maxPerReviewer = perReviewerCounts.length ? Math.max(...perReviewerCounts) : 0;

  return {
    ok: true,
    applicationsAssigned: reviewRows.length,
    reviewersCount: actualReviewerIds.length,
    minPerReviewer,
    maxPerReviewer,
    skippedAlreadyAssigned,
    batchId: batchId ?? ""
  };
}
