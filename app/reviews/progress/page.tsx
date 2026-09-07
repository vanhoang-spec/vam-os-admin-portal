import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getIntakeBatches, getReviewAssignmentProgress, getSeasons } from "@/lib/data";
import { canAssignReview } from "@/lib/permissions";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { formatDate } from "@/lib/utils";
import { Card, ErrorBox, PageHeader } from "@/components/ui";

// ---------------------------------------------------------------------------
// Page: /reviews/progress
// ---------------------------------------------------------------------------

const ROUND_OPTIONS = [
  { value: "profile_screening", label: "Hồ sơ (Profile Screening)" },
  { value: "interview", label: "Phỏng vấn (Interview)" }
];

function pct(n: number, total: number) {
  if (!total) return "—";
  return `${Math.round((n / total) * 100)}%`;
}

export default async function ReviewProgressPage(
  props: {
    searchParams: Promise<{ intake_batch_id?: string; review_round?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const adminUser = await getCurrentAdminUser();
  if (!adminUser?.id) redirect("/login");
  if (!canAssignReview(adminUser.role)) redirect("/reviews");

  const intakeBatchId = searchParams.intake_batch_id?.trim() || null;
  const reviewRound = searchParams.review_round?.trim() || "profile_screening";
  const scopeContext = await getAdminScopeContext();
  const scope = await getScopeFilter(scopeContext);

  const [intakeBatches, seasons, progressResult] = await Promise.all([
    getIntakeBatches(scope),
    getSeasons(scope),
    getReviewAssignmentProgress({ intakeBatchId, reviewRound, scope })
  ]);

  const rows = progressResult.data;

  // Totals row
  const totals = rows.reduce(
    (acc, r) => ({
      assigned_count: acc.assigned_count + r.assigned_count,
      submitted_count: acc.submitted_count + r.submitted_count,
      in_progress_count: acc.in_progress_count + r.in_progress_count,
      pending_count: acc.pending_count + r.pending_count,
      cancelled_count: acc.cancelled_count + r.cancelled_count
    }),
    { assigned_count: 0, submitted_count: 0, in_progress_count: 0, pending_count: 0, cancelled_count: 0 }
  );

  const batchName =
    intakeBatches.data.find((b) => b.id === intakeBatchId)?.name ??
    intakeBatches.data.find((b) => b.id === intakeBatchId)?.code ??
    null;

  return (
    <>
      <PageHeader
        title="Tiến độ review"
        description="Xem mức độ hoàn thành review theo từng reviewer."
      />

      <div className="mb-4 flex items-center gap-4">
        <Link href="/reviews/assign-bulk" className="text-sm text-vam-green hover:underline">
          → Chia hồ sơ mới
        </Link>
        <Link href="/reviews" className="text-sm text-slate-500 hover:underline">
          ← Danh sách reviews
        </Link>
      </div>

      <ErrorBox message={intakeBatches.error || progressResult.error} />

      {/* Filter bar */}
      <Card className="mb-6">
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">Đợt tuyển</label>
            <select
              name="intake_batch_id"
              defaultValue={intakeBatchId ?? ""}
              className="rounded-md border border-vam-line px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-vam-green"
            >
              <option value="">Tất cả đợt</option>
              {intakeBatches.data.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name ?? b.code ?? b.id}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">Vòng review</label>
            <select
              name="review_round"
              defaultValue={reviewRound}
              className="rounded-md border border-vam-line px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-vam-green"
            >
              {ROUND_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
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
        {(intakeBatchId || reviewRound !== "profile_screening") && (
          <div className="mt-3 flex flex-wrap gap-2">
            {batchName && (
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs text-slate-600">
                Đợt: {batchName}
              </span>
            )}
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs text-slate-600">
              Vòng: {ROUND_OPTIONS.find((o) => o.value === reviewRound)?.label ?? reviewRound}
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

      {/* Summary cards */}
      {rows.length > 0 && (
        <div className="mb-6 grid gap-4 sm:grid-cols-4">
          <div className="rounded-lg border border-vam-line bg-white p-4 shadow-soft">
            <p className="text-xs text-slate-500">Tổng giao</p>
            <p className="mt-1 text-2xl font-semibold text-vam-ink">{totals.assigned_count}</p>
          </div>
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 shadow-soft">
            <p className="text-xs text-green-600">Đã nộp</p>
            <p className="mt-1 text-2xl font-semibold text-green-700">
              {totals.submitted_count}{" "}
              <span className="text-sm font-normal text-green-500">
                ({pct(totals.submitted_count, totals.assigned_count)})
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
        {rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-vam-line px-4 py-10 text-center text-sm text-slate-400">
            {progressResult.error
              ? "Không thể tải dữ liệu tiến độ."
              : "Chưa có review nào được giao trong bộ lọc này."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-vam-line text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Reviewer</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3 text-right">Tổng giao</th>
                  <th className="px-4 py-3 text-right">Đã nộp</th>
                  <th className="px-4 py-3 text-right">Đang làm</th>
                  <th className="px-4 py-3 text-right">Chưa bắt đầu</th>
                  <th className="px-4 py-3 text-right">Đã huỷ</th>
                  <th className="px-4 py-3 text-right">Hoàn thành</th>
                  <th className="px-4 py-3">Nộp gần nhất</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-vam-line">
                {rows.map((row, idx) => (
                  <tr key={row.reviewer_admin_user_id ?? `__unassigned__${idx}`} className="hover:bg-vam-mint/40">
                    <td className="px-4 py-3 font-medium text-vam-ink">
                      {row.reviewer_name ?? <span className="text-slate-400">(Chưa gán)</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{row.reviewer_email ?? "—"}</td>
                    <td className="px-4 py-3 text-right">{row.assigned_count}</td>
                    <td className="px-4 py-3 text-right font-semibold text-green-700">
                      {row.submitted_count}
                    </td>
                    <td className="px-4 py-3 text-right text-amber-600">{row.in_progress_count}</td>
                    <td className="px-4 py-3 text-right text-slate-500">{row.pending_count}</td>
                    <td className="px-4 py-3 text-right text-slate-400">{row.cancelled_count}</td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={
                          row.submitted_count === row.assigned_count && row.assigned_count > 0
                            ? "font-semibold text-green-700"
                            : "text-slate-600"
                        }
                      >
                        {pct(row.submitted_count, row.assigned_count)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                      {row.latest_submitted_at ? formatDate(row.latest_submitted_at) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* Totals footer */}
              <tfoot className="bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <td className="px-4 py-3" colSpan={2}>Tổng cộng</td>
                  <td className="px-4 py-3 text-right">{totals.assigned_count}</td>
                  <td className="px-4 py-3 text-right text-green-700">{totals.submitted_count}</td>
                  <td className="px-4 py-3 text-right text-amber-600">{totals.in_progress_count}</td>
                  <td className="px-4 py-3 text-right">{totals.pending_count}</td>
                  <td className="px-4 py-3 text-right">{totals.cancelled_count}</td>
                  <td className="px-4 py-3 text-right">
                    {pct(totals.submitted_count, totals.assigned_count)}
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
