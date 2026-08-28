import { NextRequest } from "next/server";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { getApplications, getAllApplicationReviews, getIntakeBatches } from "@/lib/data";
import { ApplicationReview, Application } from "@/lib/types";
import { getSupabaseServerClient } from "@/lib/supabase-server";

// Security: Prefix spreadsheet formulas
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

// Same prefix logic for XLSX to avoid formula injection
function safeExcelValue(val: string | number | boolean | null | undefined) {
  if (val === null || val === undefined) return null;
  let str = String(val);
  if (/^[=+\-@]/.test(str)) {
    return "'" + str;
  }
  return typeof val === 'number' ? val : str;
}

function aggregateReviews(reviews: ApplicationReview[]) {
  const submitted = reviews.filter(r => r.status === "submitted");
  const count = submitted.length;
  const score = submitted.reduce((acc, r) => acc + (r.total_score || 0), 0);
  const avg = count > 0 ? (score / count).toFixed(2) : "";
  const recommendations = submitted.map(r => r.recommendation).filter(Boolean).join("; ");
  return { count, avg, recommendations };
}

export async function GET(request: NextRequest) {
  const adminUser = await getCurrentAdminUser();
  
  const allowed = ["super_admin", "admin", "core_team"];
  if (!adminUser || !allowed.includes(adminUser.role)) {
    return new Response("Unauthorized", { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const exportType = searchParams.get("type") || "summary";
  const format = searchParams.get("format") || "csv";
  const roleFilter = searchParams.get("role") || "all";
  const batchFilter = searchParams.get("batch") || "all";
  const statusFilter = searchParams.get("status") || "all";

  // Enforce explicit operational scope
  const scopeContext = await getAdminScopeContext();
  if (scopeContext.scopeError) {
    return new Response(scopeContext.scopeError, { status: 403 });
  }
  const scope = await getScopeFilter(scopeContext);

  const appsResult = await getApplications(scope);
  if (appsResult.error) {
    return new Response("Failed to load applications", { status: 500 });
  }
  
  const allReviewsResult = await getAllApplicationReviews(scope);
  if (allReviewsResult.error) {
    return new Response("Failed to load reviews", { status: 500 });
  }
  
  const batchesResult = await getIntakeBatches(scope);
  if (batchesResult.error) {
    return new Response("Failed to load batches", { status: 500 });
  }

  let apps = appsResult.data;
  const allReviews = allReviewsResult.data;
  const batches = batchesResult.data;
  const getBatchName = (id: string | null) => {
    return batches.find(b => b.id === id)?.code || id || "";
  };

  const supabase = getSupabaseServerClient();
  const { data: seasons } = await supabase.from("seasons").select("id, code");
  const seasonMap = new Map(seasons?.map(s => [s.id, s.code]));

  const reviewerIds = Array.from(new Set(allReviews.map(r => r.reviewer_admin_user_id).filter(Boolean)));
  const { data: adminUsers } = await supabase
    .from("admin_users")
    .select("id, full_name, email")
    .in("id", reviewerIds);
  const reviewerMap = new Map(adminUsers?.map(u => [u.id, u]));

  if (roleFilter !== "all") {
    apps = apps.filter(a => a.role_applied === roleFilter);
  }
  if (batchFilter !== "all") {
    apps = apps.filter(a => a.intake_batch_id === batchFilter);
  }
  if (statusFilter !== "all") {
    apps = apps.filter(a => a.status === statusFilter);
  }

  const BOM = "\uFEFF";
  let csv = BOM;

  const getFinalDecision = (status: string | null) => {
    if (!status) return "Pending";
    if (status === "approved_as_mentor" || status === "approved_as_mentee") return "Accepted";
    if (status === "rejected_or_not_fit") return "Rejected";
    if (status === "withdrawn") return "Withdrawn";
    return "Pending";
  };

  if (exportType === "summary") {
    const headers = [
      "Season", "Batch", "Role", "Application ID", "Applicant Name", "Email", "MSSV",
      "Application Status", "Final Decision",
      "Profile Review Submitted Count", "Profile Review Average Score", "Profile Review Recommendation(s)",
      "Interview Submitted Count", "Interview Average Score", "Interview Recommendation(s)"
    ];
    csv += headers.map(escapeCSV).join(",") + "\n";

    for (const app of apps) {
      const appReviews = allReviews.filter(r => r.application_id === app.id);
      const profileReviews = appReviews.filter(r => r.review_round === "profile_screening");
      const interviewReviews = appReviews.filter(r => r.review_round === "interview");

      const profileAgg = aggregateReviews(profileReviews);
      const interviewAgg = aggregateReviews(interviewReviews);

      const mssv = (app.raw_payload as any)?.mssv || "";

      const row = [
        seasonMap.get(app.season_id) || app.season_id || "",
        getBatchName(app.intake_batch_id),
        app.role_applied,
        app.id,
        app.full_name,
        app.email_primary,
        mssv,
        app.status,
        getFinalDecision(app.status),
        profileAgg.count,
        profileAgg.avg,
        profileAgg.recommendations,
        interviewAgg.count,
        interviewAgg.avg,
        interviewAgg.recommendations
      ];
      csv += row.map(escapeCSV).join(",") + "\n";
    }
  } else if (exportType === "detail") {
    const headers = [
      "Applicant", "Role", "Application ID", "Round",
      "Reviewer Name", "Reviewer Email", "Assignment Status", "Assigned At", "Due At",
      "Motivation", "Objective", "Commitment", "Fit", "Communication",
      "Total Score", "Recommendation", "Reviewer Note", "Submitted At"
    ];
    csv += headers.map(escapeCSV).join(",") + "\n";

    for (const app of apps) {
      const appReviews = allReviews.filter(r => r.application_id === app.id);
      for (const review of appReviews) {
        // Expose CANCELLED explicitly to avoid distortion confusion
        const statusLabel = review.status === "cancelled" ? "CANCELLED" : review.status;
        const reviewer = reviewerMap.get(review.reviewer_admin_user_id);
        const row = [
          app.full_name,
          app.role_applied,
          app.id,
          review.review_round,
          reviewer?.full_name || review.reviewer_admin_user_id,
          reviewer?.email || "",
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
        ];
        csv += row.map(escapeCSV).join(",") + "\n";
      }
    }
  }

  const uniqueSeasons = Array.from(new Set(apps.map(a => seasonMap.get(a.season_id) || a.season_id).filter(Boolean)));
  const seasonCode = uniqueSeasons.length === 1 ? uniqueSeasons[0] : (uniqueSeasons.length > 1 ? "MULTI_SEASON" : "ALL");
  
  if (format === "xlsx") {
    // Construct XLSX
    const writeXlsxFile = (await import('write-excel-file/node')).default;
    
    // Sheet 1: Ket_qua_tuyen
    const summaryHeaders = [
      "Season", "Batch", "Role", "Application ID", "Applicant Name", "Email", "MSSV",
      "Application Status", "Final Decision",
      "Profile Review Submitted Count", "Profile Review Average Score", "Profile Review Recommendation(s)",
      "Interview Submitted Count", "Interview Average Score", "Interview Recommendation(s)"
    ].map(h => ({ value: h, fontWeight: "bold" as const }));
    
    const summaryData: any[][] = [summaryHeaders];
    for (const app of apps) {
      const appReviews = allReviews.filter(r => r.application_id === app.id);
      const profileReviews = appReviews.filter(r => r.review_round === "profile_screening");
      const interviewReviews = appReviews.filter(r => r.review_round === "interview");

      const profileAgg = aggregateReviews(profileReviews);
      const interviewAgg = aggregateReviews(interviewReviews);
      const mssv = (app.raw_payload as any)?.mssv || "";

      summaryData.push([
        { type: String, value: safeExcelValue(seasonMap.get(app.season_id) || app.season_id || "") },
        { type: String, value: safeExcelValue(getBatchName(app.intake_batch_id)) },
        { type: String, value: safeExcelValue(app.role_applied) },
        { type: String, value: safeExcelValue(app.id) },
        { type: String, value: safeExcelValue(app.full_name) },
        { type: String, value: safeExcelValue(app.email_primary) },
        { type: String, value: safeExcelValue(mssv) },
        { type: String, value: safeExcelValue(app.status) },
        { type: String, value: safeExcelValue(getFinalDecision(app.status)) },
        { type: Number, value: profileAgg.count },
        { type: String, value: profileAgg.avg },
        { type: String, value: safeExcelValue(profileAgg.recommendations) },
        { type: Number, value: interviewAgg.count },
        { type: String, value: interviewAgg.avg },
        { type: String, value: safeExcelValue(interviewAgg.recommendations) }
      ]);
    }

    // Sheet 2: Chi_tiet_cham
    const detailHeaders = [
      "Applicant", "Role", "Application ID", "Round",
      "Reviewer Name", "Reviewer Email", "Assignment Status", "Assigned At", "Due At",
      "Motivation", "Objective", "Commitment", "Fit", "Communication",
      "Total Score", "Recommendation", "Reviewer Note", "Submitted At"
    ].map(h => ({ value: h, fontWeight: "bold" as const }));
    
    const detailData: any[][] = [detailHeaders];
    for (const app of apps) {
      const appReviews = allReviews.filter(r => r.application_id === app.id);
      for (const review of appReviews) {
        const statusLabel = review.status === "cancelled" ? "CANCELLED" : review.status;
        const reviewer = reviewerMap.get(review.reviewer_admin_user_id);
        detailData.push([
          { type: String, value: safeExcelValue(app.full_name) },
          { type: String, value: safeExcelValue(app.role_applied) },
          { type: String, value: safeExcelValue(app.id) },
          { type: String, value: safeExcelValue(review.review_round) },
          { type: String, value: safeExcelValue(reviewer?.full_name || review.reviewer_admin_user_id) },
          { type: String, value: safeExcelValue(reviewer?.email || "") },
          { type: String, value: safeExcelValue(statusLabel) },
          { type: String, value: safeExcelValue(review.assigned_at) },
          { type: String, value: safeExcelValue(review.due_at) },
          { type: Number, value: review.score_motivation ?? null },
          { type: Number, value: review.score_goal_clarity ?? null },
          { type: Number, value: review.score_commitment ?? null },
          { type: Number, value: review.score_fit ?? null },
          { type: Number, value: review.score_communication ?? null },
          { type: Number, value: review.total_score ?? null },
          { type: String, value: safeExcelValue(review.recommendation) },
          { type: String, value: safeExcelValue(review.reviewer_note) },
          { type: String, value: safeExcelValue(review.submitted_at) }
        ]);
      }
    }
    
    // Ensure detailData has at least a header, write-excel-file crashes on empty sheets sometimes, but we have headers so it's fine.
    
    const sheets = [
      { name: "Ket_qua_tuyen", data: summaryData },
      { name: "Chi_tiet_cham", data: detailData }
    ];

    const buffer = await writeXlsxFile(sheets, {
      fontFamily: "Arial",
      fontSize: 10
    });
    
    return new Response(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="vam_os_export_${seasonCode}_${exportType}_${Date.now()}.xlsx"`
      }
    });
  }

  // Fallback to CSV
  const filename = `UEHM-${seasonCode}_${batchFilter}_${roleFilter}_${exportType === "summary" ? "ket-qua-tuyen" : "chi-tiet-cham"}_${new Date().toISOString().split("T")[0]}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`
    }
  });
}

