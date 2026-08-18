import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { isValidUuid } from "@/lib/events";
import { resolveMentorCap } from "@/lib/mentor-confirmations-core";
import { canDecide } from "@/lib/permissions";
import { canOperateSeason, canReadSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import {
  buildSelectionPlan,
  DEFAULT_RESERVE_PCT,
  statusForGroup,
  summarizePlan,
  type SelectionCandidate,
  type SelectionGroup,
  type SelectionPlan,
  type SelectionSummary
} from "@/lib/selection-core";

/**
 * lib/selection.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Turning scores into an interview list.
 *
 * A run is computed and stored as a draft (migration 066), looked at, and only
 * then applied. Applying is the single moment application statuses change:
 * the main group becomes `invited_to_interview`, the reserve becomes
 * `waitlisted`, and everyone else is left exactly as they were — "not selected"
 * is a decision the organisers make deliberately, not a side effect of ranking.
 *
 * The number of places comes from the mentors themselves: the sum of the
 * capacities they confirmed for the season (migration 064). No mentors, no
 * places, and the run refuses to apply.
 *
 * Authorization lives here, not in the action: every write needs `canDecide`
 * plus operations scope on the season.
 */

const SAFE_ERROR = "Không thể thực hiện thao tác. Vui lòng thử lại hoặc liên hệ admin.";

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string; details?: string };
  console.error("[selection]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint,
    details: err?.details
  });
}

function clientResult() {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { client: null, error: "Thiếu SUPABASE_SERVICE_ROLE_KEY trên server." as string | null };
  return { client, error: null as string | null };
}

export type MutationResult = { ok: boolean; message: string; runId?: string };

// ── Guards ────────────────────────────────────────────────────────────────────

async function requireSelectionOperator(seasonId: string) {
  const admin = await getCurrentAdminUser();
  if (!canDecide(admin?.role)) {
    return { ok: false as const, message: "Bạn không có quyền chốt danh sách phỏng vấn." };
  }
  const ctx = await getAdminScopeContext();
  if (!(await canOperateSeason(ctx, seasonId))) {
    return { ok: false as const, message: "Bạn không có quyền vận hành mùa này." };
  }
  return { ok: true as const, admin };
}

// ── Row shapes ────────────────────────────────────────────────────────────────

export type SelectionRunRow = {
  id: string;
  season_id: string;
  intake_batch_id: string | null;
  role_applied: string;
  capacity_total: number;
  reserve_pct: number;
  scored_count: number;
  unscored_count: number;
  main_count: number;
  reserve_count: number;
  status: string;
  note: string | null;
  applied_at: string | null;
  created_at: string;
};

export type SelectionRunItemRow = {
  id: string;
  run_id: string;
  application_id: string;
  rank: number;
  total_score: number | null;
  review_count: number;
  selection_group: SelectionGroup;
  tie_break_note: string | null;
  applied_status: string | null;
  promoted_at: string | null;
};

export type SelectionRunItemView = SelectionRunItemRow & {
  full_name: string | null;
  email_primary: string | null;
  application_status: string | null;
};

const RUN_COLUMNS =
  "id,season_id,intake_batch_id,role_applied,capacity_total,reserve_pct,scored_count," +
  "unscored_count,main_count,reserve_count,status,note,applied_at,created_at";

const ITEM_COLUMNS =
  "id,run_id,application_id,rank,total_score,review_count,selection_group,tie_break_note," +
  "applied_status,promoted_at";

// ── Audit log ─────────────────────────────────────────────────────────────────

async function writeRunLog(
  client: NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>,
  input: {
    runId: string;
    seasonId: string;
    action: "created" | "applied" | "discarded" | "reserve_promoted";
    applicationId?: string | null;
    detail?: Record<string, unknown> | null;
    reason?: string | null;
    actorAdminUserId?: string | null;
  }
) {
  try {
    const { error } = await client.from("selection_run_log").insert({
      run_id: input.runId,
      season_id: input.seasonId,
      action: input.action,
      application_id: input.applicationId ?? null,
      detail: input.detail ?? null,
      reason: input.reason ? input.reason.slice(0, 500) : null,
      actor_admin_user_id: input.actorAdminUserId ?? null
    });
    if (error) log("run log insert failed", error);
  } catch (err) {
    log("run log crashed", err);
  }
}

