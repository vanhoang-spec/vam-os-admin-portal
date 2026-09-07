import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import {
  getReviewOversightQueue,
  getIntakeBatches,
  getSeasons,
  getActiveAdminUsers
} from "@/lib/data";
import { canBulkAssignReviews, canReview, isReviewerOnly } from "@/lib/permissions";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { displayText, formatDate } from "@/lib/utils";
import { isApplicationRecruitmentOperational } from "@/lib/application-review-assignability";
import { parseReviewOversightFilters, buildOversightQueryString, getReviewerIdentityLabel, getActionabilityState } from "@/lib/review-oversight";
import { Card, EmptyState, ErrorBox, PageHeader } from "@/components/ui";

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
  if (status === "cancelled") return "bg-slate-100 text-slate-500 border-slate-300";
  return "bg-slate-50 text-slate-500 border-vam-line";
}

function isOverdue(dueAt: string | null | undefined, status: string): boolean {
  if (!dueAt || status === "submitted" || status === "cancelled") return false;
  return new Date(dueAt) < new Date();
}

function isDueSoon(dueAt: string | null | undefined, status: string): boolean {
  if (!dueAt || status === "submitted" || status === "cancelled") return false;
  const due = new Date(dueAt);
  const now = new Date();
  if (due < now) return false;
  const msTomorrow = now.getTime() + 2 * 24 * 60 * 60 * 1000;
  return due.getTime() <= msTomorrow;
}

const ROUND_OPTIONS = [
  { value: "profile_screening", label: "Hồ sơ" },
  { value: "interview", label: "Phỏng vấn" }
];

