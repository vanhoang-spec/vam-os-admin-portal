import { NextResponse } from "next/server";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { CSV_UTF8_BOM, toCsv } from "@/lib/csv-export";
import { readAllPages } from "@/lib/paged-read";
import { canAssignReview } from "@/lib/permissions";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import {
  APPLICATION_STATUSES,
  DECISION_OUTCOMES,
  OPERATIONAL_GROUPS,
  ROLE_VALUES,
  STAGE_VALUES,
  classifyOperational,
  classifyOutcome,
  currentStage,
  deriveDecisions,
  matchesOperationalGroup,
  parseEnum,
  parseEnumList,
  parseUuid
} from "@/lib/recruitment-export";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { applicationStatusLabel, applicationAcquisitionChannelLabel } from "@/lib/ui-labels";
import { getActiveAdminUsers } from "@/lib/data";

export const dynamic = "force-dynamic";

/**
 * Recruitment results export.
 *
 * ---------------------------------------------------------------------------
 * ACCEPTED PARAMETERS
 * ---------------------------------------------------------------------------
 *   intake_batch_id      uuid       DB-level. One of intake_batch_id/season_id
 *   season_id            uuid       DB-level. is REQUIRED (see below).
 *   role_applied         mentor|mentee                         DB-level
 *   status               csv of canonical application statuses DB-level
 *   stage                screening|interview|final             derived
 *   screening_decision   passed|rejected|waitlisted|needs_more_review|pending
 *   interview_decision   (same domain)                         derived
 *   final_decision       (same domain)                         derived
 *   operational_group    passed_screening|passed_interview|approved|
 *                        rejected|needs_more_review             derived
 *
 * The *_decision parameters filter on AUDIT evidence only. operational_group
 * filters on current-state classification, which also counts applications
 * whose audit trail is missing. They are separate questions and are answered
 * by separate columns; neither overwrites the other.
 *
 * At least one of `intake_batch_id` / `season_id` is required. An unscoped
 * export would dump every applicant's PII across every season the caller can
 * see in a single request, so the scope is mandatory rather than defaulted.
 *
 * "DB-level" filters are rebuilt inside the query factory, so `readAllPages`
 * re-applies them on every page. "derived" filters are computed from the
 * decision audit trail after the read has run to exhaustion, so they apply
 * uniformly to all pages by construction.
 *
 * Any parameter present with a value outside its domain is a 400; nothing is
 * silently ignored or widened.
 */
