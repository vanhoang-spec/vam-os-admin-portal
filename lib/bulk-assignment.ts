import "server-only";

import { canReviewSeason, getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { readAllPages } from "@/lib/paged-read";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

// ---------------------------------------------------------------------------
// Phase 044a — Bulk-assign applications to reviewers for profile screening.
//
// Algorithm:
//   1. Fetch eligible applications (batch + role + statuses).
//   2. Optionally skip apps that already have two active profile_screening reviewers.
//   3. Sort apps: submitted_at ASC, id ASC (deterministic).
//   4. Fetch workload for each selected reviewer (count of existing active
//      profile_screening reviews across all batches).
//   5. Sort reviewers: current_workload ASC, email ASC (deterministic).
//   6. Round-robin assign two distinct reviewers per application.
//   7. Atomically create the audit batch, review rows, and application states.
// ---------------------------------------------------------------------------

const SAFE_ERROR = "Không thể thực hiện thao tác. Vui lòng thử lại hoặc liên hệ admin.";

const DEFAULT_REVIEWERS_PER_APPLICATION = 2;
const MAX_REVIEWERS_PER_APPLICATION = 2;
export const APPLICATION_ID_CHUNK_SIZE = 200;

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
  reviewersPerApplication?: number;
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

export type RoundRobinApplication = {
  id: string;
  existingReviewerIds?: readonly string[];
};

export type RoundRobinAssignment = {
  applicationId: string;
  reviewerAdminUserId: string;
};

/**
 * Build deterministic round-robin pairs while keeping reviewers independent.
 * Existing active reviewers always count toward the target. If the selected
 * pool cannot completely top up one application, the available assignments are
 * retained and processing continues for the remaining applications.
 */
export function buildRoundRobinAssignments(
  applications: readonly RoundRobinApplication[],
  reviewerAdminUserIds: readonly string[],
  reviewersPerApplication = DEFAULT_REVIEWERS_PER_APPLICATION
): RoundRobinAssignment[] {
  const reviewers = Array.from(new Set(reviewerAdminUserIds));
  if (!Number.isInteger(reviewersPerApplication) || reviewersPerApplication < 1 || reviewersPerApplication > MAX_REVIEWERS_PER_APPLICATION) {
    throw new Error("reviewersPerApplication must be an integer between 1 and 2.");
  }

  const assignments: RoundRobinAssignment[] = [];
  let cursor = 0;

  for (const application of applications) {
    const existing = new Set((application.existingReviewerIds ?? []).filter(Boolean));
    const assignmentsNeeded = Math.max(0, reviewersPerApplication - existing.size);
    const selectedForApplication = new Set<string>();
    let candidatesChecked = 0;

    while (selectedForApplication.size < assignmentsNeeded && candidatesChecked < reviewers.length) {
      const reviewerId = reviewers[cursor % reviewers.length];
      cursor += 1;
      candidatesChecked += 1;
      if (existing.has(reviewerId) || selectedForApplication.has(reviewerId)) continue;
      selectedForApplication.add(reviewerId);
      assignments.push({ applicationId: application.id, reviewerAdminUserId: reviewerId });
    }
  }

  return assignments;
}

function chunkValues<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

type ExistingReviewRow = {
  id: string;
  application_id: string | null;
  reviewer_admin_user_id: string | null;
};

type WorkloadReviewRow = {
  id: string;
  reviewer_admin_user_id: string | null;
};

/** Fetches complete active profile-review rows without a 1000-row truncation. */
export async function readExistingProfileReviews(
  client: any,
  applicationIds: readonly string[]
): Promise<{ data: ExistingReviewRow[]; error: unknown | null }> {
  const rows: ExistingReviewRow[] = [];
  for (const idChunk of chunkValues(applicationIds, APPLICATION_ID_CHUNK_SIZE)) {
    const result = await readAllPages<ExistingReviewRow>(
      "application_reviews",
      "application_id,reviewer_admin_user_id",
      (projection) => client
        .from("application_reviews")
        .select(projection)
        .eq("review_round", "profile_screening")
        .neq("status", "cancelled")
        .in("application_id", idChunk)
    );
    if (result.error) return { data: rows, error: result.error };
    rows.push(...result.data);
  }
  return { data: rows, error: null };
}

/** Fetches complete workload rows for the selected reviewer pool. */
export async function readActiveProfileReviewWorkloads(
  client: any,
  reviewerAdminUserIds: readonly string[]
): Promise<{ data: WorkloadReviewRow[]; error: unknown | null }> {
  const rows: WorkloadReviewRow[] = [];
  for (const idChunk of chunkValues(reviewerAdminUserIds, APPLICATION_ID_CHUNK_SIZE)) {
    const result = await readAllPages<WorkloadReviewRow>(
      "application_reviews",
      "reviewer_admin_user_id",
      (projection) => client
        .from("application_reviews")
        .select(projection)
        .eq("review_round", "profile_screening")
        .neq("status", "cancelled")
        .in("reviewer_admin_user_id", idChunk)
    );
    if (result.error) return { data: rows, error: result.error };
    rows.push(...result.data);
  }
  return { data: rows, error: null };
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

export async function bulkAssignApplicationReviews(
  input: BulkAssignInput
): Promise<BulkAssignResult> {
  // --- Basic validation
  const reviewersPerApplication = input.reviewersPerApplication ?? DEFAULT_REVIEWERS_PER_APPLICATION;
  if (!Number.isInteger(reviewersPerApplication) || reviewersPerApplication < 1 || reviewersPerApplication > MAX_REVIEWERS_PER_APPLICATION) {
    return { ok: false, message: "Số reviewer mỗi hồ sơ phải từ 1 đến 2." };
  }
  const distinctReviewerIds = Array.from(new Set(input.reviewerAdminUserIds));
  if (distinctReviewerIds.length < reviewersPerApplication) {
    return { ok: false, message: `Vui lòng chọn ít nhất ${reviewersPerApplication} reviewer khác nhau.` };
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

  // --- 2. Load active assignments, then either exclude assigned apps or top up
  let skippedAlreadyAssigned = 0;
  let appsToAssign = allApps;
  const appIds = allApps.map((a) => a.id);
  const { data: existingReviews, error: existingReviewsErr } = await readExistingProfileReviews(client, appIds);

  if (existingReviewsErr) {
    log("fetch existing profile_screening reviews", existingReviewsErr);
    return { ok: false, message: SAFE_ERROR };
  }

  const existingReviewersByAppId = new Map<string, Set<string>>();
  for (const row of existingReviews ?? []) {
    const applicationId = row.application_id as string | null;
    const reviewerId = row.reviewer_admin_user_id as string | null;
    if (!applicationId || !reviewerId) continue;
    const reviewers = existingReviewersByAppId.get(applicationId) ?? new Set<string>();
    reviewers.add(reviewerId);
    existingReviewersByAppId.set(applicationId, reviewers);
  }

  if (input.excludeAlreadyAssigned) {
    appsToAssign = allApps.filter(
      (app) => (existingReviewersByAppId.get(app.id)?.size ?? 0) === 0
    );
    skippedAlreadyAssigned = allApps.length - appsToAssign.length;
  } else {
    appsToAssign = allApps.filter(
      (app) => (existingReviewersByAppId.get(app.id)?.size ?? 0) < reviewersPerApplication
    );
    skippedAlreadyAssigned = allApps.length - appsToAssign.length;
  }

  if (!appsToAssign.length) {
    return {
      ok: false,
      message:
        skippedAlreadyAssigned > 0
          ? `Không còn hồ sơ nào cần giao để đạt mục tiêu ${reviewersPerApplication} reviewer.`
          : "Không có hồ sơ nào để giao sau khi lọc."
    };
  }

  // --- 3. Fetch current workload for each reviewer (for deterministic ordering)
  const { data: workloadRows, error: workloadErr } = await readActiveProfileReviewWorkloads(
    client,
    distinctReviewerIds
  );

  if (workloadErr) {
    log("fetch reviewer workload", workloadErr);
    return { ok: false, message: SAFE_ERROR };
  }

  const workloadByReviewer = new Map<string, number>(
    distinctReviewerIds.map((id) => [id, 0])
  );
  for (const row of workloadRows ?? []) {
    const id = row.reviewer_admin_user_id as string | null;
    if (id) workloadByReviewer.set(id, (workloadByReviewer.get(id) ?? 0) + 1);
  }

  // Fetch emails for tiebreaking
  const { data: reviewerRows } = await client
    .from("admin_users")
    .select("id,email")
    .in("id", distinctReviewerIds);

  const emailById = new Map<string, string>(
    (reviewerRows ?? []).map((r) => [r.id as string, (r.email as string) ?? ""])
  );

  // --- 4. Sort reviewers: workload ASC, email ASC
  const sortedReviewers = [...distinctReviewerIds].sort((a, b) => {
    const wDiff = (workloadByReviewer.get(a) ?? 0) - (workloadByReviewer.get(b) ?? 0);
    if (wDiff !== 0) return wDiff;
    return (emailById.get(a) ?? "").localeCompare(emailById.get(b) ?? "");
  });

  // --- 5. Build assignment pairs before creating the audit row
  let assignmentPairs: RoundRobinAssignment[];
  try {
    assignmentPairs = buildRoundRobinAssignments(
      appsToAssign.map((app) => ({
        id: app.id,
        existingReviewerIds: Array.from(existingReviewersByAppId.get(app.id) ?? [])
      })),
      sortedReviewers,
      reviewersPerApplication
    );
  } catch (error) {
    log("build round-robin assignments", error);
    return {
      ok: false,
      message: `Không đủ reviewer khác nhau để đạt mục tiêu ${reviewersPerApplication} reviewer độc lập.`
    };
  }

  if (!assignmentPairs.length) {
    return { ok: false, message: "Các hồ sơ đã có đủ reviewer; không có phân công mới để tạo." };
  }

  const assignedApplicationIds = new Set(assignmentPairs.map((pair) => pair.applicationId));

  // --- 6. Persist the batch, assignments, and status changes in one DB transaction
  const { data: batchId, error: atomicErr } = await client.rpc(
    "vam081_bulk_assign_reviews_atomic",
    {
      p_batch: {
        intake_batch_id: input.intakeBatchId ?? null,
        due_at: input.dueAt ?? null,
        assignment_note: input.assignmentNote ?? null
      },
      p_pairs: assignmentPairs.map((pair) => ({
        application_id: pair.applicationId,
        reviewer_admin_user_id: pair.reviewerAdminUserId
      })),
      p_actor: input.assignedByAdminUserId
    }
  );
  if (atomicErr || !batchId) {
    log("atomic bulk review assignment RPC failed", atomicErr ?? "RPC returned no batch id");
    return {
      ok: false,
      message: SAFE_ERROR
    };
  }

  // --- Compute distribution stats
  const perReviewerCounts = sortedReviewers.map(
    (reviewerId) => assignmentPairs.filter((pair) => pair.reviewerAdminUserId === reviewerId).length
  );
  const minPerReviewer = perReviewerCounts.length ? Math.min(...perReviewerCounts) : 0;
  const maxPerReviewer = perReviewerCounts.length ? Math.max(...perReviewerCounts) : 0;

  return {
    ok: true,
    applicationsAssigned: assignedApplicationIds.size,
    reviewersCount: sortedReviewers.length,
    minPerReviewer,
    maxPerReviewer,
    skippedAlreadyAssigned,
    batchId: batchId as string
  };
}
