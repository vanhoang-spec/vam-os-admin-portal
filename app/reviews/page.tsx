import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import {
  getAllApplicationReviews,
  getApplication,
  getMyApplicationReviews
} from "@/lib/data";
import { canBulkAssignReviews, canReview, isReviewerOnly } from "@/lib/permissions";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import type { ApplicationReview } from "@/lib/types";
import { displayText, formatDate } from "@/lib/utils";
import { Card, EmptyState, ErrorBox, PageHeader, SimpleTable } from "@/components/ui";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function reviewStatusLabel(status: string) {
  if (status === "assigned") return "Chưa bắt đầu";
  if (status === "in_progress") return "Đang làm";
  if (status === "submitted") return "Đã nộp";
  if (status === "returned_for_clarification") return "Cần làm rõ";
  if (status === "cancelled") return "Đã huỷ";
  return status;
}

function roundLabel(round: string) {
  if (round === "profile_screening") return "Hồ sơ";
  if (round === "interview") return "Phỏng vấn";
  return round;
}

function statusBadgeClass(status: string) {
  if (status === "submitted") return "bg-green-50 text-green-700 border-green-200";
  if (status === "in_progress") return "bg-amber-50 text-amber-700 border-amber-200";
  if (status === "assigned") return "bg-slate-50 text-slate-600 border-slate-200";
  if (status === "returned_for_clarification") return "bg-orange-50 text-orange-700 border-orange-200";
  return "bg-slate-50 text-slate-500 border-vam-line";
}

/** Returns true when a review is past its deadline and not yet submitted. */
function isOverdue(dueAt: string | null | undefined, status: string): boolean {
  if (!dueAt || status === "submitted" || status === "cancelled") return false;
  return new Date(dueAt) < new Date();
}

