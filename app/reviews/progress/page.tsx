import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import {
  getIntakeBatches,
  getReviewOversightAggregate,
  getSeasons,
  type ReviewOversightActor,
  type ReviewOversightReviewerStats
} from "@/lib/data";
import { canAssignReview } from "@/lib/permissions";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import {
  BUCKET_DRILLDOWN_STATUS,
  buildReviewOversightHref,
  parseReviewOversightFilters,
  REVIEW_OVERSIGHT_ROLES,
  REVIEW_OVERSIGHT_ROUNDS,
  reviewerIdentityLabel,
  type ReviewOversightFilters,
  type ReviewOversightSearchParams
} from "@/lib/review-oversight";
import { formatDate } from "@/lib/utils";
import { Card, ErrorBox, PageHeader } from "@/components/ui";

// ---------------------------------------------------------------------------
// Page: /reviews/progress
// ---------------------------------------------------------------------------

const ROUND_LABEL: Record<string, string> = {
  profile_screening: "Hồ sơ (Profile Screening)",
  interview: "Phỏng vấn (Interview)"
};

const ROLE_LABEL: Record<string, string> = {
  mentee: "Mentee",
  mentor: "Mentor"
};

const SELECT_CLASS =
  "rounded-md border border-vam-line px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-vam-green";

function pct(n: number, total: number) {
  if (!total) return "—";
  return `${Math.round((n / total) * 100)}%`;
}

/**
 * A count cell that navigates to the list showing exactly the rows it counted.
 *
 * The href is built from the ACTIVE filter object plus explicit overrides, so
 * every filter — season, intake batch, role, round — travels with the click.
 * Building links from whatever the page happened to hold in a local variable is
 * how `intake_batch_id` was dropped before.
 */
function CountCell({
  value,
  href,
  className,
  testId
}: {
  value: number;
  href: string;
  className?: string;
  testId: string;
}) {
  return (
    <td className={`px-4 py-3 text-right ${className ?? ""}`}>
      <Link href={href} data-testid={testId} className="hover:underline">
        {value}
      </Link>
    </td>
  );
}