// ── Capacity ──────────────────────────────────────────────────────────────────

/**
 * Mentee places for a season: the sum of every confirmed mentor's capacity,
 * including slots core_team granted. This is the number the interview list is
 * cut to.
 */
export async function computeSeasonCapacity(seasonId: string): Promise<number> {
  const { client } = clientResult();
  if (!client || !isValidUuid(seasonId)) return 0;

  const { data, error } = await client
    .from("mentor_season_confirmations")
    .select("status,max_mentees,extra_slots")
    .eq("season_id", seasonId)
    .eq("status", "confirmed");

  if (error) {
    log("capacity lookup failed", error);
    return 0;
  }

  return ((data ?? []) as Array<{ status: string; max_mentees: number | null; extra_slots: number | null }>).reduce(
    (total, row) => total + resolveMentorCap(row),
    0
  );
}

// ── Candidate loading ─────────────────────────────────────────────────────────

/**
 * Applications in a batch with their screening score.
 *
 * The score is the average of the submitted screening reviews, so an
 * application reviewed by two mentors is comparable with one reviewed by three.
 * Review count is carried alongside and breaks ties in favour of the
 * better-evidenced score.
 */
async function loadCandidates(
  client: NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>,
  input: { intakeBatchId: string; roleApplied: string }
): Promise<{ candidates: SelectionCandidate[]; error: string | null }> {
  const { data: appRows, error: appErr } = await client
    .from("applications")
    .select("id,submitted_at,status")
    .eq("intake_batch_id", input.intakeBatchId)
    .eq("role_applied", input.roleApplied);

  if (appErr) {
    log("candidate applications lookup failed", appErr);
    return { candidates: [], error: SAFE_ERROR };
  }

  const apps = (appRows ?? []) as Array<{ id: string; submitted_at: string | null; status: string }>;
  if (apps.length === 0) return { candidates: [], error: null };

  // Withdrawn and rejected applications are out of the running entirely; they
  // must not occupy a place in the ranking.
  const EXCLUDED = new Set(["withdrawn", "rejected_or_not_fit"]);
  const eligible = apps.filter((app) => !EXCLUDED.has(String(app.status ?? "")));
  if (eligible.length === 0) return { candidates: [], error: null };

  const { data: reviewRows, error: reviewErr } = await client
    .from("application_reviews")
    .select("application_id,total_score,status,review_round")
    .eq("review_round", "profile_screening")
    .eq("status", "submitted")
    .in(
      "application_id",
      eligible.map((app) => app.id)
    );

  if (reviewErr) {
    log("candidate reviews lookup failed", reviewErr);
    return { candidates: [], error: SAFE_ERROR };
  }

  const scoresByApplication = new Map<string, number[]>();
  for (const row of (reviewRows ?? []) as Array<{ application_id: string; total_score: number | null }>) {
    if (row.total_score === null || row.total_score === undefined) continue;
    const list = scoresByApplication.get(row.application_id) ?? [];
    list.push(Number(row.total_score));
    scoresByApplication.set(row.application_id, list);
  }

  const candidates: SelectionCandidate[] = eligible.map((app) => {
    const scores = scoresByApplication.get(app.id) ?? [];
    const average =
      scores.length > 0
        ? Math.round((scores.reduce((sum, value) => sum + value, 0) / scores.length) * 100) / 100
        : null;
    return {
      applicationId: app.id,
      totalScore: average,
      reviewCount: scores.length,
      submittedAt: app.submitted_at
    };
  });

  return { candidates, error: null };
}

// ── Create ────────────────────────────────────────────────────────────────────

