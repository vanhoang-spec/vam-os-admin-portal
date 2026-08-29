import { NextRequest } from "next/server";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canExportApplicationResults } from "@/lib/permissions";
import { getAdminScopeContext, getScopeFilterResult, type ScopeFilter } from "@/lib/program-scope";
import {
  getAdminUsersByIds,
  getAllApplicationReviews,
  getApplications,
  getIntakeBatches,
  getSeasons
} from "@/lib/data";
import type { AdminUserPublic, Application, ApplicationReview, IntakeBatch, Season } from "@/lib/types";

/**
 * Full recruitment-results export.
 *
 * FAIL-CLOSED CONTRACT
 * --------------------
 * The file this route emits is used to notify real applicants. Every required
 * source — applications, reviews, intake batches, seasons, reviewer identity —
 * is checked for an error BEFORE any row is written, and any failure returns a
 * non-200 with no file. A legitimately empty dataset is fine; a failed query
 * rendered as an empty (or partially resolved) file is not, because the two are
 * indistinguishable once the file has left the system.
 *
 * NO RAW SUPABASE CLIENT HERE
 * ---------------------------
 * This route deliberately holds no PostgREST client of its own. It previously
 * called `getSupabaseServerClient()` without awaiting it — that helper is async
 * since Next 15 — and then called `.from()` on the Promise, which throws for
 * every authorized request. Awaiting it would not have been enough either: the
 * cookie-scoped client authenticates as `authenticated`, and S12/T2 removed
 * SELECT on `admin_users` from that role entirely (see
 * `lib/middleware-admin-lookup.ts`). Both reads now go through server-side,
 * service-role data-layer functions that page, chunk and fail closed —
 * `getSeasons` and `getAdminUsersByIds`.
 */

const EXPORT_TYPES = new Set(["summary", "detail"]);
const EXPORT_FORMATS = new Set(["csv", "xlsx"]);
const ROLE_FILTERS = new Set(["all", "mentor", "mentee"]);

/**
 * Shown in place of a reviewer whose `admin_users` row no longer exists. A
 * missing historical row is NOT a query failure — that path returns non-200
 * before any row is written. This is a staff record hard-deleted after scoring,
 * and the reviewer UUID must never be printed as if it were a person's name.
 */