export async function GET(request: Request) {
  const adminUser = await getCurrentAdminUser();
  if (!adminUser) return new NextResponse("Unauthorized", { status: 401 });
  if (!canAssignReview(adminUser.role)) return new NextResponse("Forbidden", { status: 403 });

  const { searchParams } = new URL(request.url);

  const batchParam = parseUuid(searchParams, "intake_batch_id");
  if (!batchParam.ok) return new NextResponse(batchParam.message, { status: 400 });
  const seasonParam = parseUuid(searchParams, "season_id");
  if (!seasonParam.ok) return new NextResponse(seasonParam.message, { status: 400 });
  const roleParam = parseEnum(searchParams, "role_applied", ROLE_VALUES);
  if (!roleParam.ok) return new NextResponse(roleParam.message, { status: 400 });
  const statusParam = parseEnumList(searchParams, "status", APPLICATION_STATUSES);
  if (!statusParam.ok) return new NextResponse(statusParam.message, { status: 400 });
  const stageParam = parseEnum(searchParams, "stage", STAGE_VALUES);
  if (!stageParam.ok) return new NextResponse(stageParam.message, { status: 400 });
  const screeningParam = parseEnum(searchParams, "screening_decision", DECISION_OUTCOMES);
  if (!screeningParam.ok) return new NextResponse(screeningParam.message, { status: 400 });
  const interviewParam = parseEnum(searchParams, "interview_decision", DECISION_OUTCOMES);
  if (!interviewParam.ok) return new NextResponse(interviewParam.message, { status: 400 });
  const finalParam = parseEnum(searchParams, "final_decision", DECISION_OUTCOMES);
  if (!finalParam.ok) return new NextResponse(finalParam.message, { status: 400 });
  const groupParam = parseEnum(searchParams, "operational_group", OPERATIONAL_GROUPS);
  if (!groupParam.ok) return new NextResponse(groupParam.message, { status: 400 });

  const intakeBatchId = batchParam.value;
  const seasonId = seasonParam.value;
  if (!intakeBatchId && !seasonId) {
    return new NextResponse("Missing scope: provide intake_batch_id or season_id.", { status: 400 });
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return new NextResponse("Service client unavailable", { status: 500 });

  // Resolve the season that authorizes this export. A batch id resolves to its
  // own season: the caller's role tier alone is not enough, or a season-scoped
  // admin could export another season's applicant PII merely by passing its
  // intake_batch_id in the query string.
  let authorizingSeasonId = seasonId;
  if (intakeBatchId) {
    const { data: batch, error: batchError } = await client
      .from("intake_batches")
      .select("id,season_id")
      .eq("id", intakeBatchId)
      .maybeSingle();
    if (batchError) {
      console.error("Export results — batch lookup failed", batchError);
      return new NextResponse("Database error", { status: 500 });
    }
    if (!batch?.season_id) return new NextResponse("Intake batch not found", { status: 404 });
    // Both scopes supplied and disagreeing is a caller error, not a silent
    // intersection — answering it either way would misrepresent the request.
    if (seasonId && String(batch.season_id) !== seasonId) {
      return new NextResponse("intake_batch_id does not belong to season_id.", { status: 400 });
    }
    authorizingSeasonId = String(batch.season_id);
  }

  const scopeContext = await getAdminScopeContext();
  if (!(await canOperateSeason(scopeContext, String(authorizingSeasonId)))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // Both reads below are class C (potentially unbounded) under
  // lib/paged-read.ts. PostgREST caps a single response at its server row
  // limit (1000 on Supabase-hosted) and applies the cap SILENTLY — HTTP 200,
  // error: null, truncated data indistinguishable from a complete export.
  // `readAllPages` pages each to exhaustion under its keyset key ("id"),
  // calling the factory fresh for every page so no page can drift outside the
  // authorized scope or drop a filter after page 1.
  //
  // The decisions are deliberately fetched as their OWN paged read rather than
  // as a nested embed on `applications`. An embedded child array is a
  // multi-row read with no declared bound and no cursor of its own: it cannot
  // be paged, so a sufficiently long decision history would be silently
  // truncated inside an otherwise complete-looking parent row — precisely the
  // failure this module exists to prevent, just moved one level down. Two
  // exhaustive reads joined in memory is the only shape that is actually
  // provable.
  const applicationScope = (query: any) => {
    let scoped = query;
    if (intakeBatchId) scoped = scoped.eq("intake_batch_id", intakeBatchId);
    if (seasonId) scoped = scoped.eq("season_id", seasonId);
    if (roleParam.value) scoped = scoped.eq("role_applied", roleParam.value);
    if (statusParam.value) scoped = scoped.in("status", statusParam.value);
    return scoped;
  };

  const { data: applications, error } = await readAllPages<Record<string, any>>(
    "applications",
    `
      id,
      sbd,
      full_name,
      email_primary,
      role_applied,
      season_id,
      intake_batch_id,
      status,
      submitted_at,
      raw_payload,
      acquisition_channel
    `,
    (columns) => applicationScope(client.from("applications").select(columns))
  );

  if (error) {
    console.error("Export results failed", error);
    return new NextResponse("Database error", { status: 500 });
  }

  // Scoped through the embedded parent so the decision read is constrained to
  // exactly the applications being exported. The filters must reference the
  // `application` alias the embed was requested under — PostgREST resolves an
  // embedded filter by that name, not by the underlying table name — and
  // `!inner` makes it a join, so a decision whose parent falls outside the
  // scope is excluded rather than returned with a null embed.
  const { data: decisionRows, error: decisionsError } = await readAllPages<Record<string, any>>(
    "application_decisions",
    `
      id,
      application_id,
      decision,
      new_status,
      previous_status,
      created_at,
      application:applications!inner(
        id,
        season_id,
        intake_batch_id,
        role_applied,
        status
      )
    `,
    (columns) => {
      let query = client.from("application_decisions").select(columns);
      if (intakeBatchId) query = query.eq("application.intake_batch_id", intakeBatchId);
      if (seasonId) query = query.eq("application.season_id", seasonId);
      if (roleParam.value) query = query.eq("application.role_applied", roleParam.value);
      if (statusParam.value) query = query.in("application.status", statusParam.value);
      return query;
    }
  );

  if (decisionsError) {
    console.error("Export results — decisions read failed", decisionsError);
    return new NextResponse("Database error", { status: 500 });
  }

  const decisionsByApplication = new Map<string, Record<string, any>[]>();
  for (const row of decisionRows ?? []) {
    const key = String(row.application_id ?? "");
    if (!key) continue;
    const bucket = decisionsByApplication.get(key);
    if (bucket) bucket.push(row);
    else decisionsByApplication.set(key, [row]);
  }

  const appIds = (applications ?? []).map(a => String(a.id));
  const allReviews: any[] = [];
  const chunkSize = 500;
  for (let i = 0; i < appIds.length; i += chunkSize) {
    const chunk = appIds.slice(i, i + chunkSize);
    const { data: chunkReviews } = await client.from("application_reviews").select("*").in("application_id", chunk);
    if (chunkReviews) allReviews.push(...chunkReviews);
  }
  const adminUsersRes = await getActiveAdminUsers();
  const adminUserMap = new Map((adminUsersRes.data ?? []).map((u) => [u.id, u]));

  const reviewsByAppId = new Map<string, any[]>();
  for (const review of allReviews) {
    const key = String(review.application_id ?? "");
    if (!key) continue;
    const bucket = reviewsByAppId.get(key);
    if (bucket) bucket.push(review);
    else reviewsByAppId.set(key, [review]);
  }

  const headers = [
    "Mã đơn",
    "SBD",
    "Họ tên",
    "Email",
    "Vai trò ứng tuyển",
    "Mã đợt tuyển",
    "Trạng thái hiện tại",
    "Trạng thái hiện tại (nhãn)",
    "Giai đoạn hiện tại",
    "Kết quả sơ loại",
    "Thời điểm sơ loại",
    "Kết quả phỏng vấn",
    "Thời điểm phỏng vấn",
    "Kết quả cuối cùng",
    "Thời điểm quyết định cuối",
    "Người review hồ sơ",
    "Email người review hồ sơ",
    "Người phỏng vấn",
    "Email người phỏng vấn",
    "Đã qua vòng hồ sơ (hiện tại)",
    "Đã qua vòng phỏng vấn (hiện tại)",
    "Đã duyệt chính thức",
    "Cơ sở phân loại",
    "Thời điểm nộp",
    "Biết đến chương trình qua"
  ];

  const yesNo = (value: boolean) => (value ? "có" : "không");

  const body: unknown[][] = [];
  for (const app of applications ?? []) {
    const derived = deriveDecisions(decisionsByApplication.get(String(app.id)) ?? []);
    const stage = currentStage(app.status, derived);

    const operational = classifyOperational(app.status, derived);

    if (stageParam.value && stage !== stageParam.value) continue;
    if (screeningParam.value && classifyOutcome(derived.screening) !== screeningParam.value) continue;
    if (interviewParam.value && classifyOutcome(derived.interview) !== interviewParam.value) continue;
    if (finalParam.value && classifyOutcome(derived.final) !== finalParam.value) continue;
    if (groupParam.value && !matchesOperationalGroup(groupParam.value, operational)) continue;

    const appReviews = reviewsByAppId.get(String(app.id)) ?? [];
    
    const profileReviewers = appReviews
      .filter((r) => r.review_round === "profile_screening" && r.status !== "cancelled")
      .map((r) => r.reviewer_admin_user_id ? adminUserMap.get(r.reviewer_admin_user_id) : null)
      .filter(Boolean);
      
    const interviewers = appReviews
      .filter((r) => r.review_round === "interview" && r.status !== "cancelled")
      .map((r) => r.reviewer_admin_user_id ? adminUserMap.get(r.reviewer_admin_user_id) : null)
      .filter(Boolean);

    body.push([
      app.id,
      app.sbd,
      app.full_name,
      app.email_primary,
      app.role_applied,
      app.intake_batch_id,
      app.status,
      applicationStatusLabel(app.status),
      stage,
      derived.screening?.status ?? "",
      derived.screening?.at ?? "",
      derived.interview?.status ?? "",
      derived.interview?.at ?? "",
      derived.final?.status ?? "",
      derived.final?.at ?? "",
      profileReviewers.map(u => u!.full_name || u!.email).join(", ") || "-",
      profileReviewers.map(u => u!.email).join(", ") || "-",
      interviewers.map(u => u!.full_name || u!.email).join(", ") || "-",
      interviewers.map(u => u!.email).join(", ") || "-",
      yesNo(operational.passedScreening),
      yesNo(operational.passedInterview),
      yesNo(operational.officiallyApproved),
      operational.basis,
      app.submitted_at,
      applicationAcquisitionChannelLabel(app.raw_payload as Record<string, unknown> | null, app.acquisition_channel)
    ]);
  }

  const csv = toCsv([headers, ...body]);
  const scopeLabel = intakeBatchId ?? seasonId;

  return new NextResponse(CSV_UTF8_BOM + csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="recruitment-results-${scopeLabel}.csv"`
    }
  });
}
