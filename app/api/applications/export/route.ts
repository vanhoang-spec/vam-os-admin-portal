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

  if (exportType === "summary") {
    const headers = [
      "Mã hồ sơ", "Đợt tuyển", "Vai trò", "Họ tên", "Email", "MSSV", "Trạng thái", "Vòng hiện tại",
      "SL duyệt hồ sơ", "Điểm TB duyệt hồ sơ", "Đề xuất duyệt hồ sơ",
      "SL phỏng vấn", "Điểm TB phỏng vấn", "Đề xuất phỏng vấn"
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
        app.id,
        getBatchName(app.intake_batch_id),
        app.role_applied,
        app.full_name,
        app.email_primary,
        mssv,
        app.status,
        "", // current_round (derived or left blank if not explicit)
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
      "Mã hồ sơ", "Họ tên", "Vai trò", "Đợt tuyển", "Mã chấm", "Vòng chấm",
      "Email giám khảo", "Trạng thái phân công", "Ngày phân công", "Hạn chót",
      "Động lực", "Mục tiêu", "Cam kết", "Mức độ phù hợp", "Giao tiếp",
      "Tổng điểm", "Đề xuất", "Ghi chú giám khảo", "Ngày nộp"
    ];
    csv += headers.map(escapeCSV).join(",") + "\n";

    for (const app of apps) {
      const appReviews = allReviews.filter(r => r.application_id === app.id);
      for (const review of appReviews) {
        const row = [
          app.id,
          app.full_name,
          app.role_applied,
          getBatchName(app.intake_batch_id),
          review.id,
          review.review_round,
          review.reviewer_admin_user_id, // ID since email isn't joined yet
          review.status,
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
  const filename = `UEHM-${seasonCode}_${batchFilter}_${roleFilter}_${exportType === "summary" ? "ket-qua-tuyen" : "chi-tiet-cham"}_${new Date().toISOString().split("T")[0]}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`
    }
  });
}
