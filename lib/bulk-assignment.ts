import "server-only";

import { canReviewSeason, getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { canReview } from "@/lib/permissions";
import { sendReviewBatchAssigned } from "@/lib/email";
import { SEASON_CONFIG } from "@/lib/season-config";

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
  /**
   * Most applications one reviewer may receive in this run. The Season 12
   * process hands out batches of ten so a mentor sees a finite, finishable
   * pile. Null means "no cap", the pre-Season-12 behaviour.
   */
  maxPerReviewer?: number | null;
  /** Email each reviewer the size of their new batch. */
  notifyReviewers?: boolean;
  seasonLabel?: string | null;
};

export type BulkAssignResult =
  | {
      ok: true;
      applicationsAssigned: number;
      reviewersCount: number;
      minPerReviewer: number;
      maxPerReviewer: number;
      skippedAlreadyAssigned: number;
      /** Eligible applications left over because every reviewer hit the cap. */
      unassignedDueToCap: number;
      notifiedReviewers: number;
      notifyFailures: number;
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
  const scopeContext = await getAdminScopeContext();
  const scope = await getScopeFilter(scopeContext);

  // --- 0. The reviewer ids arrive from a form, so verify them before writing
  // hundreds of rows against them. Without this an id belonging to a viewer —
  // or to nobody — is stored as reviewer_admin_user_id and the applications
  // land with someone who cannot open them.
  const { data: reviewerRowsForCheck, error: reviewerCheckErr } = await client
    .from("admin_users")
    .select("id,email,full_name,role,status")
    .in("id", input.reviewerAdminUserIds);

  if (reviewerCheckErr) {
    log("reviewer validation lookup", reviewerCheckErr);
    return { ok: false, message: SAFE_ERROR };
  }

  const reviewerById = new Map(
    ((reviewerRowsForCheck ?? []) as Array<{
      id: string;
      email: string | null;
      full_name: string | null;
      role: string | null;
      status: string | null;
    }>).map((row) => [row.id, row])
  );

  const invalidReviewers = input.reviewerAdminUserIds.filter((id) => {
    const row = reviewerById.get(id);
    if (!row) return true;
    if (String(row.status ?? "") !== "active") return true;
    return !canReview(row.role);
  });

  if (invalidReviewers.length > 0) {
    return {
      ok: false,
      message: `${invalidReviewers.length} reviewer được chọn không hợp lệ (tài khoản không tồn tại, đang khoá, hoặc không có quyền chấm). Vui lòng tải lại danh sách reviewer.`
    };
  }

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
    if (!batch || !(await canReviewSeason(scopeContext, batch.season_id as string | null))) {
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
    allFetchedApps.map(async (app) => ((await canReviewSeason(scopeContext, app.season_id)) ? app : null))
  );
  const allApps = allowedAppChecks.filter((app): app is { id: string; submitted_at: string | null; status: string; season_id: string | null } => Boolean(app));
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

  // Emails come from the validation lookup above — no second round trip.
  const emailById = new Map<string, string>(
    input.reviewerAdminUserIds.map((id) => [id, reviewerById.get(id)?.email ?? ""])
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

  // --- 6. Build review rows: round-robin, but never past the per-reviewer cap.
  //
  // Reviewers are already ordered by current workload, so the first pass gives
  // the least-loaded mentors their first application, the second pass their
  // second, and so on. A reviewer who reaches the cap drops out; when everyone
  // is full the remaining applications are left for the next round and reported
  // back rather than silently dropped.
  const now = new Date().toISOString();
  const cap =
    input.maxPerReviewer && input.maxPerReviewer > 0
      ? Math.floor(input.maxPerReviewer)
      : Number.POSITIVE_INFINITY;

  const assignedCountByReviewer = new Map<string, number>(sortedReviewers.map((id) => [id, 0]));
  const reviewRows: Array<Record<string, unknown>> = [];
  let cursor = 0;

  for (const app of appsToAssign) {
    // Find the next reviewer with room; stop when nobody has any.
    let reviewerId: string | null = null;
    for (let step = 0; step < sortedReviewers.length; step++) {
      const candidate = sortedReviewers[(cursor + step) % sortedReviewers.length];
      if ((assignedCountByReviewer.get(candidate) ?? 0) < cap) {
        reviewerId = candidate;
        cursor = (cursor + step + 1) % sortedReviewers.length;
        break;
      }
    }
    if (!reviewerId) break;

    assignedCountByReviewer.set(reviewerId, (assignedCountByReviewer.get(reviewerId) ?? 0) + 1);
    reviewRows.push({
      application_id: app.id,
      review_round: "profile_screening" as const,
      reviewer_admin_user_id: reviewerId,
      assigned_by: input.assignedByAdminUserId,
      assigned_at: now,
      due_at: input.dueAt ?? null,
      status: "assigned" as const,
      assignment_batch_id: batchId
    });
  }

  const unassignedDueToCap = appsToAssign.length - reviewRows.length;

  if (reviewRows.length === 0) {
    return {
      ok: false,
      message: `Tất cả reviewer đã đạt giới hạn ${input.maxPerReviewer} hồ sơ trong lượt này. Chọn thêm reviewer hoặc tăng giới hạn.`
    };
  }

  // --- 7. Bulk insert
  const { error: insertErr } = await client.from("application_reviews").insert(reviewRows);
  if (insertErr) {
    log("bulk insert application_reviews", insertErr);
    return { ok: false, message: `Không thể tạo review assignments: ${insertErr.message}` };
  }

  // --- 8. Advance applications.status → screening_assigned (non-fatal)
  const assignedAppIds = new Set(reviewRows.map((row) => row.application_id as string));
  const advanceIds = appsToAssign
    .filter((a) => assignedAppIds.has(a.id) && ADVANCE_STATUSES.has(a.status))
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

  // --- 9. Tell each reviewer what is waiting for them (non-fatal).
  //
  // A batch nobody knows about is a batch nobody scores, so this is part of
  // assigning — but a mail failure must never undo rows that are already
  // written, hence the per-reviewer try/catch and the counters in the result.
  let notifiedReviewers = 0;
  let notifyFailures = 0;

  if (input.notifyReviewers) {
    for (const reviewerId of sortedReviewers) {
      const count = assignedCountByReviewer.get(reviewerId) ?? 0;
      if (count === 0) continue;
      const reviewer = reviewerById.get(reviewerId);
      const email = String(reviewer?.email ?? "").trim();
      if (!email) {
        notifyFailures++;
        continue;
      }
      try {
        const sent = await sendReviewBatchAssigned({
          toEmail: email,
          reviewerName: reviewer?.full_name ?? "",
          seasonLabel: input.seasonLabel ?? SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE,
          assignmentCount: count,
          dueLabel: input.dueAt ? new Date(input.dueAt).toLocaleDateString("vi-VN") : null,
          assignmentBatchId: batchId
        });
        if (sent.ok && !sent.skipped) notifiedReviewers++;
        else if (!sent.ok) notifyFailures++;
      } catch (err) {
        log("reviewer notification email (non-fatal)", err);
        notifyFailures++;
      }
    }
  }

  // --- Compute distribution stats from what was actually written
  const perReviewerCounts = sortedReviewers
    .map((id) => assignedCountByReviewer.get(id) ?? 0)
    .filter((count) => count > 0);
  const minPerReviewer = perReviewerCounts.length ? Math.min(...perReviewerCounts) : 0;
  const maxPerReviewer = perReviewerCounts.length ? Math.max(...perReviewerCounts) : 0;

  return {
    ok: true,
    applicationsAssigned: reviewRows.length,
    reviewersCount: perReviewerCounts.length,
    minPerReviewer,
    maxPerReviewer,
    skippedAlreadyAssigned,
    unassignedDueToCap,
    notifiedReviewers,
    notifyFailures,
    batchId: batchId ?? ""
  };
}
