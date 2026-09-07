import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import {
  getIntakeBatches,
  getReviewOversightAggregate,
  getReviewOversightQueue,
  getSeasons,
  type ReviewOversightActor,
  type ReviewOversightRow
} from "@/lib/data";
import { canAssignReview, canBulkAssignReviews, canReview, isReviewerOnly } from "@/lib/permissions";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import {
  buildReviewOversightHref,
  isUnassignedReviewerFilter,
  parseReviewOversightFilters,
  REVIEW_OVERSIGHT_PAGE_SIZE,
  REVIEW_OVERSIGHT_UNASSIGNED,
  REVIEW_OVERSIGHT_ROLES,
  REVIEW_OVERSIGHT_ROUNDS,
  REVIEW_OVERSIGHT_STATUSES,
  reviewerIdentityLabel,
  reviewOversightActionability,
  type ReviewOversightFilters,
  type ReviewOversightSearchParams
} from "@/lib/review-oversight";
import { displayText, formatDate } from "@/lib/utils";
import { Card, EmptyState, ErrorBox, PageHeader } from "@/components/ui";

// ---------------------------------------------------------------------------
// Labels
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

function roleLabel(role: string) {
  if (role === "mentor") return "Mentor";
  if (role === "mentee") return "Mentee";
  return role;
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

const SELECT_CLASS =
  "rounded-md border border-vam-line px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-vam-green";

/**
 * A hidden input keeps a filter attached across a GET form submit.
 * `page` is deliberately NOT carried — changing a filter returns to page 1.
 */
function HiddenFilter({ name, value }: { name: string; value: string | null }) {
  return value ? <input type="hidden" name={name} value={value} /> : null;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/**
 * TẤT CẢ REVIEWS — the Interview Ops oversight list.
 *
 * Reads one joined, filtered, server-paged query through
 * `getReviewOversightQueue`. The previous implementation paged the entire
 * scoped `applications` table and then issued one `getApplication` per review
 * row; both are gone.
 *
 * WHOSE ROWS: decided by the actor passed to the query, never by the URL. A
 * reviewer-only account is pinned to its own assignments and to the operational
 * population inside the predicate builder, so `?reviewer=<someone-else>` and
 * `?scope=all` cannot widen the read. The oversight read uses the service-role
 * client — RLS is not the boundary here, this actor is.
 */
export default async function ReviewsPage(props: {
  searchParams?: Promise<ReviewOversightSearchParams>;
}) {
  const searchParams = (await props.searchParams) ?? {};

  const adminUser = await getCurrentAdminUser();
  if (!adminUser?.id) redirect("/login");
  if (!canReview(adminUser.role)) redirect("/");

  const reviewerOnly = isReviewerOnly(adminUser.role);
  const canOversee = canAssignReview(adminUser.role);
  const canBulkAssign = canBulkAssignReviews(adminUser.role);

  // /reviews defaults to EVERY round; the round is a filter, not a mode.
  const filters = parseReviewOversightFilters(searchParams, { defaultReviewRound: null });
  const actor: ReviewOversightActor = reviewerOnly
    ? { kind: "reviewer", adminUserId: adminUser.id }
    : { kind: "oversight", adminUserId: adminUser.id };

  const scopeContext = await getAdminScopeContext();
  if (scopeContext.scopeError) {
    return (
      <>
        <PageHeader title="Tất cả Reviews" description="Không thể xác minh phạm vi dữ liệu." />
        <ErrorBox message={scopeContext.scopeError} />
      </>
    );
  }
  const scope = await getScopeFilter(scopeContext);

  const [queueResult, seasons, intakeBatches, aggregateResult] = await Promise.all([
    getReviewOversightQueue({ filters, actor, scope }),
    getSeasons(scope),
    getIntakeBatches(scope),
    // Reviewer options come from the assignments that EXIST in the current
    // filter context, so an inactive or removed account that still holds
    // history stays selectable. `getActiveAdminUsers` would hide exactly those.
    canOversee
      ? getReviewOversightAggregate({ filters, actor, scope })
      : Promise.resolve({ data: [], error: null })
  ]);

  const queue = queueResult.data;
  const rows = queue.rows;

  const reviewerOptions = aggregateResult.data
    .filter((stats) => stats.reviewer_admin_user_id)
    .map((stats) => ({
      id: stats.reviewer_admin_user_id as string,
      label: reviewerIdentityLabel(
        stats.reviewer_admin_user_id,
        stats.reviewer_full_name,
        stats.reviewer_email
      )
    }));

  // Unassigned work is a filterable bucket of its own, not a missing reviewer.
  // It is offered whenever such rows exist in the current filter context, or
  // whenever it is already the active filter.
  const hasUnassignedBucket = aggregateResult.data.some(
    (stats) => !stats.reviewer_admin_user_id
  );
  if (hasUnassignedBucket || isUnassignedReviewerFilter(filters.reviewerId)) {
    reviewerOptions.push({
      id: REVIEW_OVERSIGHT_UNASSIGNED,
      label: reviewerIdentityLabel(null, null, null)
    });
  }

  // A reviewer selected under a wider filter must stay selectable after the
  // filter narrows, or the control would silently clear itself.
  if (filters.reviewerId && !reviewerOptions.some((option) => option.id === filters.reviewerId)) {
    const fromRows = rows.find((row) => row.reviewer_admin_user_id === filters.reviewerId);
    reviewerOptions.unshift({
      id: filters.reviewerId,
      label: reviewerIdentityLabel(
        filters.reviewerId,
        fromRows?.reviewer?.full_name ?? null,
        fromRows?.reviewer?.email ?? null
      )
    });
  }

  const firstRowNumber = queue.totalCount ? (queue.page - 1) * REVIEW_OVERSIGHT_PAGE_SIZE + 1 : 0;
  const lastRowNumber = firstRowNumber ? firstRowNumber + rows.length - 1 : 0;
  const historyMode = !reviewerOnly && filters.scopeMode === "all";

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
            href={buildReviewOversightHref("/reviews/progress", filters, {
              reviewerId: null,
              reviewStatus: null,
              page: 1
            })}
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
          <Link
            href="/reviews/settings"
            className="inline-flex items-center rounded-md border border-vam-line px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Cấu hình số review
          </Link>
          <Link
            href="/reviews/guide"
            className="inline-flex items-center gap-1.5 rounded-md border border-vam-line px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Hướng dẫn vận hành
          </Link>
        </div>
      )}

      <ErrorBox message={queueResult.error ?? aggregateResult.error} />

      {/* Filter bar */}
      <Card className="mb-5">
        <form method="GET" className="flex flex-wrap items-end gap-3" data-testid="review-filters">
          {canOversee ? (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500" htmlFor="filter-season">
                Mùa
              </label>
              <select
                id="filter-season"
                name="season_id"
                defaultValue={filters.seasonId ?? ""}
                className={SELECT_CLASS}
              >
                <option value="">Tất cả mùa</option>
                {seasons.data.map((season) => (
                  <option key={season.id} value={season.id}>
                    {season.name ?? season.code ?? season.id}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500" htmlFor="filter-batch">
              Đợt tuyển
            </label>
            <select
              id="filter-batch"
              name="intake_batch_id"
              defaultValue={filters.intakeBatchId ?? ""}
              className={SELECT_CLASS}
            >
              <option value="">Tất cả đợt</option>
              {intakeBatches.data.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.name ?? batch.code ?? batch.id}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500" htmlFor="filter-role">
              Vai trò ứng tuyển
            </label>
            <select
              id="filter-role"
              name="role_applied"
              defaultValue={filters.roleApplied ?? ""}
              className={SELECT_CLASS}
            >
              <option value="">Tất cả vai trò</option>
              {REVIEW_OVERSIGHT_ROLES.map((role) => (
                <option key={role} value={role}>
                  {roleLabel(role)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500" htmlFor="filter-round">
              Vòng review
            </label>
            <select
              id="filter-round"
              name="review_round"
              defaultValue={filters.reviewRound ?? ""}
              className={SELECT_CLASS}
            >
              <option value="">Tất cả vòng</option>
              {REVIEW_OVERSIGHT_ROUNDS.map((round) => (
                <option key={round} value={round}>
                  {roundLabel(round)}
                </option>
              ))}
            </select>
          </div>

          {canOversee ? (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500" htmlFor="filter-reviewer">
                Reviewer / Interviewer
              </label>
              <select
                id="filter-reviewer"
                name="reviewer"
                defaultValue={filters.reviewerId ?? ""}
                className={SELECT_CLASS}
              >
                <option value="">Tất cả reviewer</option>
                {reviewerOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500" htmlFor="filter-status">
              Trạng thái review
            </label>
            <select
              id="filter-status"
              name="review_status"
              defaultValue={filters.reviewStatus ?? ""}
              className={SELECT_CLASS}
            >
              <option value="">Tất cả trạng thái</option>
              {REVIEW_OVERSIGHT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {reviewStatusLabel(status)}
                </option>
              ))}
            </select>
          </div>

          {canOversee ? (
            <label className="flex items-center gap-2 pb-1.5 text-sm text-slate-600">
              <input
                type="checkbox"
                name="scope"
                value="all"
                defaultChecked={filters.scopeMode === "all"}
                data-testid="history-toggle"
              />
              Hiện cả lịch sử
            </label>
          ) : null}

          <button
            type="submit"
            className="rounded-md bg-vam-green px-4 py-1.5 text-sm font-medium text-white hover:bg-vam-green/90"
          >
            Lọc
          </button>
          <Link href="/reviews" className="pb-1.5 text-xs text-slate-400 underline hover:text-slate-600">
            Xóa bộ lọc
          </Link>
        </form>

        {historyMode ? (
          <p
            data-testid="history-notice"
            className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600"
          >
            Đang hiển thị cả lịch sử: phân công đã huỷ và hồ sơ đã kết thúc quy trình đều xuất hiện
            và chỉ để xem lại.
          </p>
        ) : null}
      </Card>

      {/* Filtered total — the FULL population, not this page. */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span
          data-testid="oversight-total"
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-600"
        >
          Tổng theo bộ lọc: <strong>{queue.totalCount}</strong>
        </span>
        {queue.totalCount > 0 ? (
          <span className="text-xs text-slate-500">
            Đang xem {firstRowNumber}–{lastRowNumber} · Trang {queue.page}/{Math.max(queue.totalPages, 1)}
          </span>
        ) : null}
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState message="Không có review nào khớp bộ lọc hiện tại." />
        ) : (
          <div className="overflow-hidden rounded-lg border border-vam-line bg-white">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-vam-line text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Ứng viên</th>
                    <th className="px-4 py-3">Reviewer / Interviewer</th>
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
                  {rows.map((row: ReviewOversightRow) => {
                    const application = row.application;
                    const parentStatus = application?.status ?? application?.final_status ?? null;
                    const actionability = reviewOversightActionability({
                      reviewStatus: row.status,
                      parentStatus: application?.status ?? null
                    });
                    const overdue = actionability.actionable && isOverdue(row.due_at, row.status);
                    const dueSoon =
                      actionability.actionable && !overdue && isDueSoon(row.due_at, row.status);
                    const applicantName =
                      application?.full_name ?? application?.person_id ?? row.application_id;

                    return (
                      <tr
                        key={row.id}
                        className={`hover:bg-vam-mint/40 ${overdue ? "bg-red-50/60" : ""}`}
                      >
                        <td className="px-4 py-3 font-medium text-vam-ink">
                          <Link
                            href={
                              reviewerOnly ? `/reviews/${row.id}` : `/applications/${row.application_id}`
                            }
                            className="hover:text-vam-green hover:underline"
                          >
                            {displayText(applicantName)}
                          </Link>
                          {actionability.readOnlyReason === "terminal_parent" ? (
                            <span className="mt-1 block text-[11px] font-normal text-slate-500">
                              Hồ sơ đã kết thúc quy trình ({displayText(parentStatus)})
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-slate-700" data-testid="reviewer-cell">
                          {reviewerIdentityLabel(
                            row.reviewer_admin_user_id,
                            row.reviewer?.full_name,
                            row.reviewer?.email
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-700">{roundLabel(row.review_round)}</td>
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
                        <td className="px-4 py-3 text-slate-700">{displayText(row.recommendation)}</td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/reviews/${row.id}`}
                            className="inline-flex rounded-md border border-vam-line px-2.5 py-1 text-xs font-medium text-vam-green hover:bg-vam-mint"
                          >
                            {actionability.actionable ? "Làm review" : "Xem"}
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

        {queue.totalPages > 1 ? (
          <nav
            aria-label="Phân trang"
            data-testid="oversight-pagination"
            className="mt-4 flex items-center justify-between gap-3 text-sm"
          >
            {queue.page > 1 ? (
              <Link
                href={buildReviewOversightHref("/reviews", filters, { page: queue.page - 1 })}
                className="rounded-md border border-vam-line px-3 py-1.5 font-medium text-vam-green hover:bg-vam-mint"
              >
                ← Trang trước
              </Link>
            ) : (
              <span />
            )}
            <span className="text-xs text-slate-500">
              Trang {queue.page}/{queue.totalPages}
            </span>
            {queue.page < queue.totalPages ? (
              <Link
                href={buildReviewOversightHref("/reviews", filters, { page: queue.page + 1 })}
                className="rounded-md border border-vam-line px-3 py-1.5 font-medium text-vam-green hover:bg-vam-mint"
              >
                Trang sau →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </Card>
    </>
  );
}
