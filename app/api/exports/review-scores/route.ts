import { NextResponse } from "next/server";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { CSV_UTF8_BOM, toCsv } from "@/lib/csv-export";
import { readAllPages } from "@/lib/paged-read";
import { canAssignReview } from "@/lib/permissions";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import {
  REVIEW_ROUNDS,
  REVIEW_STATUSES,
  ROLE_VALUES,
  parseEnum,
  parseEnumList,
  parseUuid
} from "@/lib/recruitment-export";
import { bonusForApplication, readApplicationBonusRules } from "@/lib/submission-bonus";
import { addSubmissionBonus } from "@/lib/submission-bonus-core";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * Review scores export.
 *
 * ---------------------------------------------------------------------------
 * ACCEPTED PARAMETERS  (all DB-level; see the filter note below)
 * ---------------------------------------------------------------------------
 *   intake_batch_id  uuid    One of intake_batch_id/season_id is REQUIRED.
 *   season_id        uuid
 *   role_applied     mentor|mentee
 *   review_round     profile_screening|interview
 *   reviewer         uuid of the reviewer's admin_users row
 *   review_status    csv of assigned|in_progress|submitted|cancelled
 *
 * Every filter here is applied inside the query factory, which `readAllPages`
 * invokes fresh for each page — so a filter can never be dropped after page 1.
 * The batch/season/role constraints are expressed against the embedded
 * `application` alias; PostgREST resolves an embedded filter by the name the
 * embed was requested under, so these must reference `application.*` (the
 * alias) and not `applications.*` (the underlying table), or the constraint
 * is not recognised as applying to the embed at all. `!inner` makes the embed
 * a join rather than an optional expansion, so a non-matching parent excludes
 * the review row instead of merely nulling the embed.
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
  const roundParam = parseEnum(searchParams, "review_round", REVIEW_ROUNDS);
  if (!roundParam.ok) return new NextResponse(roundParam.message, { status: 400 });
  const reviewerParam = parseUuid(searchParams, "reviewer");
  if (!reviewerParam.ok) return new NextResponse(reviewerParam.message, { status: 400 });
  const reviewStatusParam = parseEnumList(searchParams, "review_status", REVIEW_STATUSES);
  if (!reviewStatusParam.ok) return new NextResponse(reviewStatusParam.message, { status: 400 });

  const intakeBatchId = batchParam.value;
  const seasonId = seasonParam.value;
  if (!intakeBatchId && !seasonId) {
    return new NextResponse("Missing scope: provide intake_batch_id or season_id.", { status: 400 });
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return new NextResponse("Service client unavailable", { status: 500 });

  let authorizingSeasonId = seasonId;
  if (intakeBatchId) {
    const { data: batch, error: batchError } = await client
      .from("intake_batches")
      .select("id,season_id")
      .eq("id", intakeBatchId)
      .maybeSingle();
    if (batchError) {
      console.error("Export review scores — batch lookup failed", batchError);
      return new NextResponse("Database error", { status: 500 });
    }
    if (!batch?.season_id) return new NextResponse("Intake batch not found", { status: 404 });
    if (seasonId && String(batch.season_id) !== seasonId) {
      return new NextResponse("intake_batch_id does not belong to season_id.", { status: 400 });
    }
    authorizingSeasonId = String(batch.season_id);
  }

  const scopeContext = await getAdminScopeContext();
  if (!(await canOperateSeason(scopeContext, String(authorizingSeasonId)))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const { data: reviews, error } = await readAllPages<Record<string, any>>(
    "application_reviews",
    `
      id,
      application_id,
      review_round,
      status,
      score_motivation,
      score_goal_clarity,
      score_commitment,
      score_fit,
      score_communication,
      total_score,
      recommendation,
      reviewer_note,
      submitted_at,
      reviewer:admin_users!application_reviews_reviewer_admin_user_id_fkey(
        email,
        full_name
      ),
      application:applications!inner(
        full_name,
        email_primary,
        role_applied,
        season_id,
        intake_batch_id,
        created_at
      )
    `,
    (columns) => {
      let query = client.from("application_reviews").select(columns);
      if (intakeBatchId) query = query.eq("application.intake_batch_id", intakeBatchId);
      if (seasonId) query = query.eq("application.season_id", seasonId);
      if (roleParam.value) query = query.eq("application.role_applied", roleParam.value);
      if (roundParam.value) query = query.eq("review_round", roundParam.value);
      if (reviewerParam.value) query = query.eq("reviewer_admin_user_id", reviewerParam.value);
      if (reviewStatusParam.value) query = query.in("status", reviewStatusParam.value);
      return query;
    }
  );

  if (error) {
    console.error("Export review scores failed", error);
    return new NextResponse("Database error", { status: 500 });
  }

  const headers = [
    "Mã đơn",
    "Họ tên ứng viên",
    "Email ứng viên",
    "Vai trò ứng tuyển",
    "Vòng review",
    "Email reviewer",
    "Tên reviewer",
    "Trạng thái review",
    "Điểm động lực",
    "Điểm rõ ràng mục tiêu",
    "Điểm cam kết",
    "Điểm phù hợp",
    "Điểm giao tiếp",
    "Tổng điểm",
    "Khuyến nghị",
    "Ghi chú reviewer",
    "Thời điểm gửi",
    // Hai cột điểm cộng nối vào CUỐI, không chen sau "Tổng điểm": bảng tính nào đang
    // đọc cột theo vị trí vẫn đọc đúng cột cũ.
    "Điểm cộng theo ngày nộp (của đơn)",
    "Tổng điểm sau cộng"
  ];

  // Không đọc được mốc thì ghi rõ vào ô, không để trống: ô trống trong cột điểm cộng
  // đọc y như "không được cộng", và file này là thứ người ta dùng để xếp hạng.
  const bonusLookup = await readApplicationBonusRules(
    (reviews ?? []).map((review: any) => review.application?.intake_batch_id)
  );

  const body = (reviews ?? []).map((review: any) => {
    const bonus = bonusForApplication(bonusLookup, review.application ?? {});
    return [
      review.application_id,
      review.application?.full_name ?? "",
      review.application?.email_primary ?? "",
      review.application?.role_applied ?? "",
      review.review_round,
      review.reviewer?.email ?? "",
      review.reviewer?.full_name ?? "",
      review.status,
      review.score_motivation,
      review.score_goal_clarity,
      review.score_commitment,
      review.score_fit,
      review.score_communication,
      review.total_score,
      review.recommendation,
      review.reviewer_note,
      review.submitted_at,
      bonus.kind === "unknown" ? "Không đọc được" : bonus.kind === "bonus" ? bonus.points : 0,
      bonus.kind === "unknown" ? "" : addSubmissionBonus(review.total_score, bonus)
    ];
  });

  const csv = toCsv([headers, ...body]);
  const scopeLabel = intakeBatchId ?? seasonId;

  return new NextResponse(CSV_UTF8_BOM + csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="review-scores-${scopeLabel}.csv"`
    }
  });
}