const MISSING_REVIEWER_LABEL = "Reviewer không còn trong hệ thống";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Security: prefix spreadsheet formulas so a cell is never evaluated on open.
function escapeCSV(val: string | number | boolean | null | undefined): string {
  if (val === null || val === undefined) return "";
  let str = String(val);
  if (str.startsWith("=") || str.startsWith("+") || str.startsWith("-") || str.startsWith("@")) {
    str = "'" + str;
  }
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Same prefix logic for XLSX to avoid formula injection.
function safeExcelValue(val: string | number | boolean | null | undefined) {
  if (val === null || val === undefined) return null;
  const str = String(val);
  if (/^[=+\-@]/.test(str)) {
    return "'" + str;
  }
  return typeof val === "number" ? val : str;
}

function aggregateReviews(reviews: ApplicationReview[]) {
  const submitted = reviews.filter((r) => r.status === "submitted");
  const count = submitted.length;
  const score = submitted.reduce((acc, r) => acc + (r.total_score || 0), 0);
  const avg = count > 0 ? (score / count).toFixed(2) : "";
  const recommendations = submitted.map((r) => r.recommendation).filter(Boolean).join("; ");
  return { count, avg, recommendations };
}

function getFinalDecision(status: string | null) {
  if (!status) return "Pending";
  if (status === "approved_as_mentor" || status === "approved_as_mentee") return "Accepted";
  if (status === "rejected_or_not_fit") return "Rejected";
  if (status === "withdrawn") return "Withdrawn";
  return "Pending";
}

/**
 * One filename component. A UUID is never a useful context label and leaks an
 * internal identifier into a file that gets emailed around, so a component that
 * resolves to one is replaced by its fallback rather than printed.
 */
function sanitizeFilenamePart(value: string | null | undefined, fallback: string) {
  const raw = String(value ?? "").trim();
  if (!raw || UUID_PATTERN.test(raw)) return fallback;
  const cleaned = raw
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned || fallback;
}

function clean(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

const SUMMARY_HEADERS = [
  "Season", "Batch", "Role", "Application ID", "Applicant Name", "Email", "MSSV",
  "Application Status", "Final Decision",
  "Profile Review Submitted Count", "Profile Review Average Score", "Profile Review Recommendation(s)",
  "Interview Submitted Count", "Interview Average Score", "Interview Recommendation(s)"
];

const DETAIL_HEADERS = [
  "Applicant", "Role", "Application ID", "Round",
  "Reviewer Name", "Reviewer Email", "Assignment Status", "Assigned At", "Due At",
  "Motivation", "Objective", "Commitment", "Fit", "Communication",
  "Total Score", "Recommendation", "Reviewer Note", "Submitted At"
];

export async function GET(request: NextRequest) {
  const adminUser = await getCurrentAdminUser();
  if (!adminUser || !canExportApplicationResults(adminUser.role)) {
    return new Response("Unauthorized", { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const exportType = searchParams.get("type") || "summary";
  const format = searchParams.get("format") || "csv";
  const roleFilter = searchParams.get("role") || "all";
  const batchFilter = searchParams.get("batch") || "all";
  const seasonFilter = searchParams.get("season") || "all";
  const statusFilter = searchParams.get("status") || "all";

  // An unrecognised selector is rejected rather than ignored: silently falling
  // back to "all" would WIDEN what a narrowing parameter was asked to do.
  if (!EXPORT_TYPES.has(exportType) || !EXPORT_FORMATS.has(format) || !ROLE_FILTERS.has(roleFilter)) {
    return new Response("Invalid export parameters", { status: 400 });
  }

  // Enforce explicit operational scope.
  const scopeContext = await getAdminScopeContext();
  if (scopeContext.scopeError) {
    return new Response(scopeContext.scopeError, { status: 403 });
  }
  // The scope CATALOG read is checked before the scope itself is judged. A
  // program-level grant survives a failed catalog read with its program id
  // intact but no resolvable seasons, so the filter below looks granted while
  // every season-filtered loader under it returns nothing. Emitting that as a
  // 200 header-only file states "no applicants" on the strength of an outage.
  const { scope, error: scopeCatalogError } = await getScopeFilterResult(scopeContext);
  if (scopeCatalogError) {
    return new Response(scopeCatalogError, { status: 500 });
  }

  // A non-super user with no resolved grant has no export authority at all.
  // This is NOT the same condition as "the export came back empty", and it must
  // not be answered with a 200 and an empty file: an unauthorized Core Team
  // member would read that as "there is no data", which is a different — and
  // false — statement about the season.
  if (!scopeContext.isSuperAdmin && !hasAnyScope(scope)) {
    return new Response("Không có phạm vi dữ liệu nào được cấp cho tài khoản này.", { status: 403 });
  }

  // ── Canonical season metadata. Scoped, and fails closed. ──────────────────
  const seasonsResult = await getSeasons(scope);
  if (seasonsResult.error) {
    return new Response("Failed to load seasons", { status: 500 });
  }
  const seasons = seasonsResult.data as Season[];
  const seasonCodeById = new Map<string, string>();
  for (const season of seasons) {
    const id = clean(season.id);
    const code = clean(season.code);
    // A season row with no code cannot label a column. Registering the id here
    // would put a UUID in the visible "Season" cell, which is the exact
    // fail-open this loader exists to prevent — leave it unresolved instead.
    if (id && code) seasonCodeById.set(id, code);
  }

  const batchesResult = await getIntakeBatches(scope);
  if (batchesResult.error) {
    return new Response("Failed to load batches", { status: 500 });
  }
  const batches = batchesResult.data as IntakeBatch[];
  const batchById = new Map<string, IntakeBatch>();
  for (const batch of batches) {
    const id = clean(batch.id);
    if (id) batchById.set(id, batch);
  }

  // ── Narrowing selectors, validated against the RESOLVED scope. ────────────
  // `seasons` and `batches` above are already the scoped catalogs, so "not
  // present" means "not granted to you" as much as it means "does not exist".
  // Both are answered with 403; neither may quietly become an unfiltered export.
  let requestedSeason: Season | null = null;
  if (seasonFilter !== "all") {
    requestedSeason = seasons.find((season) => season.id === seasonFilter || season.code === seasonFilter) ?? null;
    if (!requestedSeason) {
      return new Response("Season nằm ngoài phạm vi được cấp.", { status: 403 });
    }
  }

  let requestedBatch: IntakeBatch | null = null;
  if (batchFilter !== "all") {
    requestedBatch = batches.find((batch) => batch.id === batchFilter || batch.code === batchFilter) ?? null;
    if (!requestedBatch) {
      return new Response("Đợt tuyển nằm ngoài phạm vi được cấp.", { status: 403 });
    }
  }

  const appsResult = await getApplications(scope);
  if (appsResult.error) {
    return new Response("Failed to load applications", { status: 500 });
  }

  const allReviewsResult = await getAllApplicationReviews(scope);
  if (allReviewsResult.error) {
    return new Response("Failed to load reviews", { status: 500 });
  }
  const allReviews = allReviewsResult.data;

  let apps = appsResult.data as Application[];
  if (roleFilter !== "all") {
    apps = apps.filter((a) => a.role_applied === roleFilter);
  }
  if (requestedBatch) {
    const batchId = requestedBatch.id;
    apps = apps.filter((a) => a.intake_batch_id === batchId);
  }
  if (requestedSeason) {
    const seasonId = requestedSeason.id;
    apps = apps.filter((a) => a.season_id === seasonId);
  }
  if (statusFilter !== "all") {
    apps = apps.filter((a) => a.status === statusFilter);
  }

  const appIds = new Set(apps.map((app) => app.id));
  const exportedReviews = allReviews.filter((review) => appIds.has(String(review.application_id)));

  // Grouped once. A per-application `.filter()` over the whole review set is
  // O(applications x reviews), which on a full season (thousands of each) is
  // tens of millions of comparisons per download.
  const reviewsByApp = new Map<string, ApplicationReview[]>();
  for (const review of exportedReviews) {
    const key = String(review.application_id);
    const bucket = reviewsByApp.get(key);
    if (bucket) bucket.push(review);
    else reviewsByApp.set(key, [review]);
  }

  // ── Season label per exported row. Unresolvable => the whole export fails. ─
  //
  // `applications.season_id` is the canonical season of an application. The
  // batch is a fallback for rows that genuinely have none — never a second
  // opinion about rows that do.
  //
  //   A. season_id populated  -> it must resolve in the AUTHORIZED season
  //      catalog. It is never re-labelled from its batch: an application
  //      carrying an unknown or out-of-scope season alongside an authorized
  //      batch would otherwise be exported under the batch's season, which
  //      both mislabels the row and carries an out-of-scope record into an
  //      in-scope file.
  //   B. season_id null       -> the batch may supply it, provided the batch
  //      resolves and ITS season resolves canonically.
  //   C. both present         -> they must agree. A disagreement is a
  //      data-integrity fault, and picking either side silently invents an
  //      answer, so the export fails instead.
  //
  // Any row that cannot obtain a canonical season CODE fails the whole export;
  // a UUID or a blank in that column is indistinguishable from a real label.
  const seasonLabelByAppId = new Map<string, string>();
  for (const app of apps) {
    const appSeasonId = clean(app.season_id);
    const batch = batchById.get(clean(app.intake_batch_id) ?? "");
    const batchSeasonId = clean(batch?.season_id);

    let code: string | null = null;
    if (appSeasonId) {
      code = seasonCodeById.get(appSeasonId) ?? null;
      if (batch && batchSeasonId !== appSeasonId) code = null;
    } else if (batchSeasonId) {
      code = seasonCodeById.get(batchSeasonId) ?? null;
    }

    if (!code) {
      return new Response("Failed to resolve season metadata for exported applications", { status: 500 });
    }
    seasonLabelByAppId.set(app.id, code);
  }

  const getBatchLabel = (id: string | null) => clean(batchById.get(clean(id) ?? "")?.code) ?? "";

  // ── Reviewer identity. Server-side, service-role, bulk, chunked. ──────────
  const needsReviewerIdentity = format === "xlsx" || exportType === "detail";
  const reviewerById = new Map<string, AdminUserPublic>();
  if (needsReviewerIdentity) {
    const reviewerIds = exportedReviews.map((review) => clean(review.reviewer_admin_user_id));
    const reviewersResult = await getAdminUsersByIds(reviewerIds);
    if (reviewersResult.error) {
      return new Response("Failed to load reviewer identities", { status: 500 });
    }
    for (const reviewer of reviewersResult.data) {
      if (reviewer?.id) reviewerById.set(String(reviewer.id), reviewer);
    }
  }

  const reviewerName = (review: ApplicationReview) => {
    const id = clean(review.reviewer_admin_user_id);
    const reviewer = id ? reviewerById.get(id) : undefined;
    return clean(reviewer?.full_name) ?? clean(reviewer?.email) ?? MISSING_REVIEWER_LABEL;
  };
  const reviewerEmail = (review: ApplicationReview) => {
    const id = clean(review.reviewer_admin_user_id);
    return clean(id ? reviewerById.get(id)?.email : null) ?? "";
  };

  type Cell = string | number | null | undefined;

  const summaryRow = (app: Application): Cell[] => {
    const appReviews = reviewsByApp.get(app.id) ?? [];
    const profileAgg = aggregateReviews(appReviews.filter((r) => r.review_round === "profile_screening"));
    const interviewAgg = aggregateReviews(appReviews.filter((r) => r.review_round === "interview"));
    // Only MSSV is lifted out of `raw_payload`; the payload itself is never
    // exported (privacy contract).
    const mssv = (app.raw_payload as Record<string, unknown> | null)?.mssv;
    return [
      seasonLabelByAppId.get(app.id) ?? "",
      getBatchLabel(app.intake_batch_id),
      app.role_applied,
      app.id,
      app.full_name,
      app.email_primary,
      mssv === null || mssv === undefined ? "" : String(mssv),
      app.status,
      getFinalDecision(app.status),
      profileAgg.count,
      profileAgg.avg,
      profileAgg.recommendations,
      interviewAgg.count,
      interviewAgg.avg,
      interviewAgg.recommendations
    ];
  };

  const detailRows = (): Cell[][] => {
    const rows: Cell[][] = [];
    for (const app of apps) {
      for (const review of reviewsByApp.get(app.id) ?? []) {
        // Expose CANCELLED explicitly to avoid distortion confusion.
        const statusLabel = review.status === "cancelled" ? "CANCELLED" : review.status;
        rows.push([
          app.full_name,
          app.role_applied,
          app.id,
          review.review_round,
          reviewerName(review),
          reviewerEmail(review),
          statusLabel,
          review.assigned_at,
          review.due_at,
          review.score_motivation,
          review.score_goal_clarity,
          review.score_commitment,
          review.score_fit,
          review.score_communication,
          review.total_score,
          review.recommendation,
          review.reviewer_note,
          review.submitted_at
        ]);
      }
    }
    return rows;
  };

  // ── Filename context, derived from what was actually resolved. ────────────
  const exportedSeasonCodes = Array.from(new Set(Array.from(seasonLabelByAppId.values())));
  const seasonPart = requestedSeason
    ? sanitizeFilenamePart(requestedSeason.code, "SEASON")
    : exportedSeasonCodes.length === 1
      ? sanitizeFilenamePart(exportedSeasonCodes[0], "SEASON")
      : exportedSeasonCodes.length > 1
        ? "MULTI-SEASON"
        : "ALL";
  const batchPart = requestedBatch ? sanitizeFilenamePart(requestedBatch.code ?? requestedBatch.name, "BATCH") : "ALL";
  const rolePart = roleFilter === "all" ? "ALL" : sanitizeFilenamePart(roleFilter, "ALL");
  const typePart = format === "xlsx" ? "tong-hop" : exportType === "summary" ? "ket-qua-tuyen" : "chi-tiet-cham";
  const datePart = new Date().toISOString().split("T")[0];
  const filenameStem = `${seasonPart}_${batchPart}_${rolePart}_${typePart}_${datePart}`;

  if (format === "xlsx") {
    // The real write-excel-file@4 Node API: a multi-sheet call takes
    // `{ sheet, data }` (NOT `name`) and returns a handle, not bytes. The bytes
    // come from `await result.toBuffer()`; handing the handle straight to
    // `Response` stringifies it to "[object Object]" and produces a download no
    // spreadsheet program can open.
    const writeXlsxFile = (await import("write-excel-file/node")).default;

    const summaryData: unknown[][] = [SUMMARY_HEADERS.map((h) => ({ value: h, fontWeight: "bold" as const }))];
    for (const app of apps) {
      const row = summaryRow(app);
      summaryData.push([
        { type: String, value: safeExcelValue(row[0] as string) },
        { type: String, value: safeExcelValue(row[1] as string) },
        { type: String, value: safeExcelValue(row[2] as string) },
        { type: String, value: safeExcelValue(row[3] as string) },
        { type: String, value: safeExcelValue(row[4] as string) },
        { type: String, value: safeExcelValue(row[5] as string) },
        // MSSV stays a String cell: "0012345678" typed as Number loses its
        // leading zeros the moment Excel opens the file.
        { type: String, value: safeExcelValue(row[6] as string) },
        { type: String, value: safeExcelValue(row[7] as string) },
        { type: String, value: safeExcelValue(row[8] as string) },
        { type: Number, value: row[9] as number },
        { type: String, value: safeExcelValue(row[10] as string) },
        { type: String, value: safeExcelValue(row[11] as string) },
        { type: Number, value: row[12] as number },
        { type: String, value: safeExcelValue(row[13] as string) },
        { type: String, value: safeExcelValue(row[14] as string) }
      ]);
    }

    const detailData: unknown[][] = [DETAIL_HEADERS.map((h) => ({ value: h, fontWeight: "bold" as const }))];
    for (const row of detailRows()) {
      detailData.push([
        { type: String, value: safeExcelValue(row[0] as string) },
        { type: String, value: safeExcelValue(row[1] as string) },
        { type: String, value: safeExcelValue(row[2] as string) },
        { type: String, value: safeExcelValue(row[3] as string) },
        { type: String, value: safeExcelValue(row[4] as string) },
        { type: String, value: safeExcelValue(row[5] as string) },
        { type: String, value: safeExcelValue(row[6] as string) },
        { type: String, value: safeExcelValue(row[7] as string) },
        { type: String, value: safeExcelValue(row[8] as string) },
        { type: Number, value: (row[9] as number) ?? null },
        { type: Number, value: (row[10] as number) ?? null },
        { type: Number, value: (row[11] as number) ?? null },
        { type: Number, value: (row[12] as number) ?? null },
        { type: Number, value: (row[13] as number) ?? null },
        { type: Number, value: (row[14] as number) ?? null },
        { type: String, value: safeExcelValue(row[15] as string) },
        { type: String, value: safeExcelValue(row[16] as string) },
        { type: String, value: safeExcelValue(row[17] as string) }
      ]);
    }

    // `writeXlsxFile` returns the handle synchronously; only `toBuffer` is async.
    const workbook = writeXlsxFile(
      [
        { sheet: "Ket_qua_tuyen", data: summaryData as never },
        { sheet: "Chi_tiet_cham", data: detailData as never }
      ],
      { fontFamily: "Arial", fontSize: 10 }
    );
    const buffer = await workbook.toBuffer();

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filenameStem}.xlsx"`
      }
    });
  }

  const BOM = "﻿";
  let csv = BOM;
  if (exportType === "summary") {
    csv += SUMMARY_HEADERS.map(escapeCSV).join(",") + "\n";
    for (const app of apps) {
      csv += summaryRow(app).map(escapeCSV).join(",") + "\n";
    }
  } else {
    csv += DETAIL_HEADERS.map(escapeCSV).join(",") + "\n";
    for (const row of detailRows()) {
      csv += row.map(escapeCSV).join(",") + "\n";
    }
  }

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filenameStem}.csv"`
    }
  });
}

/**
 * True when the resolved filter actually grants something. `getScopeFilter`
 * returns `undefined` for a super admin (no restriction) and a pair of ID lists
 * for everyone else; two empty lists mean "no rows anywhere", which is an
 * authorization answer, not a data answer.
 */
function hasAnyScope(scope: ScopeFilter | undefined) {
  if (!scope) return false;
  return Boolean(scope.allowedProgramIds?.length || scope.allowedSeasonIds?.length);
}
