import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, ErrorBox, KpiCard, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getIntakeBatches, getSeasons } from "@/lib/data";
import { canDecide } from "@/lib/permissions";
import { canOperateAnyScope, getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { computeSeasonCapacity, getSelectionRunForBatch, type SelectionRunView } from "@/lib/selection";
import { SelectionClient } from "./selection-client";

/**
 * Page: /reviews/selection
 *
 * Turns finished scores into an interview list. The screen exists to make the
 * cut visible before it happens: how many places the mentors actually
 * confirmed, who is above the line, who is on standby, and what is still
 * unscored. Nothing changes until the organisers press apply.
 */
export const dynamic = "force-dynamic";

function param(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function SelectionPage({
  searchParams
}: {
  searchParams?: { intake_batch_id?: string | string[]; role?: string | string[] };
}) {
  const adminUser = await getCurrentAdminUser();
  if (!adminUser?.id) redirect("/login");
  if (!canDecide(adminUser.role)) redirect("/reviews");

  const scopeContext = await getAdminScopeContext();
  const scope = await getScopeFilter(scopeContext);
  const canOperate = canOperateAnyScope(scopeContext);

  const intakeBatchId = param(searchParams?.intake_batch_id).trim();
  const roleApplied = param(searchParams?.role).trim() || "mentee";

  const [batches, seasons] = await Promise.all([getIntakeBatches(scope), getSeasons(scope)]);

  const selectedBatch = intakeBatchId ? batches.data.find((batch) => batch.id === intakeBatchId) : undefined;
  const seasonId = selectedBatch?.season_id ?? null;

  const [runView, capacityTotal] = await Promise.all([
    intakeBatchId
      ? getSelectionRunForBatch({ intakeBatchId, roleApplied })
      : Promise.resolve<SelectionRunView>({ ok: true, error: null, run: null, items: [], summary: null }),
    seasonId ? computeSeasonCapacity(seasonId) : Promise.resolve(0)
  ]);

  const seasonLabel = seasonId
    ? seasons.data.find((season) => season.id === seasonId)?.code ?? "—"
    : "—";

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Chốt danh sách phỏng vấn"
        description="Xếp hạng hồ sơ đã chấm, cắt theo số suất mentee mà mentor đã xác nhận, kèm nhóm dự phòng. Trạng thái hồ sơ chỉ thay đổi khi bạn bấm áp dụng."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Link href="/reviews" className="text-sm text-vam-green hover:underline">
          ← Quay lại Reviews
        </Link>
        <Link href="/reviews/progress" className="text-sm text-vam-green hover:underline">
          Tiến độ chấm
        </Link>
        <Link href="/mentors/season-confirmations" className="text-sm text-vam-green hover:underline">
          Xác nhận mentor
        </Link>
      </div>

      <ErrorBox message={batches.error || seasons.error || runView.error} />

      <Card>
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">Đợt tuyển</label>
            <select
              name="intake_batch_id"
              defaultValue={intakeBatchId}
              className="rounded-md border border-vam-line px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-vam-green"
            >
              <option value="">-- Chọn đợt tuyển --</option>
              {batches.data.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.code ?? batch.name ?? batch.id}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">Vai trò</label>
            <select
              name="role"
              defaultValue={roleApplied}
              className="rounded-md border border-vam-line px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-vam-green"
            >
              <option value="mentee">Mentee</option>
              <option value="mentor">Mentor</option>
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

      {!intakeBatchId ? (
        <Card>
          <p className="text-sm text-slate-600">
            Chọn một đợt tuyển để xem hoặc tính danh sách phỏng vấn.
          </p>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Số suất mentee"
              value={capacityTotal}
              helper={`Tổng hạn mức mentor đã xác nhận · mùa ${seasonLabel}`}
            />
            <KpiCard
              label="Danh sách chính thức"
              value={runView.run?.main_count ?? 0}
              tone="success"
              helper="Được mời phỏng vấn khi áp dụng"
            />
            <KpiCard
              label="Nhóm dự phòng"
              value={runView.run?.reserve_count ?? 0}
              helper="Đôn lên khi có bạn rút lui"
            />
            <KpiCard
              label="Chưa có điểm"
              value={runView.run?.unscored_count ?? 0}
              tone={runView.run && runView.run.unscored_count > 0 ? "warning" : "default"}
              helper="Phải chấm xong mới chốt được"
            />
          </div>

          <SelectionClient
            intakeBatchId={intakeBatchId}
            roleApplied={roleApplied}
            run={runView.run}
            items={runView.items}
            summary={runView.summary}
            capacityTotal={capacityTotal}
            canOperate={canOperate}
          />
        </>
      )}
    </div>
  );
}
