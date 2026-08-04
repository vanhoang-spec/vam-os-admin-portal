import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, EmptyState, ErrorBox, KpiCard, PageHeader, SimpleTable } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { resolveAuthorizedPrograms } from "@/lib/program-context";
import { getSuperAdminPortfolio, type ProgramPortfolioRow } from "@/lib/portfolio";
import { formatInt } from "@/lib/utils";

function metric(value: number | null) {
  return value === null ? "Chưa có dữ liệu" : formatInt(value);
}

function participantMetric(row: ProgramPortfolioRow, role: "mentors" | "mentees") {
  return row.participantLinkageIncomplete ? "Chưa liên kết đủ dữ liệu" : metric(row[role]);
}

function healthLabel(value: ProgramPortfolioRow["health"]) {
  if (value === "normal") return "Bình thường";
  if (value === "attention") return "Cần chú ý";
  if (value === "data_issue") return "Có vấn đề dữ liệu";
  return "Chưa có dữ liệu";
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PortfolioPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const adminUser = await getCurrentAdminUser();
  if (adminUser?.role !== "super_admin") {
    const programs = await resolveAuthorizedPrograms();
    redirect(programs[0] ? `/programs/${encodeURIComponent(programs[0].code)}` : "/");
  }

  const data = await getSuperAdminPortfolio();
  const selectedProgram = first(searchParams?.program);
  const selectedSeason = first(searchParams?.season);
  const adminUsersQuery = new URLSearchParams();
  if (selectedProgram) adminUsersQuery.set("program", selectedProgram);
  if (selectedSeason) adminUsersQuery.set("season", selectedSeason);
  return (
    <>
      <PageHeader
        title="Danh mục chương trình"
        description="Tổng quan toàn hệ thống dành cho Super Admin. Dashboard chỉ hiển thị số liệu tổng hợp, không hiển thị thông tin cá nhân."
      />

      {selectedProgram && selectedSeason ? (
        <Card className="mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-700">
            <span>Phạm vi đã chọn: <strong>{selectedProgram}</strong> · <strong>{selectedSeason}</strong></span>
            <Link href={`/admin/users?${adminUsersQuery.toString()}`} className="font-medium text-vam-green hover:underline">
              Mở quản lý người dùng trong phạm vi này
            </Link>
          </div>
        </Card>
      ) : null}

      {data.warnings.length ? (
        <ErrorBox message={`Một số KPI chưa có nguồn dữ liệu tin cậy: ${data.warnings.join(", ")}.`} />
      ) : null}

      <section aria-labelledby="portfolio-kpis" className="mb-6">
        <h2 id="portfolio-kpis" className="mb-3 text-lg font-semibold text-vam-ink">Chỉ số toàn hệ thống</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <KpiCard label="Tổng chương trình" value={metric(data.totals.programs)} />
          <KpiCard label="Chương trình đang hoạt động" value={metric(data.totals.activePrograms)} />
          <KpiCard label="Season trong danh mục" value={metric(data.totals.activeSeasons)} />
          <KpiCard label="Ứng tuyển đang mở hoặc chờ xử lý" value={metric(data.totals.openApplications)} />
          <KpiCard label="Mentor đang hoạt động" value={metric(data.totals.activeMentors)} />
          <KpiCard label="Mentee đang hoạt động" value={metric(data.totals.activeMentees)} />
          <KpiCard label="Ghép cặp đang hoạt động" value={metric(data.totals.activeMatches)} />
          <KpiCard label="Sự kiện sắp tới" value={metric(data.totals.upcomingEvents)} />
          <KpiCard label="Vấn đề dữ liệu đang mở" value={metric(data.totals.dataIssues)} tone={(data.totals.dataIssues ?? 0) > 0 ? "warning" : "default"} />
          <KpiCard label="Nhiệm vụ quá hạn" value={metric(data.totals.overdueTasks)} tone={(data.totals.overdueTasks ?? 0) > 0 ? "danger" : "default"} />
        </div>
      </section>

      <Card>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-vam-ink">Theo chương trình</h2>
          <p className="mt-1 text-sm text-slate-500">
            “Có vấn đề dữ liệu” khi còn data issue mở; “Cần chú ý” khi không có data issue nhưng còn nhiệm vụ quá hạn.
          </p>
        </div>
        {data.programs.length ? (
          <SimpleTable
            rows={data.programs}
            columns={[
              {
                key: "programName",
                label: "Chương trình",
                render: (row) => (
                  <Link href={`/programs/${encodeURIComponent(row.programCode)}`} className="font-medium text-vam-green hover:underline">
                    {row.programName}
                  </Link>
                )
              },
              { key: "currentSeasonCode", label: "Season hiện hành", render: (row) => row.currentSeasonCode ?? "Chưa có dữ liệu" },
              { key: "applications", label: "Ứng tuyển", render: (row) => metric(row.applications) },
              { key: "mentors", label: "Mentor", render: (row) => participantMetric(row, "mentors") },
              { key: "mentees", label: "Mentee", render: (row) => participantMetric(row, "mentees") },
              { key: "activeMatches", label: "Ghép cặp", render: (row) => metric(row.activeMatches) },
              { key: "upcomingEvents", label: "Sự kiện", render: (row) => metric(row.upcomingEvents) },
              { key: "dataIssues", label: "Vấn đề dữ liệu", render: (row) => metric(row.dataIssues) },
              { key: "health", label: "Tình trạng", render: (row) => healthLabel(row.health) }
            ]}
          />
        ) : (
          <EmptyState message="Chưa có chương trình hoạt động trong danh mục." />
        )}
      </Card>
    </>
  );
}
