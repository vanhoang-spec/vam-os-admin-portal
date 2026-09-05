import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, EmptyState, ErrorBox, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getIntakeBatches } from "@/lib/data";
import { getManualMatchingCandidates, getMatchList } from "@/lib/matches";
import { canBrowseOperations, canManageMatches } from "@/lib/permissions";
import { canOperateAnyScope, getAdminScopeContext } from "@/lib/program-scope";
import { resolveSeasonContext, SeasonAccessDeniedError } from "@/lib/season-context";
import { seasonLabel } from "@/lib/season-labels";
import { matchStatusLabel } from "@/lib/ui-labels";
import { displayText, formatDate } from "@/lib/utils";
import { ManualMatchForm, MatchCancelForm } from "./matches-client";

function selectedParam(v: string | string[] | undefined) {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function StatusBadge({ status }: { status: string | null }) {
  const s = String(status ?? "").toLowerCase();
  if (s === "active")
    return <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700">{matchStatusLabel(s)}</span>;
  if (s === "dropped")
    return <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-600">{matchStatusLabel(s)}</span>;
  if (s === "completed")
    return <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700">{matchStatusLabel(s)}</span>;
  if (s === "unmatched_review")
    return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">{matchStatusLabel(s)}</span>;
  return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">{matchStatusLabel(s)}</span>;
}

export default async function MatchesPage(props: { searchParams?: Promise<{
    batch?: string | string[];
    status?: string | string[];
    season?: string | string[];
  }> }) {
  const searchParams = await props.searchParams;

  // H2 fix: role gate before any scope check or protected match data load.
  // getAdminScopeContext/resolveSeasonContext are *scope* checks (true for
  // any granted scope level, including "review") and must never be the only
  // gate on this route, or a reviewer with a season review grant can reach
  // the match list by direct URL — as the previous `viewerSafe = role ===
  // "viewer"` denylist allowed, since it treated reviewer as more privileged
  // than viewer and handed it the unredacted mentor/mentee projection.
  const adminUser = await getCurrentAdminUser();
  if (!adminUser) redirect("/login");
  if (!canBrowseOperations(adminUser.role)) {
    return (
      <PageHeader
        title="Không có quyền truy cập"
        description="Bạn không có quyền truy cập trang matching này."
      />
    );
  }

  const [scopeContext, seasonContext] = await Promise.all([
    getAdminScopeContext(),
    resolveSeasonContext(searchParams?.season).catch((error: unknown) => {
      if (error instanceof SeasonAccessDeniedError) return null;
      throw error;
    })
  ]);
  if (!seasonContext) {
    return (
      <PageHeader
        title="Không có quyền truy cập"
        description="Bạn chưa được cấp phạm vi truy cập cho mùa vận hành hiện tại. Liên hệ quản trị viên để được cấp quyền."
      />
    );
  }
  const scope = seasonContext.effectiveScope;
  const intakeBatchesRes = await getIntakeBatches(scope);
  const matchAudienceRole = adminUser.role;
  const viewerSafe = !canBrowseOperations(matchAudienceRole);
  const allowManage = canManageMatches(adminUser.role) && canOperateAnyScope(scopeContext);

  const batchFilter = selectedParam(searchParams?.batch).trim();
  const rawStatus = selectedParam(searchParams?.status).trim();
  const statusFilter = rawStatus || "active"; // default to showing active matches

  // Always load matches (filtered by batch/status if provided)
  const matchListRes = await getMatchList({
    intakeBatchId: batchFilter || null,
    status: statusFilter !== "all" ? statusFilter : null,
    scope,
    audienceRole: matchAudienceRole
  });

  // Load candidates only when a batch is selected
  const candidatesRes =
    batchFilter && allowManage
      ? await getManualMatchingCandidates(batchFilter, scope)
      : null;

  const batches = intakeBatchesRes.data ?? [];
  const selectedBatch = batches.find((b) => b.id === batchFilter) ?? null;

  return (
    <>
      <PageHeader
        title="Matching Mentor – Mentee"
        description={`Tạo và quản lý ghép cặp thủ công trong ${seasonLabel(seasonContext.selectedSeasonCode)}.`}
      />
      {matchListRes.error ? <ErrorBox message={matchListRes.error} /> : null}
      {intakeBatchesRes.error ? <ErrorBox message={intakeBatchesRes.error} /> : null}

      {/* ── Filter bar ── */}
      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3">
          <label className="block min-w-[200px] flex-1">
            <span className="text-xs font-medium uppercase text-slate-500">Đợt tuyển</span>
            <select
              name="batch"
              defaultValue={batchFilter}
              className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
            >
              <option value="">-- Tất cả đợt --</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>{b.code ?? b.name ?? b.id}</option>
              ))}
            </select>
          </label>

          <label className="block min-w-[160px] flex-1">
            <span className="text-xs font-medium uppercase text-slate-500">Trạng thái</span>
            <select
              name="status"
              defaultValue={rawStatus}
              className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="active">{matchStatusLabel("active")}</option>
              <option value="dropped">{matchStatusLabel("dropped")}</option>
              <option value="completed">{matchStatusLabel("completed")}</option>
              <option value="unmatched_review">{matchStatusLabel("unmatched_review")}</option>
            </select>
          </label>

          <div className="flex gap-2">
            <button
              type="submit"
              className="inline-flex rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-green/90"
            >
              Lọc
            </button>
            <Link
              href="/matches"
              className="inline-flex items-center justify-center rounded-md border border-vam-line bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Xoá lọc
            </Link>
          </div>
        </form>
      </Card>

      <div className="flex flex-col gap-4">
        {/* ── Left: manual create (only when batch selected + allowed) ── */}
        <div className="flex flex-col gap-4">
          {allowManage && batchFilter && candidatesRes ? (
            <Card>
              <h2 className="mb-1 text-base font-semibold text-vam-ink">Tạo matching thủ công</h2>
              <p className="mb-3 text-xs text-slate-500">
                Batch: <strong>{selectedBatch?.code ?? batchFilter}</strong> ·{" "}
                {candidatesRes.mentors.length} mentor · {candidatesRes.mentees.length} mentee
              </p>
              {candidatesRes.error ? (
                <ErrorBox message={candidatesRes.error} />
              ) : candidatesRes.mentors.length === 0 && candidatesRes.mentees.length === 0 ? (
                <EmptyState message="Chưa có mentor hoặc mentee nào trong batch này. Hoàn tất quy trình xét duyệt trước khi matching." />
              ) : (
                <ManualMatchForm
                  intakeBatchId={batchFilter}
                  mentors={candidatesRes.mentors}
                  mentees={candidatesRes.mentees}
                />
              )}
            </Card>
          ) : allowManage ? (
            <Card>
              <h2 className="mb-1 text-base font-semibold text-slate-400">Tạo matching thủ công</h2>
              <p className="text-sm text-slate-400">
                Chọn một đợt tuyển ở bộ lọc để bắt đầu tạo match.
              </p>
            </Card>
          ) : (
            <Card>
              <h2 className="mb-1 text-base font-semibold text-slate-400">Tạo matching thủ công</h2>
              <p className="text-sm text-slate-500">
                Chỉ admin hoặc core team được tạo match.
              </p>
            </Card>
          )}

          {/* Capacity summary for selected batch */}
          {candidatesRes && candidatesRes.mentors.length > 0 ? (
            <Card>
              <h2 className="mb-3 text-base font-semibold text-vam-ink">Tải mentor trong batch</h2>
              <div className="space-y-1.5">
                {candidatesRes.mentors.map((m) => {
                  const count = m.active_match_count;
                  // Each mentor's bar is scaled to their OWN declared capacity,
                  // the same number the mutation enforces — not to a fixed 3.
                  const capacity = m.effective_capacity;
                  const isFull = count >= capacity;
                  const pct = Math.min(100, Math.round((count / capacity) * 100));
                  return (
                    <div key={m.profile_id} className="flex items-center gap-2 text-xs">
                      <div className="w-32 truncate font-medium text-vam-ink" title={m.full_name ?? ""}>
                        {m.full_name ?? m.email_primary ?? "—"}
                      </div>
                      <div className="flex-1 overflow-hidden rounded-full bg-slate-100" style={{ height: 6 }}>
                        <div
                          className={`h-full rounded-full ${isFull ? "bg-red-400" : count > 0 ? "bg-amber-400" : "bg-green-400"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className={`w-12 text-right font-semibold ${isFull ? "text-red-600" : count > 0 ? "text-amber-600" : "text-green-600"}`}>
                        {count}/{capacity}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          ) : null}
        </div>

        {/* ── Right: matches table ── */}
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">
            Danh sách matching{" "}
            <span className="text-sm font-normal text-slate-500">
              ({matchListRes.data.length} {statusFilter !== "all" ? matchStatusLabel(statusFilter) : "tổng cộng"})
            </span>
          </h2>

          {matchListRes.data.length === 0 ? (
            <EmptyState message="Chưa có match nào phù hợp với bộ lọc." />
          ) : (
            <div className="overflow-hidden rounded-lg border border-vam-line bg-white">
              <div className="overflow-x-auto">
                <table className="min-w-full table-fixed divide-y divide-vam-line text-sm">
                  <colgroup>
                    <col className="w-[24%]" />
                    <col className="w-[24%]" />
                    <col className="w-[15%]" />
                    <col className="w-[14%]" />
                    <col className="w-[13%]" />
                    <col className="w-[10%]" />
                  </colgroup>
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                    <tr>
                      <th className="w-[24%] px-4 py-3">Mentor</th>
                      <th className="w-[24%] px-4 py-3">Mentee</th>
                      <th className="px-4 py-3">Đợt / Nguồn</th>
                      <th className="px-4 py-3">Trạng thái</th>
                      <th className="px-4 py-3">Thời điểm</th>
                      <th className="px-4 py-3">Hành động</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-vam-line">
                    {matchListRes.data.map((row) => (
                      <tr key={row.id} className="hover:bg-vam-mint/30">
                        <td className="px-4 py-3 align-top">
                          <div className="break-words font-medium leading-5 text-vam-ink">
                            {viewerSafe ? "Ẩn với Viewer" : displayText(row.mentor_name)}
                          </div>
                          {!viewerSafe ? <div className="mt-0.5 break-all text-xs leading-4 text-slate-500">{displayText(row.mentor_email)}</div> : null}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="break-words font-medium leading-5 text-vam-ink">
                            {viewerSafe ? "Ẩn với Viewer" : displayText(row.mentee_name)}
                          </div>
                          {!viewerSafe ? <div className="mt-0.5 break-all text-xs leading-4 text-slate-500">{displayText(row.mentee_email)}</div> : null}
                        </td>
                        <td className="px-4 py-3 align-top text-xs text-slate-600">
                          <div>{row.batch_code ?? row.match_type ?? "—"}</div>
                          <div className="text-slate-400">
                            {row.match_source ?? row.match_source_raw ?? "—"}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <StatusBadge status={row.status ?? null} />
                          {row.end_reason ? (
                            <div className="mt-1 text-[11px] text-slate-500">{row.end_reason}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 align-top text-xs text-slate-500">
                          <div>{formatDate(row.matched_at) || formatDate(row.starts_at as string | null | undefined)}</div>
                          {row.ended_at ? (
                            <div className="text-red-500">Kết thúc: {formatDate(row.ended_at)}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="flex flex-col gap-2 2xl:flex-row 2xl:flex-wrap">
                            {!viewerSafe ? (
                              <Link
                                href={`/matches/${row.id}`}
                                className="inline-flex rounded border border-vam-line px-2.5 py-1 text-xs font-medium text-vam-green hover:bg-vam-mint"
                              >
                                Chi tiết
                              </Link>
                            ) : null}
                            {allowManage && row.status === "active" ? (
                              <MatchCancelForm matchId={row.id} />
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
