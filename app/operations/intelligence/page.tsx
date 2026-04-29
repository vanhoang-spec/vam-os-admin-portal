import Link from "next/link";
import { BarSummary, DonutSummary } from "@/components/charts";
import { Card, EmptyState, ErrorBox, KpiCard, PageHeader, SimpleTable } from "@/components/ui";
import { getFounderIntelligenceDashboard } from "@/lib/data";
import type { FounderIntelligenceDashboard, JsonRecord } from "@/lib/types";
import { displayText } from "@/lib/utils";
import { CsvExportButton } from "./export-buttons";

function countChart(rows: Array<Record<string, unknown>>, labelKey: string) {
  return rows.map((row) => ({
    name: displayText(row[labelKey]),
    value: Number(row.count ?? 0)
  }));
}

function actionForGap(gap: number) {
  if (gap < 0) return "Tuyển thêm mentor / tìm co-mentor";
  if (gap > 3) return "Có thể phân bổ thêm mentee";
  return "Theo dõi";
}

function priorityClass(priority: string) {
  if (priority === "high") return "border-red-200 bg-red-50 text-red-800";
  if (priority === "medium") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-vam-line bg-slate-50 text-slate-700";
}

function rateText(value: unknown) {
  if (value === null || value === undefined) return "-";
  return `${value}%`;
}

function Snapshot({ data }: { data: FounderIntelligenceDashboard }) {
  const gaps = data.matchingIntelligence.mentorSupplyVsMenteeDemand.filter((row) => Number(row.gap) < 0).length;
  const overloaded = data.mentorProfile.overloadedMentors.length;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard label="Tổng mentor" value={data.mentorProfile.totalMentors} />
      <KpiCard label="Mentor active" value={data.mentorProfile.activeMentors} />
      <KpiCard label="Tổng mentee" value={data.menteeProfile.totalMentees} />
      <KpiCard label="Mentee active" value={data.menteeProfile.activeMentees} />
      <KpiCard label="Mentor/mentee ratio" value={data.matchingIntelligence.mentorMenteeRatio} />
      <KpiCard label="Segment thiếu mentor" value={gaps} />
      <KpiCard label="Mentor overloaded" value={overloaded} />
      <KpiCard label="Mentee silent" value={data.menteeProfile.silentMentees} />
    </div>
  );
}

function SegmentGapTable({ rows }: { rows: FounderIntelligenceDashboard["matchingIntelligence"]["mentorSupplyVsMenteeDemand"] }) {
  return (
    <SimpleTable
      rows={rows}
      columns={[
        { key: "segment", label: "Segment", render: (row) => displayText(row.segment) },
        { key: "mentorSupply", label: "Mentor supply" },
        { key: "menteeDemand", label: "Mentee demand" },
        { key: "gap", label: "Gap" },
        { key: "action", label: "Recommended action", render: (row) => actionForGap(Number(row.gap)) }
      ]}
    />
  );
}

