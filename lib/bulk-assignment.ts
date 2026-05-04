import "server-only";

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

  const client = serviceClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  // --- 1. Fetch eligible applications
  let appQuery = client
    .from("applications")
    .select("id,submitted_at,status")
    .eq("role_applied", input.roleApplied.trim())
    .in("status", input.statuses)
    .order("submitted_at", { ascending: true })
    .order("id", { ascending: true });

  if (input.intakeBatchId) {
    appQuery = appQuery.eq("intake_batch_id", input.intakeBatchId);
  }

  const { data: rawApps, error: appsErr } = await appQuery;
  if (appsErr) {
    log("fetch applications", appsErr);
    return { ok: false, message: `Không thể tải danh sách hồ sơ: ${appsErr.message}` };
  }

  const allApps = (rawApps ?? []) as { id: string; submitted_at: string | null; status: string }[];
  if (!allApps.length) {
    return { ok: false, message: "Không có hồ sơ nào phù hợp với bộ lọc đã chọn." };
  }

  // --- 2. Exclude already-assigned apps (if requested)
  let skippedAlreadyAssigned = 0;
  let appsToAssign = allApps;

  if (input.excludeAlreadyAssigned) {
    const appIds = allApps.map((a) => a.id);
    const { data: existingReviews } = await client
      .from("application_reviews")
      .select("application_id")
      .eq("review_round", "profile_screening")
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
    .eq("review_round", "profile_screening")
    .neq("status", "cancelled")
    .in("reviewer_admin_user_id", input.reviewerAdminUserIds);

  const workloadByReviewer = new Map<string, number>(
    input.reviewerAdminUserIds.map((id) => [id, 0])
  );
  for (const row of workloadRows ?? []) {
    const id = row.reviewer_admin_user_id as string | null;
    if (id) workloadByReviewer.set(id, (workloadByReviewer.get(id) ?? 0) + 1);
  }

  // Fetch emails for tiebreaking
  const { data: reviewerRows } = await client
    .from("admin_users")
    .select("id,email")
    .in("id", input.reviewerAdminUserIds);

  const emailById = new Map<string, string>(
    (reviewerRows ?? []).map((r) => [r.id as string, (r.email as string) ?? ""])
  );

  // --- 4. Sort reviewers: workload ASC, email ASC
  const sortedReviewers = [...input.reviewerAdminUserIds].sort((a, b) => {
    const wDiff = (workloadByReviewer.get(a) ?? 0) - (workloadByReviewer.get(b) ?? 0);
    if (wDiff !== 0) return wDiff;
    return (emailById.get(a) ?? "").localeCompare(emailById.get(b) ?? "");
  });

  // --- 5. Create review_assignment_batches audit row (non-fatal if missing table)
  let batchId: string | null = null;
  try {
    const { data: batchRow, error: batchErr } = await client
      .from("review_assignment_batches")
      .insert({
        intake_batch_id: input.intakeBatchId ?? null,
        review_round: "profile_screening",
        created_by: input.assignedByAdminUserId,
        due_at: input.dueAt ?? null,
        assignment_note: input.assignmentNote ?? null,
        application_count: appsToAssign.length,
        reviewer_count: sortedReviewers.length
      })
      .select("id")
      .maybeSingle();
    if (batchErr) {
      log("insert review_assignment_batches (non-fatal)", batchErr);
    } else {
      batchId = (batchRow as { id: string } | null)?.id ?? null;
    }
  } catch {
    // Table may not exist yet — proceed without batch tracking
    log("review_assignment_batches insert threw (non-fatal)", "table may not exist");
  }

  // --- 6. Build review rows (round-robin by sorted reviewer index)
  const now = new Date().toISOString();
  const n = sortedReviewers.length;
  const reviewRows = appsToAssign.map((app, i) => ({
    application_id: app.id,
    review_round: "profile_screening" as const,
    reviewer_admin_user_id: sortedReviewers[i % n],
    assigned_by: input.assignedByAdminUserId,
    assigned_at: now,
    due_at: input.dueAt ?? null,
    status: "assigned" as const,
    assignment_batch_id: batchId
  }));

  // --- 7. Bulk insert
  const { error: insertErr } = await client.from("application_reviews").insert(reviewRows);
  if (insertErr) {
    log("bulk insert application_reviews", insertErr);
    return { ok: false, message: `Không thể tạo review assignments: ${insertErr.message}` };
  }

  // --- 8. Advance applications.status → screening_assigned (non-fatal)
  const advanceIds = appsToAssign
    .filter((a) => ADVANCE_STATUSES.has(a.status))
    .map((a) => a.id);

  if (advanceIds.length > 0) {
    const { error: updateErr } = await client
      .from("applications")
      .update({ status: "screening_assigned" })
      .in("id", advanceIds);
    if (updateErr) {
      log("update applications.status to screening_assigned (non-fatal)", updateErr);
    }
  }

  // --- Compute distribution stats
  const perReviewerCounts = sortedReviewers.map((_, i) =>
    reviewRows.filter((_, j) => j % n === i).length
  );
  const minPerReviewer = perReviewerCounts.length ? Math.min(...perReviewerCounts) : 0;
  const maxPerReviewer = perReviewerCounts.length ? Math.max(...perReviewerCounts) : 0;

  return {
    ok: true,
    applicationsAssigned: appsToAssign.length,
    reviewersCount: sortedReviewers.length,
    minPerReviewer,
    maxPerReviewer,
    skippedAlreadyAssigned,
    batchId: batchId ?? ""
  };
}