export type CreateRunResult = MutationResult & {
  summary?: SelectionSummary;
};

/**
 * Compute a ranking and store it as a draft.
 *
 * Deliberately refuses when a draft already exists for this batch and role: two
 * competing proposals, each looking authoritative, is exactly the confusion the
 * unique index in migration 066 exists to prevent.
 */
export async function createSelectionRun(input: {
  intakeBatchId: string;
  roleApplied?: string;
  reservePct?: number;
  note?: string | null;
}): Promise<CreateRunResult> {
  if (!isValidUuid(input.intakeBatchId)) {
    return { ok: false, message: "Thiếu hoặc sai mã đợt tuyển." };
  }

  const roleApplied = (input.roleApplied ?? "mentee").trim() || "mentee";
  const reservePct = Number.isFinite(input.reservePct) ? Number(input.reservePct) : DEFAULT_RESERVE_PCT;
  if (reservePct < 0 || reservePct > 100) {
    return { ok: false, message: "Tỉ lệ dự phòng phải từ 0 đến 100." };
  }

  const { client, error: clientError } = clientResult();
  if (!client) return { ok: false, message: clientError ?? SAFE_ERROR };

  const { data: batch, error: batchErr } = await client
    .from("intake_batches")
    .select("id,season_id")
    .eq("id", input.intakeBatchId)
    .maybeSingle();

  if (batchErr) {
    log("batch lookup failed", batchErr);
    return { ok: false, message: SAFE_ERROR };
  }
  const seasonId = (batch as { season_id?: string | null } | null)?.season_id ?? null;
  if (!seasonId) return { ok: false, message: "Không tìm thấy đợt tuyển." };

  const guard = await requireSelectionOperator(seasonId);
  if (!guard.ok) return { ok: false, message: guard.message };

  const { data: existingDraft, error: draftErr } = await client
    .from("selection_runs")
    .select("id")
    .eq("intake_batch_id", input.intakeBatchId)
    .eq("role_applied", roleApplied)
    .eq("status", "draft")
    .maybeSingle();

  if (draftErr) {
    log("existing draft lookup failed", draftErr);
    return { ok: false, message: SAFE_ERROR };
  }
  if (existingDraft) {
    return {
      ok: false,
      message: "Đã có bản tính nháp cho đợt này. Hãy áp dụng hoặc huỷ bản đó trước khi tính lại."
    };
  }

  const [{ candidates, error: candidateError }, capacityTotal] = await Promise.all([
    loadCandidates(client, { intakeBatchId: input.intakeBatchId, roleApplied }),
    computeSeasonCapacity(seasonId)
  ]);

  if (candidateError) return { ok: false, message: candidateError };
  if (candidates.length === 0) {
    return { ok: false, message: "Không có hồ sơ nào trong đợt tuyển này." };
  }

  const plan = buildSelectionPlan({ candidates, capacityTotal, reservePct });
  const summary = summarizePlan(plan);

  const { data: runRow, error: runErr } = await client
    .from("selection_runs")
    .insert({
      season_id: seasonId,
      intake_batch_id: input.intakeBatchId,
      role_applied: roleApplied,
      capacity_total: plan.capacityTotal,
      reserve_pct: plan.reservePct,
      scored_count: plan.scoredCount,
      unscored_count: plan.unscoredCount,
      main_count: plan.mainCount,
      reserve_count: plan.reserveCount,
      status: "draft",
      note: input.note ? String(input.note).slice(0, 1000) : null,
      params: { reserve_pct: plan.reservePct, role_applied: roleApplied },
      created_by: guard.admin?.id ?? null
    })
    .select("id")
    .maybeSingle();

  if (runErr || !runRow) {
    log("run insert failed", runErr);
    return { ok: false, message: SAFE_ERROR };
  }

  const runId = (runRow as { id: string }).id;

  const itemRows = plan.ranked.map((row) => ({
    run_id: runId,
    application_id: row.applicationId,
    rank: row.rank,
    total_score: row.totalScore,
    review_count: row.reviewCount,
    selection_group: row.group,
    tie_break_note: row.tieBreakNote
  }));

  const { error: itemsErr } = await client.from("selection_run_items").insert(itemRows);
  if (itemsErr) {
    log("run items insert failed", itemsErr);
    // Leave no half-built draft behind; the unique index would then block a retry.
    await client.from("selection_runs").delete().eq("id", runId);
    return { ok: false, message: SAFE_ERROR };
  }

  await writeRunLog(client, {
    runId,
    seasonId,
    action: "created",
    detail: {
      capacity_total: plan.capacityTotal,
      main_count: plan.mainCount,
      reserve_count: plan.reserveCount,
      scored_count: plan.scoredCount,
      unscored_count: plan.unscoredCount
    },
    actorAdminUserId: guard.admin?.id ?? null
  });

  return {
    ok: true,
    runId,
    summary,
    message: summary.canApply
      ? `Đã tính danh sách: ${plan.mainCount} hồ sơ chính thức, ${plan.reserveCount} dự phòng trên ${plan.capacityTotal} suất.`
      : `Đã tính thử danh sách nhưng chưa thể áp dụng: ${summary.blockReason}`
  };
}

