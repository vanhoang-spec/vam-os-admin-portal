import { NextRequest } from "next/server";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canBrowseApplications } from "@/lib/read-access";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { getApplications, getAllApplicationReviews, getIntakeBatches } from "@/lib/data";
import { ApplicationReview, Application } from "@/lib/types";

// Security: Prefix spreadsheet formulas
function escapeCSV(val: string | number | boolean | null | undefined): string {
  if (val === null || val === undefined) return "";
  let str = String(val);
  if (/^[=+\-@]/.test(str)) {
    str = "'" + str;
  }
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    str = '"' + str.replace(/"/g, '""') + '"';
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
  
  if (!adminUser || !canBrowseApplications(adminUser.role)) {
    // Check specific roles as requested
    const allowed = ["super_admin", "admin", "core_team"];
    if (!adminUser || !allowed.includes(adminUser.role)) {
      return new Response("Unauthorized", { status: 403 });
    }
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
  
  let apps = appsResult.data;
  if (roleFilter !== "all") {
    apps = apps.filter(a => a.role_applied === roleFilter);
  }
  if (batchFilter !== "all") {
    apps = apps.filter(a => a.intake_batch_id === batchFilter);
  }
  if (statusFilter !== "all") {
    apps = apps.filter(a => a.status === statusFilter);
  }

  const reviewsResult = await getAllApplicationReviews(scope);
  const allReviews = reviewsResult.data || [];

  const batchesResult = await getIntakeBatches(scope);
  const batches = batchesResult.data || [];
  const getBatchName = (id: string | null) => {
    return batches.find(b => b.id === id)?.code || id || "";
  };

  // Construct CSV using UTF-8 BOM
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
      "Interview Submitted Count", "Interview Average Score", "Interview Recommendation(s)",
      "Final Decision At"
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
        app.season_id || "", // Season not strictly populated on Application, fallback empty or could get from season context
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
        interviewAgg.recommendations,
        "" // Final Decision At
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
        const row = [
          app.full_name,
          app.role_applied,
          app.id,
          review.review_round,
          review.reviewer_admin_user_id, // ID since email isn't joined yet
          "", // Reviewer Email (not joined)
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

  const seasonCode = "S12"; // Using S12 fallback for export filenames
  
  if (format === "xlsx") {
    // Construct XLSX
    const writeXlsxFile = (await import('write-excel-file/node')).default;
    
    // Sheet 1: Ket_qua_tuyen
    const summaryHeaders = [
      "Season", "Batch", "Role", "Application ID", "Applicant Name", "Email", "MSSV",
      "Application Status", "Final Decision",
      "Profile Review Submitted Count", "Profile Review Average Score", "Profile Review Recommendation(s)",
      "Interview Submitted Count", "Interview Average Score", "Interview Recommendation(s)",
      "Final Decision At"
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
        { type: String, value: safeExcelValue(app.season_id || "") },
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
        { type: String, value: safeExcelValue(interviewAgg.recommendations) },
        { type: String, value: "" } // Final Decision At
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
        detailData.push([
          { type: String, value: safeExcelValue(app.full_name) },
          { type: String, value: safeExcelValue(app.role_applied) },
          { type: String, value: safeExcelValue(app.id) },
          { type: String, value: safeExcelValue(review.review_round) },
          { type: String, value: safeExcelValue(review.reviewer_admin_user_id) },
          { type: String, value: "" }, // Reviewer Email (not joined yet)
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

