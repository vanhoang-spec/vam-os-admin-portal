import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, ErrorBox, KpiCard, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getIntakeBatches, getSeasons } from "@/lib/data";
import { canManageMatches } from "@/lib/permissions";
import { canOperateAnyScope, getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { getMatchingGaps } from "@/lib/matching-gaps";
import { SEASON_CONFIG } from "@/lib/season-config";
import { UnmatchedClient } from "./unmatched-client";

/**
 * Page: /matches/unmatched
 *
 * After the mentors have taken the mentees they interviewed, this is what is
 * left: candidates with nobody, mentors with room, and the mentors who asked
 * for one more place by being turned down. It is the working list for the rest
 * of the matching — and the input the assisted matching will read.
 */
export const dynamic = "force-dynamic";

function param(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function UnmatchedPage({
  searchParams
}: {
  searchParams?: { season_id?: string | string[]; intake_batch_id?: string | string[] };
}) {
  const adminUser = await getCurrentAdminUser();
  if (!adminUser?.id) redirect("/login");
  if (!canManageMatches(adminUser.role)) redirect("/matches");

  const scopeContext = await getAdminScopeContext();
  const scope = await getScopeFilter(scopeContext);
  const canOperate = canOperateAnyScope(scopeContext);

  const [batches, seasons] = await Promise.all([getIntakeBatches(scope), getSeasons(scope)]);

  const requestedSeasonId = param(searchParams?.season_id).trim();
  const intakeBatchId = param(searchParams?.intake_batch_id).trim();
  const batchSeasonId = intakeBatchId
    ? batches.data.find((batch) => batch.id === intakeBatchId)?.season_id ?? null
    : null;

  // The batch wins when both are given: the batch's own season is the only one
  // that can possibly hold its applications.
  const defaultSeason =
    seasons.data.find((season) => season.code === SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE) ??
    seasons.data[0];
  const seasonId = batchSeasonId ?? requestedSeasonId ?? defaultSeason?.id ?? "";
  const resolvedSeasonId = seasonId || defaultSeason?.id || "";
  const season = seasons.data.find((row) => row.id === resolvedSeasonId);

  const gaps = resolvedSeasonId
    ? await getMatchingGaps({ seasonId: resolvedSeasonId, intakeBatchId: intakeBatchId || null })
    : null;

  const batchOptions = batches.data.filter(
    (batch) => !resolvedSeasonId || batch.season_id === resolvedSeasonId
  );

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Chưa ghép cặp"
        description="Mentee đã phỏng vấn xong nhưng chưa có mentor, mentor còn suất trống, và các trường hợp mentor xin thêm suất."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Link href="/matches" className="text-sm text-vam-green hover:underline">
          ← Quay lại Ghép cặp
        </Link>
        <Link href="/mentors/season-confirmations" className="text-sm text-vam-green hover:underline">
          Xác nhận mentor
        </Link>
        <Link href="/interviews/schedule" className="text-sm text-vam-green hover:underline">
          Xếp lịch phỏng vấn
        </Link>
      </div>

      <ErrorBox message={batches.error || seasons.error || gaps?.error} />

      <Card>
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">Mùa</label>
            <select
              name="season_id"
              defaultValue={resolvedSeasonId}
              className="rounded-md border border-vam-line px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-vam-green"
            >
              {seasons.data.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.code ?? row.name ?? row.id}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">Đợt tuyển (không bắt buộc)</label>
            <select
              name="intake_batch_id"
              defaultValue={intakeBatchId}
              className="rounded-md border border-vam-line px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-vam-green"
            >
              <option value="">-- Tất cả đợt trong mùa --</option>
              {batchOptions.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.code ?? batch.name ?? batch.id}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded-md bg-vam-green px-4 py-1.5 text-sm font-medium text-white hover:bg-vam-green/90"
          >
            Xem
          </button>
        </form>
      </Card>

      {!gaps ? (
        <Card>
          <p className="text-sm text-slate-600">Chọn một mùa để xem danh sách chưa ghép cặp.</p>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Mentee chờ ghép"
              value={gaps.totals.menteesWaiting}
              tone={gaps.totals.menteesWaiting > 0 ? "warning" : "success"}
              helper={`Mùa ${season?.code ?? season?.name ?? "—"}`}
            />
            <KpiCard label="Suất mentor còn trống" value={gaps.totals.freeSlots} helper="Tổng số chỗ chưa dùng" />
            <KpiCard label="Đã ghép" value={gaps.totals.activeMatches} tone="success" helper="Cặp đang hoạt động" />
            <KpiCard
              label="Xin thêm suất"
              value={gaps.blocked.length}
              tone={gaps.blocked.length > 0 ? "warning" : "default"}
              helper="Mentor bị chặn vì đã đủ hạn mức"
            />
          </div>

          <UnmatchedClient
            mentees={gaps.mentees}
            mentors={gaps.mentors}
            blocked={gaps.blocked}
            canOperate={canOperate}
            seasonLabel={season?.code ?? season?.name ?? ""}
          />
        </>
      )}
    </div>
  );
}