// ── Read ──────────────────────────────────────────────────────────────────────

export type SelectionRunView = {
  ok: boolean;
  error: string | null;
  run: SelectionRunRow | null;
  items: SelectionRunItemView[];
  summary: SelectionSummary | null;
};

/** The latest run for a batch, with its ranked applications enriched for display. */
export async function getSelectionRunForBatch(input: {
  intakeBatchId: string;
  roleApplied?: string;
}): Promise<SelectionRunView> {
  const empty: SelectionRunView = { ok: true, error: null, run: null, items: [], summary: null };
  if (!isValidUuid(input.intakeBatchId)) return empty;

  const { client, error: clientError } = clientResult();
  if (!client) return { ...empty, ok: false, error: clientError };

  const roleApplied = (input.roleApplied ?? "mentee").trim() || "mentee";

  const { data: runRow, error: runErr } = await client
    .from("selection_runs")
    .select(RUN_COLUMNS)
    .eq("intake_batch_id", input.intakeBatchId)
    .eq("role_applied", roleApplied)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (runErr) {
    log("run lookup failed", runErr);
    return { ...empty, ok: false, error: SAFE_ERROR };
  }
  const run = (runRow as SelectionRunRow | null) ?? null;
  if (!run) return empty;

  const ctx = await getAdminScopeContext();
  if (!(await canReadSeason(ctx, run.season_id))) {
    return { ...empty, ok: false, error: "Bạn không có quyền xem dữ liệu của mùa này." };
  }

  const { data: itemRows, error: itemsErr } = await client
    .from("selection_run_items")
    .select(ITEM_COLUMNS)
    .eq("run_id", run.id)
    .order("rank", { ascending: true });

  if (itemsErr) {
    log("run items lookup failed", itemsErr);
    return { ...empty, ok: false, error: SAFE_ERROR, run };
  }

  const items = (itemRows ?? []) as unknown as SelectionRunItemRow[];
  if (items.length === 0) {
    return { ok: true, error: null, run, items: [], summary: null };
  }

  const { data: appRows } = await client
    .from("applications")
    .select("id,full_name,email_primary,status")
    .in(
      "id",
      items.map((item) => item.application_id)
    );

  const appById = new Map(
    ((appRows ?? []) as Array<{ id: string; full_name: string | null; email_primary: string | null; status: string | null }>).map(
      (row) => [row.id, row]
    )
  );

  const enriched: SelectionRunItemView[] = items.map((item) => {
    const app = appById.get(item.application_id);
    return {
      ...item,
      full_name: app?.full_name ?? null,
      email_primary: app?.email_primary ?? null,
      application_status: app?.status ?? null
    };
  });

  const summary: SelectionSummary = {
    capacityTotal: run.capacity_total,
    mainCount: run.main_count,
    reserveCount: run.reserve_count,
    belowCount: items.length - run.main_count - run.reserve_count,
    scoredCount: run.scored_count,
    unscoredCount: run.unscored_count,
    canApply: run.status === "draft" && run.unscored_count === 0 && run.capacity_total > 0,
    blockReason:
      run.status !== "draft"
        ? `Bản tính này đã ${run.status === "applied" ? "được áp dụng" : "bị huỷ"}.`
        : run.unscored_count > 0
          ? `Còn ${run.unscored_count} hồ sơ chưa có điểm chấm.`
          : run.capacity_total === 0
            ? "Chưa có mentor nào xác nhận nhận mentee."
            : null
  };

  return { ok: true, error: null, run, items: enriched, summary };
}