/** Returns true when the deadline is today or tomorrow and review is not done. */
function isDueSoon(dueAt: string | null | undefined, status: string): boolean {
  if (!dueAt || status === "submitted" || status === "cancelled") return false;
  const due = new Date(dueAt);
  const now = new Date();
  if (due < now) return false; // already overdue
  const msTomorrow = now.getTime() + 2 * 24 * 60 * 60 * 1000;
  return due.getTime() <= msTomorrow;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function ReviewsPage() {
  const adminUser = await getCurrentAdminUser();
  if (!adminUser?.id) redirect("/login");
  if (!canReview(adminUser.role)) redirect("/");

  const reviewerOnly = isReviewerOnly(adminUser.role);
  const canBulkAssign = canBulkAssignReviews(adminUser.role);
  const scope = await getScopeFilter(await getAdminScopeContext());

  const result = reviewerOnly
    ? await getMyApplicationReviews(adminUser.id, scope)
    : await getAllApplicationReviews(scope);

  const reviews = result.data;

  // Fetch a lightweight application summary for each review so we can show
  // the applicant name and application link in the table. We deduplicate by
  // application_id to avoid redundant requests.
  const uniqueAppIds = Array.from(new Set(reviews.map((r) => r.application_id)));
  const appResults = await Promise.all(uniqueAppIds.map((id) => getApplication(id, scope)));
  const appMap = new Map(
    appResults
      .filter((r) => r.data)
      .map((r) => [r.data!.id, r.data!])
  );

  const tableRows = reviews.map((review) => {
    const app = appMap.get(review.application_id);
    const applicantName =
      app?.full_name ?? app?.person_id ?? review.application_id;
    return { ...review, applicant_name: applicantName };
  });

  // Summary counts
  const assignedCount = reviews.filter((r) => r.status === "assigned").length;
  const inProgressCount = reviews.filter((r) => r.status === "in_progress").length;
  const submittedCount = reviews.filter((r) => r.status === "submitted").length;

  return (
    <>
      <PageHeader
        title={reviewerOnly ? "Reviews của tôi" : "Tất cả Reviews"}
        description={
          reviewerOnly
            ? "Danh sách các đơn được giao cho bạn cần review."
            : "Toàn bộ phân công review trong hệ thống."
        }
      />

      {/* Reviewer quick-link bar (all reviewer tiers) */}
      <div className="mb-3 flex flex-wrap gap-3">
        <Link
          href="/interviews"
          className="inline-flex items-center gap-1.5 rounded-md border border-vam-line px-4 py-1.5 text-sm font-medium text-vam-green hover:bg-vam-mint"
        >
          Phỏng vấn ứng viên
        </Link>
      </div>

      {/* Admin action bar */}
      {canBulkAssign && (
        <div className="mb-5 flex flex-wrap gap-3">
          <Link
            href="/reviews/assign-bulk"
            className="inline-flex items-center gap-1.5 rounded-md bg-vam-green px-4 py-1.5 text-sm font-medium text-white hover:bg-vam-green/90"
          >
            Chia hồ sơ review
          </Link>
          <Link
            href="/reviews/progress"
            className="inline-flex items-center gap-1.5 rounded-md border border-vam-line px-4 py-1.5 text-sm font-medium text-vam-green hover:bg-vam-mint"
          >
            Tiến độ review
          </Link>
          <Link
            href="/reviews/reviewer-pool"
            className="inline-flex items-center gap-1.5 rounded-md border border-vam-line px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Danh sách reviewer
          </Link>
          <Link href="/reviews/settings" className="inline-flex items-center rounded-md border border-vam-line px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cấu hình số review</Link>
          <Link
            href="/reviews/guide"
            className="inline-flex items-center gap-1.5 rounded-md border border-vam-line px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Hướng dẫn vận hành
          </Link>
        </div>
      )}

      <ErrorBox message={result.error} />

      {/* Summary pills */}
      <div className="mb-4 flex flex-wrap gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-600">
          Chưa bắt đầu: <strong>{assignedCount}</strong>
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-sm font-medium text-amber-700">
          Đang làm: <strong>{inProgressCount}</strong>
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-3 py-1 text-sm font-medium text-green-700">
          Đã nộp: <strong>{submittedCount}</strong>
        </span>
      </div>

      <Card>
        {tableRows.length === 0 ? (
          <EmptyState message="Chưa có review nào được giao." />
        ) : (
          <div className="overflow-hidden rounded-lg border border-vam-line bg-white">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-vam-line text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Ứng viên</th>
                    <th className="px-4 py-3">Vòng</th>
                    <th className="px-4 py-3">Trạng thái</th>
                    <th className="px-4 py-3">Hạn nộp</th>
                    <th className="px-4 py-3">Nộp lúc</th>
                    <th className="px-4 py-3">Điểm tổng</th>
                    <th className="px-4 py-3">Đề xuất</th>
                    <th className="px-4 py-3">Hành động</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-vam-line">
                  {tableRows.map((row) => {
                    const overdue = isOverdue(row.due_at, row.status);
                    const dueSoon = !overdue && isDueSoon(row.due_at, row.status);
                    return (
                    <tr key={row.id} className={`hover:bg-vam-mint/40 ${overdue ? "bg-red-50/60" : ""}`}>
                      <td className="px-4 py-3 font-medium text-vam-ink">
                        <Link
                          href={reviewerOnly ? `/reviews/${row.id}` : `/applications/${row.application_id}`}
                          className="hover:text-vam-green hover:underline"
                        >
                          {displayText(row.applicant_name)}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {roundLabel(row.review_round)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(row.status)}`}
                        >
                          {reviewStatusLabel(row.status)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                        <div className="flex flex-col gap-1">
                          <span>{row.due_at ? formatDate(row.due_at) : "-"}</span>
                          {overdue ? (
                            <span className="inline-flex w-fit rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                              Quá hạn
                            </span>
                          ) : dueSoon ? (
                            <span className="inline-flex w-fit rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                              Sắp đến hạn
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                        {row.submitted_at ? formatDate(row.submitted_at) : "-"}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {row.total_score !== null ? row.total_score : "-"}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {displayText(row.recommendation)}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/reviews/${row.id}`}
                          className="inline-flex rounded-md border border-vam-line px-2.5 py-1 text-xs font-medium text-vam-green hover:bg-vam-mint"
                        >
                          {row.status === "submitted" ? "Xem" : "Làm review"}
                        </Link>
                      </td>
                    </tr>
                  );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