export default async function ReviewProgressPage(props: {
  searchParams?: Promise<ReviewOversightSearchParams>;
}) {
  const searchParams = (await props.searchParams) ?? {};

  const adminUser = await getCurrentAdminUser();
  if (!adminUser?.id) redirect("/login");
  if (!canAssignReview(adminUser.role)) redirect("/reviews");

  // Progress keeps its existing single-round default so the screen operators
  // already read does not change meaning.
  const filters = parseReviewOversightFilters(searchParams, {
    defaultReviewRound: "profile_screening"
  });
  const actor: ReviewOversightActor = { kind: "oversight", adminUserId: adminUser.id };

  const scopeContext = await getAdminScopeContext();
  if (scopeContext.scopeError) {
    return (
      <>
        <PageHeader title="Tiến độ review" description="Không thể xác minh phạm vi dữ liệu." />
        <ErrorBox message={scopeContext.scopeError} />
      </>
    );
  }
  const scope = await getScopeFilter(scopeContext);

  const [intakeBatches, seasons, aggregateResult] = await Promise.all([
    getIntakeBatches(scope),
    getSeasons(scope),
    getReviewOversightAggregate({ filters, actor, scope })
  ]);

  const rows = aggregateResult.data;

  const totals = rows.reduce(
    (acc, row) => ({
      current_total: acc.current_total + row.current_total,
      submitted_count: acc.submitted_count + row.submitted_count,
      in_progress_count: acc.in_progress_count + row.in_progress_count,
      pending_count: acc.pending_count + row.pending_count,
      returned_count: acc.returned_count + row.returned_count,
      cancelled_count: acc.cancelled_count + row.cancelled_count
    }),
    {
      current_total: 0,
      submitted_count: 0,
      in_progress_count: 0,
      pending_count: 0,
      returned_count: 0,
      cancelled_count: 0
    }
  );

  const selectedBatch = intakeBatches.data.find((batch) => batch.id === filters.intakeBatchId);
  const batchName = selectedBatch?.name ?? selectedBatch?.code ?? null;
  const selectedSeason = seasons.data.find((season) => season.id === filters.seasonId);
  const seasonName = selectedSeason?.name ?? selectedSeason?.code ?? null;

  /** The filter context every drill-down inherits. */
  const drilldownBase: Partial<ReviewOversightFilters> = { page: 1 };

  const hasActiveFilter =
    Boolean(filters.seasonId) ||
    Boolean(filters.intakeBatchId) ||
    Boolean(filters.roleApplied) ||
    filters.reviewRound !== "profile_screening";

  return (
    <>
      <PageHeader
        title="Tiến độ review"
        description="Xem khối lượng công việc hiện tại và mức độ hoàn thành theo từng reviewer/interviewer."
      />

      <div className="mb-4 flex items-center gap-4">
        <Link href="/reviews/assign-bulk" className="text-sm text-vam-green hover:underline">
          → Chia hồ sơ mới
        </Link>
        <Link
          href={buildReviewOversightHref("/reviews", filters, drilldownBase)}
          className="text-sm text-slate-500 hover:underline"
        >
          ← Danh sách reviews
        </Link>
      </div>

      <ErrorBox message={intakeBatches.error || seasons.error || aggregateResult.error} />

      {/* Filter bar */}
      <Card className="mb-6">
        <form method="GET" className="flex flex-wrap items-end gap-3" data-testid="progress-filters">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500" htmlFor="progress-season">
              Mùa
            </label>
            <select
              id="progress-season"
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

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500" htmlFor="progress-batch">
              Đợt tuyển
            </label>
            <select
              id="progress-batch"
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
            <label className="text-xs font-medium text-slate-500" htmlFor="progress-role">
              Vai trò ứng tuyển
            </label>
            <select
              id="progress-role"
              name="role_applied"
              defaultValue={filters.roleApplied ?? ""}
              className={SELECT_CLASS}
            >
              <option value="">Tất cả vai trò</option>
              {REVIEW_OVERSIGHT_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role] ?? role}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500" htmlFor="progress-round">
              Vòng review
            </label>
            <select
              id="progress-round"
              name="review_round"
              defaultValue={filters.reviewRound ?? "profile_screening"}
              className={SELECT_CLASS}
            >
              {REVIEW_OVERSIGHT_ROUNDS.map((round) => (
                <option key={round} value={round}>
                  {ROUND_LABEL[round] ?? round}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            className="rounded-md bg-vam-green px-4 py-1.5 text-sm font-medium text-white hover:bg-vam-green/90"
          >
            Lọc
          </button>
        </form>

        {/* Active filter pills */}
        {hasActiveFilter && (
          <div className="mt-3 flex flex-wrap gap-2">
            {seasonName && (
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs text-slate-600">
                Mùa: {seasonName}
              </span>
            )}
            {batchName && (
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs text-slate-600">
                Đợt: {batchName}
              </span>
            )}
            {filters.roleApplied && (
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs text-slate-600">
                Vai trò: {ROLE_LABEL[filters.roleApplied] ?? filters.roleApplied}
              </span>
            )}
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs text-slate-600">
              Vòng: {ROUND_LABEL[filters.reviewRound ?? ""] ?? filters.reviewRound}
            </span>
            <Link
              href="/reviews/progress"
              className="text-xs text-slate-400 underline hover:text-slate-600"
            >
              Xóa bộ lọc
            </Link>
          </div>
        )}
      </Card>

      {/* Summary cards — current workload never includes cancelled. */}
      {rows.length > 0 && (
        <div className="mb-6 grid gap-4 sm:grid-cols-4">
          <div className="rounded-lg border border-vam-line bg-white p-4 shadow-soft">
            <p className="text-xs text-slate-500">Đang phụ trách</p>
            <p className="mt-1 text-2xl font-semibold text-vam-ink" data-testid="totals-current">
              {totals.current_total}
            </p>
          </div>
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 shadow-soft">
            <p className="text-xs text-green-600">Đã nộp</p>
            <p className="mt-1 text-2xl font-semibold text-green-700">
              {totals.submitted_count}{" "}
              <span className="text-sm font-normal text-green-500">
                ({pct(totals.submitted_count, totals.current_total)})
              </span>
            </p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-soft">
            <p className="text-xs text-amber-600">Đang làm</p>
            <p className="mt-1 text-2xl font-semibold text-amber-700">{totals.in_progress_count}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-soft">
            <p className="text-xs text-slate-500">Chưa bắt đầu</p>
            <p className="mt-1 text-2xl font-semibold text-slate-700">{totals.pending_count}</p>
          </div>
        </div>
      )}

      {/* Per-reviewer progress table */}
      <Card>
        <p className="mb-3 text-xs text-slate-500">
          &ldquo;Đang phụ trách&rdquo; là khối lượng hiện tại: hồ sơ còn trong quy trình tuyển và
          phân công chưa bị huỷ. Phân công đã huỷ được đếm riêng ở cột &ldquo;Đã huỷ&rdquo;. Bấm vào
          một con số để mở đúng danh sách tương ứng.
        </p>
        {rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-vam-line px-4 py-10 text-center text-sm text-slate-400">
            {aggregateResult.error
              ? "Không thể tải dữ liệu tiến độ."
              : "Chưa có review nào được giao trong bộ lọc này."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-vam-line text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Reviewer / Interviewer</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3 text-right">Đang phụ trách</th>
                  <th className="px-4 py-3 text-right">Đã nộp</th>
                  <th className="px-4 py-3 text-right">Đang làm</th>
                  <th className="px-4 py-3 text-right">Chưa bắt đầu</th>
                  <th className="px-4 py-3 text-right">Cần làm rõ</th>
                  <th className="px-4 py-3 text-right">Đã huỷ</th>
                  <th className="px-4 py-3 text-right">Hoàn thành</th>
                  <th className="px-4 py-3">Nộp gần nhất</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-vam-line">
                {rows.map((row: ReviewOversightReviewerStats, idx: number) => {
                  const reviewerId = row.reviewer_admin_user_id;
                  const label = reviewerIdentityLabel(
                    reviewerId,
                    row.reviewer_full_name,
                    row.reviewer_email
                  );
                  const key = reviewerId ?? `__unassigned__${idx}`;
                  const operationalHref = (reviewStatus: string | null) =>
                    buildReviewOversightHref("/reviews", filters, {
                      ...drilldownBase,
                      reviewerId,
                      reviewStatus,
                      scopeMode: "operational"
                    });
                  const cancelledHref = buildReviewOversightHref("/reviews", filters, {
                    ...drilldownBase,
                    reviewerId,
                    reviewStatus: BUCKET_DRILLDOWN_STATUS.cancelled,
                    scopeMode: "all"
                  });

                  return (
                    <tr key={key} className="hover:bg-vam-mint/40">
                      <td className="px-4 py-3 font-medium text-vam-ink">
                        {reviewerId ? (
                          <Link
                            href={operationalHref(null)}
                            data-testid="progress-reviewer-link"
                            className="hover:text-vam-green hover:underline"
                          >
                            {label}
                          </Link>
                        ) : (
                          <span className="text-slate-400">{label}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{row.reviewer_email ?? "—"}</td>
                      <CountCell
                        testId="progress-current-total"
                        value={row.current_total}
                        href={operationalHref(null)}
                      />
                      <CountCell
                        testId="progress-submitted"
                        value={row.submitted_count}
                        href={operationalHref(BUCKET_DRILLDOWN_STATUS.submitted)}
                        className="font-semibold text-green-700"
                      />
                      <CountCell
                        testId="progress-in-progress"
                        value={row.in_progress_count}
                        href={operationalHref(BUCKET_DRILLDOWN_STATUS.in_progress)}
                        className="text-amber-600"
                      />
                      <CountCell
                        testId="progress-pending"
                        value={row.pending_count}
                        href={operationalHref(BUCKET_DRILLDOWN_STATUS.pending)}
                        className="text-slate-500"
                      />
                      <CountCell
                        testId="progress-returned"
                        value={row.returned_count}
                        href={operationalHref(BUCKET_DRILLDOWN_STATUS.returned)}
                        className="text-orange-600"
                      />
                      <CountCell
                        testId="progress-cancelled"
                        value={row.cancelled_count}
                        href={cancelledHref}
                        className="text-slate-400"
                      />
                      <td className="px-4 py-3 text-right">
                        <span
                          className={
                            row.submitted_count === row.current_total && row.current_total > 0
                              ? "font-semibold text-green-700"
                              : "text-slate-600"
                          }
                        >
                          {pct(row.submitted_count, row.current_total)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                        {row.latest_submitted_at ? formatDate(row.latest_submitted_at) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {/* Totals footer */}
              <tfoot className="bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <td className="px-4 py-3" colSpan={2}>
                    Tổng cộng
                  </td>
                  <td className="px-4 py-3 text-right">{totals.current_total}</td>
                  <td className="px-4 py-3 text-right text-green-700">{totals.submitted_count}</td>
                  <td className="px-4 py-3 text-right text-amber-600">{totals.in_progress_count}</td>
                  <td className="px-4 py-3 text-right">{totals.pending_count}</td>
                  <td className="px-4 py-3 text-right text-orange-600">{totals.returned_count}</td>
                  <td className="px-4 py-3 text-right text-slate-400">{totals.cancelled_count}</td>
                  <td className="px-4 py-3 text-right">
                    {pct(totals.submitted_count, totals.current_total)}
                  </td>
                  <td className="px-4 py-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