// ── Apply ─────────────────────────────────────────────────────────────────────

/**
 * Apply a draft run: invite the main group, waitlist the reserve.
 *
 * Statuses are written in two bulk updates and every changed application gets
 * an application_decisions row, so the invitation list can be reconstructed
 * later from the audit trail rather than from this table alone.
 */
export async function applySelectionRun(input: { runId: string }): Promise<MutationResult> {
  if (!isValidUuid(input.runId)) return { ok: false, message: "Thiếu hoặc sai mã bản tính." };

  const { client, error: clientError } = clientResult();
  if (!client) return { ok: false, message: clientError ?? SAFE_ERROR };

  const { data: runRow, error: runErr } = await client
    .from("selection_runs")
    .select(RUN_COLUMNS)
    .eq("id", input.runId)
    .maybeSingle();

  if (runErr) {
    log("apply run lookup failed", runErr);
    return { ok: false, message: SAFE_ERROR };
  }
  const run = (runRow as SelectionRunRow | null) ?? null;
  if (!run) return { ok: false, message: "Không tìm thấy bản tính." };

  const guard = await requireSelectionOperator(run.season_id);
  if (!guard.ok) return { ok: false, message: guard.message };

  if (run.status !== "draft") {
    return { ok: false, message: `Bản tính này đã ${run.status === "applied" ? "được áp dụng" : "bị huỷ"}.` };
  }
  if (run.unscored_count > 0) {
    return {
      ok: false,
      message: `Còn ${run.unscored_count} hồ sơ chưa có điểm chấm. Hoàn tất chấm trước khi chốt danh sách.`
    };
  }
  if (run.capacity_total <= 0) {
    return { ok: false, message: "Chưa có mentor nào xác nhận nhận mentee, chưa xác định được số suất." };
  }

  const { data: itemRows, error: itemsErr } = await client
    .from("selection_run_items")
    .select(ITEM_COLUMNS)
    .eq("run_id", run.id)
    .in("selection_group", ["main", "reserve"]);

  if (itemsErr) {
    log("apply run items lookup failed", itemsErr);
    return { ok: false, message: SAFE_ERROR };
  }

  const items = (itemRows ?? []) as unknown as SelectionRunItemRow[];
  if (items.length === 0) {
    return { ok: false, message: "Bản tính không có hồ sơ nào để áp dụng." };
  }

  // Capture the statuses being replaced so the decision rows are truthful.
  const { data: beforeRows } = await client
    .from("applications")
    .select("id,status")
    .in(
      "id",
      items.map((item) => item.application_id)
    );
  const statusBefore = new Map(
    ((beforeRows ?? []) as Array<{ id: string; status: string | null }>).map((row) => [row.id, row.status])
  );

  let updatedCount = 0;
  for (const group of ["main", "reserve"] as const) {
    const targetStatus = statusForGroup(group);
    if (!targetStatus) continue;
    const ids = items.filter((item) => item.selection_group === group).map((item) => item.application_id);
    if (ids.length === 0) continue;

    const { error: updateErr } = await client
      .from("applications")
      .update({ status: targetStatus })
      .in("id", ids);

    if (updateErr) {
      log(`apply run status update failed (${group})`, updateErr);
      return { ok: false, message: SAFE_ERROR };
    }
    updatedCount += ids.length;

    await client.from("selection_run_items").update({ applied_status: targetStatus }).in(
      "id",
      items.filter((item) => item.selection_group === group).map((item) => item.id)
    );

    // Audit rows are best-effort: the statuses are already written, and losing
    // the audit must not leave the run half-applied.
    const decisionRows = ids.map((applicationId) => ({
      application_id: applicationId,
      decided_by: guard.admin?.id ?? null,
      decided_by_name: guard.admin?.full_name ?? null,
      decision: targetStatus,
      previous_status: statusBefore.get(applicationId) ?? null,
      new_status: targetStatus,
      decision_note: `Selection run ${run.id} — nhóm ${group}`
    }));
    const { error: decisionErr } = await client.from("application_decisions").insert(decisionRows);
    if (decisionErr) log("apply run decision rows failed (non-fatal)", decisionErr);
  }

  const { data: applied, error: applyErr } = await client
    .from("selection_runs")
    .update({
      status: "applied",
      applied_at: new Date().toISOString(),
      applied_by: guard.admin?.id ?? null
    })
    .eq("id", run.id)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();

  if (applyErr) {
    log("apply run status update failed", applyErr);
    return { ok: false, message: SAFE_ERROR };
  }
  if (!applied) {
    return { ok: false, message: "Bản tính đã được xử lý ở nơi khác. Vui lòng tải lại trang." };
  }

  await writeRunLog(client, {
    runId: run.id,
    seasonId: run.season_id,
    action: "applied",
    detail: { updated: updatedCount, main: run.main_count, reserve: run.reserve_count },
    actorAdminUserId: guard.admin?.id ?? null
  });

  return {
    ok: true,
    runId: run.id,
    message: `Đã áp dụng: mời ${run.main_count} hồ sơ phỏng vấn, ${run.reserve_count} hồ sơ vào nhóm dự phòng.`
  };
}