export default async function FounderIntelligencePage() {
  const result = await getFounderIntelligenceDashboard("UEHM-S11");
  const data = result.data;

  return (
    <>
      <PageHeader
        title="Founder & Core Team Intelligence"
        description="Hiểu cấu trúc mentor/mentee, chất lượng matching và các điểm cần hành động."
      />
      {result.error ? <ErrorBox message={result.error} /> : null}
      {!data ? <EmptyState message="Chưa tải được dữ liệu intelligence. Kiểm tra migration/RPC trên staging." /> : null}
      {data ? (
        <div className="grid gap-6">
          <Card>
            <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
              <div>
                <h2 className="text-lg font-semibold text-vam-ink">Cộng đồng đang khỏe hay yếu ở đâu?</h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  Tháng phân tích: <span className="font-semibold text-vam-ink">{data.definitions.selectedMonth}</span>. Điểm cần nhìn ngay là segment thiếu mentor, mentor overloaded, và mentee silent.
                </p>
                <p className="mt-2 text-xs text-slate-500">{data.definitions.activeMentor}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <CsvExportButton rows={data.mentorProfile.byIndustry as JsonRecord[]} filename="mentor-segment-summary.csv" label="Export mentor CSV" />
                <CsvExportButton rows={data.menteeProfile.byMajor as JsonRecord[]} filename="mentee-segment-summary.csv" label="Export mentee CSV" />
                <CsvExportButton rows={data.matchingIntelligence.mentorSupplyVsMenteeDemand as JsonRecord[]} filename="supply-demand-gap.csv" label="Export gap CSV" />
              </div>
            </div>
          </Card>

          <Snapshot data={data} />

          <section id="mentor-intelligence" className="grid gap-4">
            <h2 className="text-lg font-semibold text-vam-ink">Mentor Intelligence</h2>
            <div className="grid gap-4 xl:grid-cols-2">
              <Card>
                <h3 className="mb-3 text-base font-semibold text-vam-ink">Mentor by industry</h3>
                <BarSummary data={countChart(data.mentorProfile.byIndustry, "industry")} />
              </Card>
              <Card>
                <h3 className="mb-3 text-base font-semibold text-vam-ink">Mentor by function</h3>
                <BarSummary data={countChart(data.mentorProfile.byFunction, "functionArea")} />
              </Card>
              <Card>
                <h3 className="mb-3 text-base font-semibold text-vam-ink">Mentor by years of experience</h3>
                <DonutSummary data={countChart(data.mentorProfile.byExperienceBand, "band")} />
              </Card>
              <Card>
                <h3 className="mb-3 text-base font-semibold text-vam-ink">Mentor by years in VAM</h3>
                <DonutSummary data={countChart(data.mentorProfile.byVamSeniority, "band")} />
              </Card>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <Card>
                <h3 className="mb-3 text-base font-semibold text-vam-ink">Mentor overloaded</h3>
                <SimpleTable
                  rows={data.mentorProfile.overloadedMentors}
                  columns={[
                    { key: "mentorName", label: "Mentor", render: (row) => displayText(row.mentorName) },
                    { key: "industry", label: "Industry", render: (row) => displayText(row.industry) },
                    { key: "currentTitle", label: "Title", render: (row) => displayText(row.currentTitle) },
                    { key: "menteeCount", label: "Mentee" },
                    { key: "capacityTarget", label: "Capacity" },
                    { key: "recapCountCurrentMonth", label: "Recap tháng" }
                  ]}
                />
              </Card>
              <Card>
                <h3 className="mb-3 text-base font-semibold text-vam-ink">Mentor inactive nhưng có mentee</h3>
                <SimpleTable
                  rows={data.mentorProfile.inactiveMentorsWithMentees}
                  columns={[
                    { key: "mentorName", label: "Mentor", render: (row) => displayText(row.mentorName) },
                    { key: "industry", label: "Industry", render: (row) => displayText(row.industry) },
                    { key: "currentCompany", label: "Company", render: (row) => displayText(row.currentCompany) },
                    { key: "menteeCount", label: "Mentee" },
                    { key: "recapCountCurrentMonth", label: "Recap tháng" }
                  ]}
                />
              </Card>
            </div>
          </section>

          <section id="mentee-intelligence" className="grid gap-4">
            <h2 className="text-lg font-semibold text-vam-ink">Mentee Intelligence</h2>
            <div className="grid gap-4 xl:grid-cols-2">
              <Card>
                <h3 className="mb-3 text-base font-semibold text-vam-ink">Mentee by major</h3>
                <BarSummary data={countChart(data.menteeProfile.byMajor, "major")} />
              </Card>
              <Card>
                <h3 className="mb-3 text-base font-semibold text-vam-ink">Mentee by career interest</h3>
                <BarSummary data={countChart(data.menteeProfile.byCareerInterest, "careerInterest")} />
              </Card>
              <Card>
                <h3 className="mb-3 text-base font-semibold text-vam-ink">Mentee by target industry</h3>
                <BarSummary data={countChart(data.menteeProfile.byTargetIndustry, "targetIndustry")} />
              </Card>
              <Card>
                <h3 className="mb-3 text-base font-semibold text-vam-ink">Mentee by support team</h3>
                <DonutSummary data={countChart(data.menteeProfile.bySupportTeam, "supportTeam")} />
              </Card>
            </div>
            <Card>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-semibold text-vam-ink">Silent mentee by career interest</h3>
                <Link href="/operations/tasks?type=followup_no_recap" className="rounded-md border border-vam-line px-3 py-2 text-sm font-medium text-vam-green hover:bg-vam-mint">
                  Mở workflow follow-up
                </Link>
              </div>
              <SimpleTable
                rows={data.activityBySegment.silentMenteeByCareerInterest}
                columns={[
                  { key: "careerInterest", label: "Career interest", render: (row) => displayText(row.careerInterest) },
                  { key: "silentMentees", label: "Mentee silent" }
                ]}
              />
            </Card>
          </section>

          <section id="matching-intelligence" className="grid gap-4">
            <h2 className="text-lg font-semibold text-vam-ink">Matching Intelligence</h2>
            <div className="grid gap-4 xl:grid-cols-2">
              <Card>
                <h3 className="mb-3 text-base font-semibold text-vam-ink">Industry alignment</h3>
                <DonutSummary data={countChart(data.matchingIntelligence.matchesByIndustryAlignment, "alignment")} />
              </Card>
              <Card>
                <h3 className="mb-3 text-base font-semibold text-vam-ink">Function alignment</h3>
                <DonutSummary data={countChart(data.matchingIntelligence.matchesByFunctionAlignment, "alignment")} />
              </Card>
            </div>
            <Card>
              <h3 className="mb-3 text-base font-semibold text-vam-ink">Mentor supply vs mentee demand</h3>
              <SegmentGapTable rows={data.matchingIntelligence.mentorSupplyVsMenteeDemand} />
            </Card>
          </section>

          <section id="activity-by-segment" className="grid gap-4">
            <h2 className="text-lg font-semibold text-vam-ink">Activity by Segment</h2>
            <div className="grid gap-4 xl:grid-cols-3">
              <Card>
                <h3 className="mb-3 text-base font-semibold text-vam-ink">Active mentee rate by major</h3>
                <SimpleTable
                  rows={data.activityBySegment.activeMenteeRateByMajor}
                  columns={[
                    { key: "major", label: "Major", render: (row) => displayText(row.major) },
                    { key: "mentees", label: "Mentee" },
                    { key: "activeMentees", label: "Active" },
                    { key: "activeRate", label: "Rate", render: (row) => rateText(row.activeRate) }
                  ]}
                />
              </Card>
              <Card>
                <h3 className="mb-3 text-base font-semibold text-vam-ink">Recap rate by support team</h3>
                <SimpleTable
                  rows={data.activityBySegment.recapRateBySupportTeam}
                  columns={[
                    { key: "supportTeam", label: "Support team", render: (row) => displayText(row.supportTeam) },
                    { key: "activeMentees", label: "Active" },
                    { key: "menteesWithRecap", label: "Có recap" },
                    { key: "recapRate", label: "Rate", render: (row) => rateText(row.recapRate) }
                  ]}
                />
              </Card>
              <Card>
                <h3 className="mb-3 text-base font-semibold text-vam-ink">Active mentor rate by industry</h3>
                <SimpleTable
                  rows={data.activityBySegment.activeMentorRateByIndustry}
                  columns={[
                    { key: "industry", label: "Industry", render: (row) => displayText(row.industry) },
                    { key: "mentors", label: "Mentor" },
                    { key: "activeMentors", label: "Active" },
                    { key: "activeRate", label: "Rate", render: (row) => rateText(row.activeRate) }
                  ]}
                />
              </Card>
            </div>
          </section>

          <section id="recommended-actions" className="grid gap-4">
            <h2 className="text-lg font-semibold text-vam-ink">Recommended Actions</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {data.recommendedActions.map((action, index) => (
                <Card key={`${action.title}-${index}`}>
                  <div className={`mb-3 inline-flex rounded-md border px-2 py-1 text-xs font-semibold uppercase ${priorityClass(action.priority)}`}>
                    {displayText(action.priority)}
                  </div>
                  <h3 className="text-base font-semibold text-vam-ink">{action.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{action.reason}</p>
                  <div className="mt-3 rounded-md border border-vam-line bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    <div><span className="font-medium text-vam-ink">Owner:</span> {action.suggestedOwner}</div>
                    <div className="mt-1"><span className="font-medium text-vam-ink">Action:</span> {action.suggestedAction}</div>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