const STATUS_OPTIONS = [
  { value: "assigned", label: "Chưa bắt đầu" },
  { value: "in_progress", label: "Đang làm" },
  { value: "submitted", label: "Đã nộp" },
  { value: "returned_for_clarification", label: "Cần làm rõ" },
  { value: "cancelled", label: "Đã huỷ" }
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function ReviewsPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const searchParams = await props.searchParams;
  const adminUser = await getCurrentAdminUser();
  if (!adminUser?.id) redirect("/login");
  if (!canReview(adminUser.role)) redirect("/");

  const reviewerOnly = isReviewerOnly(adminUser.role);
  const canBulkAssign = canBulkAssignReviews(adminUser.role);
  const scopeContext = await getAdminScopeContext();
  const scope = await getScopeFilter(scopeContext);

  const filters = parseReviewOversightFilters(searchParams);
  
  const [queueResult, intakeBatches, seasons, activeUsers] = await Promise.all([
    getReviewOversightQueue(filters, scope, reviewerOnly ? adminUser.id : undefined),
    !reviewerOnly ? getIntakeBatches(scope) : Promise.resolve({ data: [], error: null }),
    !reviewerOnly ? getSeasons(scope) : Promise.resolve({ data: [], error: null }),
    !reviewerOnly ? getActiveAdminUsers() : Promise.resolve({ data: [], error: null })
  ]);

  const { rows, totalCount, page, totalPages } = queueResult.data ?? { rows: [], totalCount: 0, page: 1, totalPages: 0 };

  const buildPageUrl = (p: number) => {
    return `/reviews${buildOversightQueryString({ ...filters, page: p })}`;
  };

  const currentScopeIsAll = filters.scopeMode === "all";

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

      <div className="mb-3 flex flex-wrap gap-3">
        <Link
          href="/interviews"
          className="inline-flex items-center gap-1.5 rounded-md border border-vam-line px-4 py-1.5 text-sm font-medium text-vam-green hover:bg-vam-mint"
        >
          Phỏng vấn ứng viên
        </Link>
      </div>

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

      <ErrorBox message={queueResult.error} />

      {!reviewerOnly && (
        <Card className="mb-6">
          <form method="GET" className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500">Mùa</label>
              <select name="season_id" defaultValue={filters.seasonId ?? ""} className="rounded-md border border-vam-line px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-vam-green">
                <option value="">Tất cả</option>
                {seasons.data.map(s => <option key={s.id} value={s.id}>{s.name ?? s.code}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500">Đợt tuyển</label>
              <select name="intake_batch_id" defaultValue={filters.intakeBatchId ?? ""} className="rounded-md border border-vam-line px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-vam-green">
                <option value="">Tất cả đợt</option>
                {intakeBatches.data.map(b => <option key={b.id} value={b.id}>{b.name ?? b.code ?? b.id}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500">Vòng review</label>
              <select name="review_round" defaultValue={filters.reviewRound ?? ""} className="rounded-md border border-vam-line px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-vam-green">
                <option value="">Tất cả vòng</option>
                {ROUND_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500">Reviewer/Interviewer</label>
              <select name="reviewer" defaultValue={filters.reviewerId ?? ""} className="rounded-md border border-vam-line px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-vam-green max-w-[200px]">
                <option value="">Tất cả</option>
                <option value="unassigned">(Chưa gán)</option>
                {activeUsers.data.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500">Trạng thái review</label>
              <select name="review_status" defaultValue={filters.reviewStatus ?? ""} className="rounded-md border border-vam-line px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-vam-green">
                <option value="">Tất cả</option>
                {STATUS_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2 mb-1.5 ml-2">
              <input type="checkbox" id="scopeAllToggle" name="scope" value="all" defaultChecked={currentScopeIsAll} className="rounded border-slate-300 text-vam-green focus:ring-vam-green" />
              <label htmlFor="scopeAllToggle" className="text-sm text-slate-600">Hiện cả lịch sử</label>
            </div>
            <button type="submit" className="rounded-md bg-vam-green px-4 py-1.5 text-sm font-medium text-white hover:bg-vam-green/90 ml-auto">
              Lọc
            </button>
          </form>
          {(filters.seasonId || filters.intakeBatchId || filters.reviewRound || filters.reviewerId || filters.reviewStatus || currentScopeIsAll) && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/reviews" className="text-xs text-slate-400 underline hover:text-slate-600">
                Xóa bộ lọc
              </Link>
            </div>
          )}
        </Card>
      )}

      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm font-medium text-slate-600">
          Hiển thị {rows.length} / {totalCount} reviews
        </span>
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState message="Không tìm thấy review nào phù hợp." />
        ) : (
          <div className="overflow-hidden rounded-lg border border-vam-line bg-white">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-vam-line text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Ứng viên</th>
                    {!reviewerOnly && <th className="px-4 py-3">Reviewer</th>}
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
                  {rows.map((row) => {
                    const overdue = isOverdue(row.due_at, row.status);
                    const dueSoon = !overdue && isDueSoon(row.due_at, row.status);
                    const isTerminal = !isApplicationRecruitmentOperational(row.application?.status ?? row.application?.final_status);
                    const actionState = getActionabilityState(row.status, isTerminal);
                    const applicantName = row.application?.full_name ?? row.application?.person_id ?? row.application_id;

                    return (
                    <tr key={row.id} className={`hover:bg-vam-mint/40 ${overdue ? "bg-red-50/60" : ""} ${!actionState.isActionable ? "opacity-70" : ""}`}>
                      <td className="px-4 py-3 font-medium text-vam-ink">
                        <Link
                          href={reviewerOnly ? `/reviews/${row.id}` : `/applications/${row.application_id}`}
                          className="hover:text-vam-green hover:underline"
                        >
                          {displayText(applicantName)}
                        </Link>
                      </td>
                      {!reviewerOnly && (
                        <td className="px-4 py-3 text-slate-700">
                          {getReviewerIdentityLabel(row.reviewer_admin_user_id, row.reviewer?.full_name, row.reviewer?.email)}
                        </td>
                      )}
                      <td className="px-4 py-3 text-slate-700">
                        {roundLabel(row.review_round)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(row.status)}`}>
                          {actionState.badgeLabel}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                        <div className="flex flex-col gap-1">
                          <span>{row.due_at ? formatDate(row.due_at) : "-"}</span>
                          {overdue ? (
                            <span className="inline-flex w-fit rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">Quá hạn</span>
                          ) : dueSoon ? (
                            <span className="inline-flex w-fit rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Sắp đến hạn</span>
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
                          {actionState.isActionable ? "Làm review" : "Xem"}
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

      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {page > 1 ? (
              <Link href={buildPageUrl(page - 1)} className="rounded-md border border-vam-line bg-white px-3 py-1 text-sm font-medium text-slate-600 hover:bg-slate-50">
                Trước
              </Link>
            ) : (
              <span className="rounded-md border border-vam-line bg-slate-50 px-3 py-1 text-sm font-medium text-slate-400">Trước</span>
            )}
            <span className="text-sm text-slate-600">
              Trang {page} / {totalPages}
            </span>
            {page < totalPages ? (
              <Link href={buildPageUrl(page + 1)} className="rounded-md border border-vam-line bg-white px-3 py-1 text-sm font-medium text-slate-600 hover:bg-slate-50">
                Tiếp
              </Link>
            ) : (
              <span className="rounded-md border border-vam-line bg-slate-50 px-3 py-1 text-sm font-medium text-slate-400">Tiếp</span>
            )}
          </div>
        </div>
      )}
    </>
  );
}
