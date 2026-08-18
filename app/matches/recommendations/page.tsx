import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, ErrorBox, KpiCard, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getIntakeBatches, getSeasons } from "@/lib/data";
import { canManageMatches } from "@/lib/permissions";
import { canOperateAnyScope, getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { getLatestRecommendationRun } from "@/lib/ai-matching";
import { evaluateAiMatchingGate, type AiMatchingEnv } from "@/lib/ai-matching-core";
import { SEASON_CONFIG } from "@/lib/season-config";
import { RecommendationsClient } from "./recommendations-client";

/**
 * Page: /matches/recommendations
 *
 * The assisted-matching proposal and the decisions taken on it. Every row is a
 * suggestion until an organiser approves it; approving goes through the normal
 * manual-matching path, which re-checks the mentor's capacity.
 */
export const dynamic = "force-dynamic";

/**
 * A run makes several provider calls in one request. The platform default of a
 * few seconds is not enough, so this route asks for the long ceiling.
 */
export const maxDuration = 300;

function param(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function RecommendationsPage({
  searchParams
}: {
  searchParams?: {
    season_id?: string | string[];
    intake_batch_id?: string | string[];
    run?: string | string[];
  };
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
  const runId = param(searchParams?.run).trim();

  const defaultSeason =
    seasons.data.find((season) => season.code === SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE) ??
    seasons.data[0];
  const batchSeasonId = intakeBatchId
    ? batches.data.find((batch) => batch.id === intakeBatchId)?.season_id ?? null
    : null;
  const seasonId = batchSeasonId ?? requestedSeasonId ?? defaultSeason?.id ?? "";
  const resolvedSeasonId = seasonId || defaultSeason?.id || "";
  const season = seasons.data.find((row) => row.id === resolvedSeasonId);

  const view = resolvedSeasonId
    ? await getLatestRecommendationRun({ seasonId: resolvedSeasonId, runId: runId || null })
    : null;

  const gate = evaluateAiMatchingGate(process.env as unknown as AiMatchingEnv);

  const rows = view?.rows ?? [];
  const counts = {
    pending: rows.filter((row) => row.status === "pending").length,
    approved: rows.filter((row) => row.status === "approved").length,
    rejected: rows.filter((row) => row.status === "rejected").length,
    superseded: rows.filter((row) => row.status === "superseded").length
  };

  const batchOptions = batches.data.filter(
    (batch) => !resolvedSeasonId || batch.season_id === resolvedSeasonId
  );

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Đề xuất ghép cặp"
        description="Hệ thống đề xuất các cặp mentor – mentee còn lại dựa trên dữ liệu đã ẩn danh. Không cặp nào được tạo cho đến khi ban tổ chức bấm duyệt."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Link href="/matches" className="text-sm text-vam-green hover:underline">
          ← Quay lại Ghép cặp
        </Link>
        <Link href="/matches/unmatched" className="text-sm text-vam-green hover:underline">
          Danh sách chưa ghép
        </Link>
        <Link href="/mentors/season-confirmations" className="text-sm text-vam-green hover:underline">
          Xác nhận mentor
        </Link>
      </div>

      <ErrorBox message={batches.error || seasons.error || view?.error} />

      {!gate.canRun ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Chưa bật ghép cặp bằng AI: {gate.reason}. Danh sách đề xuất cũ vẫn xem và duyệt được, nhưng
          chưa chạy được lần mới.
        </div>
      ) : null}

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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Chờ duyệt"
          value={counts.pending}
          tone={counts.pending > 0 ? "warning" : "default"}
          helper={`Mùa ${season?.code ?? season?.name ?? "—"}`}
        />
        <KpiCard label="Đã duyệt" value={counts.approved} tone="success" helper="Đã tạo cặp ghép" />
        <KpiCard label="Đã bỏ qua" value={counts.rejected} helper="Ban tổ chức không dùng đề xuất" />
        <KpiCard
          label="Bị thay thế"
          value={counts.superseded}
          helper="Có lần chạy mới hơn"
        />
      </div>

      <RecommendationsClient
        seasonId={resolvedSeasonId}
        intakeBatchId={intakeBatchId || null}
        run={view?.run ?? null}
        rows={rows}
        canOperate={canOperate}
        canRun={gate.canRun}
      />
    </div>
  );
}