/** Throw away a draft so a fresh one can be computed. */
export async function discardSelectionRun(input: { runId: string }): Promise<MutationResult> {
  if (!isValidUuid(input.runId)) return { ok: false, message: "Thiếu hoặc sai mã bản tính." };

  const { client, error: clientError } = clientResult();
  if (!client) return { ok: false, message: clientError ?? SAFE_ERROR };

  const { data: runRow, error: runErr } = await client
    .from("selection_runs")
    .select(RUN_COLUMNS)
    .eq("id", input.runId)
    .maybeSingle();

  if (runErr) {
    log("discard run lookup failed", runErr);
    return { ok: false, message: SAFE_ERROR };
  }
  const run = (runRow as SelectionRunRow | null) ?? null;
  if (!run) return { ok: false, message: "Không tìm thấy bản tính." };

  const guard = await requireSelectionOperator(run.season_id);
  if (!guard.ok) return { ok: false, message: guard.message };

  if (run.status !== "draft") {
    return { ok: false, message: "Chỉ có thể huỷ bản tính đang ở trạng thái nháp." };
  }

  const { data: discarded, error: discardErr } = await client
    .from("selection_runs")
    .update({ status: "discarded", discarded_at: new Date().toISOString() })
    .eq("id", run.id)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();

  if (discardErr) {
    log("discard run update failed", discardErr);
    return { ok: false, message: SAFE_ERROR };
  }
  if (!discarded) return { ok: false, message: "Bản tính đã được xử lý ở nơi khác. Vui lòng tải lại trang." };

  await writeRunLog(client, {
    runId: run.id,
    seasonId: run.season_id,
    action: "discarded",
    actorAdminUserId: guard.admin?.id ?? null
  });

  return { ok: true, runId: run.id, message: "Đã huỷ bản tính. Có thể tính lại danh sách mới." };
}

