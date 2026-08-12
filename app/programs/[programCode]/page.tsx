import Link from "next/link";
import { Card, EmptyState, KpiCard, PageHeader, SimpleTable } from "@/components/ui";
import { loadProgramContextCatalog, resolveAuthorizedProgramContext } from "@/lib/program-context";
import { getProgramWorkspaceSummary } from "@/lib/portfolio";
import { formatInt } from "@/lib/utils";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function metric(value: number | null) {
  return value === null ? "Chưa có dữ liệu" : formatInt(value);
}

function participantMetric(value: number | null, incomplete: boolean) {
  return incomplete ? "Chưa liên kết đủ dữ liệu" : metric(value);
}

export default async function ProgramWorkspacePage(props: { params: Promise<{ programCode: string }>; searchParams?: Promise<{ season?: string | string[]; batch?: string | string[] }> }) {
  const params = await props.params;
  const searchParams = await props.searchParams;

  const context = await resolveAuthorizedProgramContext({
    programCode: params.programCode,
    seasonCode: first(searchParams?.season),
    intakeBatchId: first(searchParams?.batch)
  });
  const [catalog, summary] = await Promise.all([loadProgramContextCatalog(), getProgramWorkspaceSummary(context)]);
  const program = catalog.programs.find((row) => row.id === context.selectedProgramId)!;
  const seasons = catalog.seasons.filter((row) => row.programId === program.id);
  const row = summary.programs[0];
  const scopeLabel = context.selectedSeasonCode ? `Season đã chọn: ${context.selectedSeasonCode}` : "Tất cả season (tổng hợp có chủ đích)";
  const query = new URLSearchParams({ program: program.code });
  if (context.selectedSeasonCode) query.set("season", context.selectedSeasonCode);
  if (context.selectedIntakeBatchId) query.set("batch", context.selectedIntakeBatchId);

  const links = [
    ["Ứng tuyển", "/applications"],
    ["Mentor", "/mentors"],
    ["Mentee", "/mentees"],
    ["Ghép cặp", "/matches"],
    ["Sự kiện", "/events"],
    ["Rà soát dữ liệu", "/data-issues"]
  ];

  return (
    <>
      <PageHeader
        title={program.name}
        description={`Workspace chỉ đọc · Mã chương trình ${program.code} · ${scopeLabel}`}
      />

      <section aria-labelledby="program-summary" className="mb-6">
        <h2 id="program-summary" className="mb-3 text-lg font-semibold text-vam-ink">Tổng quan chương trình · {scopeLabel}</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Ứng tuyển đang xử lý" value={metric(row?.applications ?? null)} />
          <KpiCard label="Mentor đang hoạt động" value={participantMetric(row?.mentors ?? null, row?.participantLinkageIncomplete ?? false)} />
          <KpiCard label="Mentee đang hoạt động" value={participantMetric(row?.mentees ?? null, row?.participantLinkageIncomplete ?? false)} />
          <KpiCard label="Ghép cặp đang hoạt động" value={metric(row?.activeMatches ?? null)} />
          <KpiCard label="Sự kiện sắp tới" value={metric(row?.upcomingEvents ?? null)} />
          <KpiCard label="Vấn đề dữ liệu" value={metric(row?.dataIssues ?? null)} tone={(row?.dataIssues ?? 0) > 0 ? "warning" : "default"} />
        </div>
      </section>

      <section className="mb-6 grid gap-4 xl:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Season</h2>
          {seasons.length ? (
            <SimpleTable
              rows={seasons}
              columns={[
                { key: "name", label: "Tên season" },
                { key: "code", label: "Mã" },
                {
                  key: "open",
                  label: "Mở",
                  render: (season) => (
                    <Link href={`/programs/${encodeURIComponent(program.code)}?season=${encodeURIComponent(season.code)}`} className="font-medium text-vam-green">
                      Chọn season
                    </Link>
                  )
                }
              ]}
            />
          ) : (
            <EmptyState message="Chương trình này chưa có season trong danh mục." />
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Đi tới khu vực nghiệp vụ</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {links.map(([label, href]) => (
              <Link key={href} href={`${href}?${query.toString()}`} className="rounded-md border border-vam-line px-3 py-2 text-sm font-medium text-vam-green hover:bg-vam-mint">
                {label}
              </Link>
            ))}
          </div>
          <button type="button" disabled className="mt-4 w-full cursor-not-allowed rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-400">
            Tạo chương trình mới — sẽ triển khai sau khi hoàn tất permission và audit
          </button>
        </Card>
      </section>
    </>
  );
}