/**
 * Promote one reserve application into the interview list, for when somebody in
 * the main group withdraws. The run's own counts are left untouched: what the
 * run computed at the time is a record, and the promotion is recorded beside it.
 */
export async function promoteReserveApplication(input: {
  runId: string;
  applicationId: string;
  reason?: string | null;
}): Promise<MutationResult> {
  if (!isValidUuid(input.runId) || !isValidUuid(input.applicationId)) {
    return { ok: false, message: "Thiếu hoặc sai mã bản tính / hồ sơ." };
  }

  const { client, error: clientError } = clientResult();
  if (!client) return { ok: false, message: clientError ?? SAFE_ERROR };

  const { data: runRow, error: runErr } = await client
    .from("selection_runs")
    .select(RUN_COLUMNS)
    .eq("id", input.runId)
    .maybeSingle();

  if (runErr) {
    log("promote run lookup failed", runErr);
    return { ok: false, message: SAFE_ERROR };
  }
  const run = (runRow as SelectionRunRow | null) ?? null;
  if (!run) return { ok: false, message: "Không tìm thấy bản tính." };

  const guard = await requireSelectionOperator(run.season_id);
  if (!guard.ok) return { ok: false, message: guard.message };

  if (run.status !== "applied") {
    return { ok: false, message: "Chỉ đôn dự phòng sau khi bản tính đã được áp dụng." };
  }

  const { data: itemRow, error: itemErr } = await client
    .from("selection_run_items")
    .select(ITEM_COLUMNS)
    .eq("run_id", run.id)
    .eq("application_id", input.applicationId)
    .maybeSingle();

  if (itemErr) {
    log("promote item lookup failed", itemErr);
    return { ok: false, message: SAFE_ERROR };
  }
  const item = (itemRow as SelectionRunItemRow | null) ?? null;
  if (!item) return { ok: false, message: "Hồ sơ không thuộc bản tính này." };
  if (item.selection_group !== "reserve") {
    return { ok: false, message: "Chỉ hồ sơ trong nhóm dự phòng mới được đôn lên." };
  }
  if (item.promoted_at) {
    return { ok: false, message: "Hồ sơ này đã được đôn lên trước đó." };
  }

  const { data: appRow } = await client
    .from("applications")
    .select("id,status")
    .eq("id", input.applicationId)
    .maybeSingle();
  const previousStatus = (appRow as { status?: string | null } | null)?.status ?? null;

  const { error: updateErr } = await client
    .from("applications")
    .update({ status: "invited_to_interview" })
    .eq("id", input.applicationId);

  if (updateErr) {
    log("promote application update failed", updateErr);
    return { ok: false, message: SAFE_ERROR };
  }

  const { data: promoted } = await client
    .from("selection_run_items")
    .update({ promoted_at: new Date().toISOString(), applied_status: "invited_to_interview" })
    .eq("id", item.id)
    .is("promoted_at", null)
    .select("id")
    .maybeSingle();

  if (!promoted) {
    return { ok: false, message: "Hồ sơ này vừa được đôn lên ở nơi khác. Vui lòng tải lại trang." };
  }

  const { error: decisionErr } = await client.from("application_decisions").insert({
    application_id: input.applicationId,
    decided_by: guard.admin?.id ?? null,
    decided_by_name: guard.admin?.full_name ?? null,
    decision: "invited_to_interview",
    previous_status: previousStatus,
    new_status: "invited_to_interview",
    decision_note: `Đôn từ nhóm dự phòng — selection run ${run.id}`
  });
  if (decisionErr) log("promote decision row failed (non-fatal)", decisionErr);

  await writeRunLog(client, {
    runId: run.id,
    seasonId: run.season_id,
    action: "reserve_promoted",
    applicationId: input.applicationId,
    reason: input.reason ?? null,
    actorAdminUserId: guard.admin?.id ?? null
  });

  return { ok: true, runId: run.id, message: "Đã đôn hồ sơ dự phòng lên danh sách phỏng vấn." };
}

export type { SelectionPlan, SelectionSummary };
