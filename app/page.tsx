import Link from "next/link";
import { BarSummary, DonutSummary } from "@/components/charts";
import { Card, ErrorBox, KpiCard, PageHeader, SimpleTable } from "@/components/ui";
import { getDashboardData, getOperationsData, keyById } from "@/lib/data";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { displayCode, displayText } from "@/lib/utils";

const SEASON_CODE = "UEHM-S11";
const OPERATIONAL_MONTH_START = "2025-10";
const OPERATIONAL_MONTH_END = "2026-06";
const VALID_ACTIVITY_STATUSES = new Set(["", "submitted", "needs_review"]);

function statusKey(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function isActive(value: unknown) {
  return statusKey(value) === "active";
}

function isValidRecapActivity(value: unknown) {
  return VALID_ACTIVITY_STATUSES.has(statusKey(value));
}

function isBlank(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return !normalized || normalized === "-" || normalized === "0" || normalized === "nan" || normalized === "null" || normalized === "undefined";
}

function isMissingSchoolCode(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return isBlank(value) || normalized === "other";
}

function percent(numerator: number, denominator: number) {
  if (!denominator) return "0%";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function average(numerator: number, denominator: number) {
  if (!denominator) return "0";
  return (numerator / denominator).toFixed(1);
}

function monthDate(month: string) {
  return new Date(`${month}-01T00:00:00Z`);
}

function addMonths(month: string, delta: number) {
  const date = monthDate(month);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 7);
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function operationalMonths() {
  const months: string[] = [];
  for (let month = OPERATIONAL_MONTH_START; month <= OPERATIONAL_MONTH_END; month = addMonths(month, 1)) {
    months.push(month);
  }
  return months;
}

function isOperationalMonth(month: unknown) {
  const value = String(month ?? "").trim();
  return /^\d{4}-\d{2}$/.test(value) && value >= OPERATIONAL_MONTH_START && value <= OPERATIONAL_MONTH_END;
}

function latestRecapDate(recaps: Array<{ meeting_date?: string | null }>) {
  const dates = recaps
    .map((recap) => String(recap.meeting_date ?? "").slice(0, 10))
    .filter(Boolean)
    .sort();
  return dates.at(-1) ?? null;
}

function monthDiff(laterMonth: string, earlierMonth: string) {
  const later = monthDate(laterMonth);
  const earlier = monthDate(earlierMonth);
  return (later.getUTCFullYear() - earlier.getUTCFullYear()) * 12 + later.getUTCMonth() - earlier.getUTCMonth();
}

function countByLabel(rows: Array<Record<string, unknown>>, key: string, fallback = "Chưa rõ") {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const raw = row[key];
    const label = displayText(raw, fallback);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "vi"));
}

export default async function DashboardPage() {
  const scope = await getScopeFilter(await getAdminScopeContext());
  const [data, opsData] = await Promise.all([
    getDashboardData(scope),
    getOperationsData(scope)
  ]);
  const errors = [
    data.people.error,
    data.mentors.error,
    data.mentees.error,
    data.applications.error,
    data.matches.error,
    data.recaps.error,
    data.counts.people.error,
    data.counts.mentors.error,
    data.counts.mentees.error,
    data.counts.applications.error,
    data.counts.matches.error,
    data.counts.activeMatches.error,
    data.duplicateEmails.error,
    data.activeMissing.error,
    data.latestClosedMonth.error
  ].filter(Boolean);

  const peopleById = keyById(data.people.data);
  const season = data.seasons.data.find((row) => row.code === SEASON_CODE);
  const seasonMatches = data.matches.data.filter((match) => {
    if (season?.id) return match.season_id === season.id;
    return true;
  });
  const seasonRecaps = data.recaps.data.filter((recap) => {
    if (season?.id) return recap.season_id === season.id;
    return true;
  });
  const activeMatches = seasonMatches.filter((match) => isActive(match.status));
  const activeMatchesWithMentorAndMentee = activeMatches.filter((match) => match.mentor_person_id && match.mentee_person_id);
  const activeMenteeIds = new Set(activeMatchesWithMentorAndMentee.map((match) => match.mentee_person_id).filter(Boolean));
  const activeMentorIds = new Set(activeMatchesWithMentorAndMentee.map((match) => match.mentor_person_id).filter(Boolean));
  const activeMenteeCountByMentor = new Map<string, Set<string>>();
  const recapsByMentee = new Map<string, typeof data.recaps.data>();

  for (const match of activeMatchesWithMentorAndMentee) {
    if (!match.mentor_person_id || !match.mentee_person_id) continue;
    const menteeIds = activeMenteeCountByMentor.get(match.mentor_person_id) ?? new Set<string>();
    menteeIds.add(match.mentee_person_id);
    activeMenteeCountByMentor.set(match.mentor_person_id, menteeIds);
  }

  const seasonMonths = operationalMonths();
  const validRecaps = seasonRecaps.filter((recap) => isValidRecapActivity(recap.status));
  const validOperationalRecaps = validRecaps.filter((recap) => isOperationalMonth(recap.meeting_month));
  const monthsWithData = new Set(validOperationalRecaps.map((recap) => recap.meeting_month).filter((month): month is string => Boolean(month)));
  const availableMonths = seasonMonths.filter((month) => monthsWithData.has(month)).sort((a, b) => b.localeCompare(a));
  const nowMonth = currentMonth();
  const latestNonFutureMonth = availableMonths.find((month) => month <= nowMonth);
  const currentOperationalMonth = isOperationalMonth(nowMonth) ? nowMonth : null;
  
  const opsSeason = opsData.seasons.data.find((row) => row.code === SEASON_CODE);
  const seasonLatestClosedMonth = opsData.latestClosedMonth?.data?.find((row: any) => row.season_id === (season?.id || opsSeason?.id));
  const officialClosedMonth = typeof seasonLatestClosedMonth?.latest_closed_month === "string" ? seasonLatestClosedMonth.latest_closed_month : null;
  const officialPreviousClosedMonth = typeof seasonLatestClosedMonth?.previous_closed_month === "string" ? seasonLatestClosedMonth.previous_closed_month : null;

  const opsSelectedMonth = opsData.kpis.data?.selectedMonth ?? latestNonFutureMonth ?? OPERATIONAL_MONTH_START;
  const healthMonthLabel = officialClosedMonth ?? opsSelectedMonth;

  // KPIs derived directly from official governance data where available
  const homeRecapKpi = typeof seasonLatestClosedMonth?.total_recap_entries === "number" ? seasonLatestClosedMonth.total_recap_entries : (opsData.kpis.data?.recapCount ?? 0);
  const homeMenteeActiveKpi = typeof seasonLatestClosedMonth?.distinct_mentees_with_recap === "number" ? seasonLatestClosedMonth.distinct_mentees_with_recap : (opsData.kpis.data?.activeMenteeCount ?? 0);
  const homeMentorActiveKpi = opsData.kpis.data?.activeMentorCount ?? 0;

  // Replicate Operations follow-up logic exactly
  const closedMonth = officialClosedMonth ?? (opsSelectedMonth >= nowMonth ? addMonths(nowMonth, -1) : opsSelectedMonth);
  const closedPreviousMonth = officialPreviousClosedMonth ?? addMonths(closedMonth, -1);
  
  const opsValidRecaps = opsData.recaps.data.filter((recap) => isValidRecapActivity(recap.status));
  const closedRecaps = opsValidRecaps.filter((recap) => recap.meeting_month === closedMonth);
  const closedPreviousRecaps = opsValidRecaps.filter((recap) => recap.meeting_month === closedPreviousMonth);
  
  const opsActiveMatches = opsData.matches.data.filter((m) => isActive(m.status) && m.mentor_person_id && m.mentee_person_id);
  const opsActiveMenteeIds = new Set(opsActiveMatches.map((m) => m.mentee_person_id).filter(Boolean));
  
  const closedMenteeIds = new Set(closedRecaps.map((recap) => recap.mentee_person_id).filter(Boolean));
  const closedPreviousMenteeIds = new Set(closedPreviousRecaps.map((recap) => recap.mentee_person_id).filter(Boolean));

  // Recap-by-month chart: use validOperationalRecaps (season-scoped, direct DB read via
  // getDashboardData) rather than opsValidRecaps (may come from RPC with different filters).
  // This keeps the chart consistent with the KPI cards and follow-up metrics which all
  // derive from the season-filtered data.recaps feed.
  //
  // DATA COMPLETENESS NOTE: chart counts reflect only what is currently in the
  // mentoring_recaps table.  Historical months (Nov 2025 – Feb 2026) show lower counts
  // than the raw tracking Excel because the import was run on a partial subset of
  // submissions.  See tracking_audit_output/ for import status of the full dataset.
  // TODO: complete the import of remaining Season 11 recaps and re-run this page to verify.
  const recapByMonth = seasonMonths.map((name) => ({
    name,
    value: validOperationalRecaps.filter((recap) => recap.meeting_month === name).length
  }));

  const activeClosedMonthCount = Array.from(opsActiveMenteeIds).filter((id) => closedMenteeIds.has(id)).length;
  const missingClosedMonthCount = Array.from(opsActiveMenteeIds).filter((id) => !closedMenteeIds.has(id)).length;
  const homeFollowUpKpi = Array.from(opsActiveMenteeIds).filter((id) => !closedMenteeIds.has(id) && !closedPreviousMenteeIds.has(id)).length;
  
  const menteeHealthData = [
    { name: "Mentee active tháng đã đóng", value: activeClosedMonthCount },
    { name: "Chưa có recap tháng gần nhất", value: missingClosedMonthCount },
    { name: "Im lặng 2 tháng liên tiếp / cần follow-up", value: homeFollowUpKpi }
  ];

  const selectedMonth = officialClosedMonth ?? opsSelectedMonth; // for backward compatibility with secondary charts
  const selectedRecaps = validRecaps.filter((recap) => recap.meeting_month === selectedMonth);
  const previousRecaps = validRecaps.filter((recap) => recap.meeting_month === closedPreviousMonth);
  const selectedMenteeIds = new Set(selectedRecaps.map((recap) => recap.mentee_person_id).filter(Boolean));
  const selectedMentorIds = new Set(selectedRecaps.map((recap) => recap.mentor_person_id).filter(Boolean));
  const previousMenteeIds = new Set(previousRecaps.map((recap) => recap.mentee_person_id).filter(Boolean));

  for (const recap of validRecaps) {
    if (!recap.mentee_person_id) continue;
    const rows = recapsByMentee.get(recap.mentee_person_id) ?? [];
    rows.push(recap);
    recapsByMentee.set(recap.mentee_person_id, rows);
  }

  const menteesWithMentor = activeMenteeIds.size;
  const menteesWithoutMentor = Math.max(0, data.counts.mentees.data - menteesWithMentor);
  const mentorsWithAssignedMentees = activeMentorIds.size;
  const mentorsWithoutAssignedMentees = Math.max(0, data.counts.mentors.data - mentorsWithAssignedMentees);
  const peopleMissingPhone = data.people.data.filter((person) => isBlank(person.phone_primary)).length;
  const menteesMissingSchool = data.mentees.data.filter((mentee) => isMissingSchoolCode(mentee.school_code)).length;
  const mentorsMissingBioUrl = data.mentors.data.filter((mentor) => isBlank(mentor.bio_url)).length;
  const activeMatchesMissingMentorOrMentee = activeMatches.filter((match) => !match.mentor_person_id || !match.mentee_person_id).length;
  const warningCount =
    peopleMissingPhone + menteesMissingSchool + mentorsMissingBioUrl + menteesWithoutMentor + activeMatchesMissingMentorOrMentee + data.duplicateEmails.data;

  const topMentorRows = data.mentors.data
    .map((mentor) => {
      const person = mentor.person_id ? peopleById.get(mentor.person_id) : undefined;
      const assignedMenteeCount = mentor.person_id ? activeMenteeCountByMentor.get(mentor.person_id)?.size ?? 0 : 0;
      const activeMatchCount = mentor.person_id ? activeMatches.filter((match) => match.mentor_person_id === mentor.person_id).length : 0;
      return {
        ...mentor,
        full_name: person?.full_name,
        email_primary: person?.email_primary,
        company_current_display: displayText(mentor.company_current),
        assigned_mentee_count: assignedMenteeCount,
        active_match_count: activeMatchCount
      };
    })
    .filter((mentor) => mentor.assigned_mentee_count > 0)
    .sort((a, b) => b.assigned_mentee_count - a.assigned_mentee_count || String(a.full_name ?? "").localeCompare(String(b.full_name ?? ""), "vi"))
    .slice(0, 10);

  const topMentorRecapRows = Array.from(
    selectedRecaps.reduce((rows, recap) => {
      if (!recap.mentor_person_id) return rows;
      const current = rows.get(recap.mentor_person_id) ?? {
        mentor_id: recap.mentor_person_id,
        mentor_name: peopleById.get(recap.mentor_person_id)?.full_name ?? null,
        mentor_email: peopleById.get(recap.mentor_person_id)?.email_primary ?? null,
        recap_count: 0,
        menteeIds: new Set<string>()
      };
      current.recap_count += 1;
      if (recap.mentee_person_id) current.menteeIds.add(recap.mentee_person_id);
      rows.set(recap.mentor_person_id, current);
      return rows;
    }, new Map<string, { mentor_id: string; mentor_name: string | null; mentor_email: string | null; recap_count: number; menteeIds: Set<string> }>())
  )
    .map(([, row]) => ({ ...row, mentee_count: row.menteeIds.size }))
    .sort((a, b) => b.recap_count - a.recap_count || b.mentee_count - a.mentee_count || String(a.mentor_name ?? "").localeCompare(String(b.mentor_name ?? ""), "vi"))
    .slice(0, 8);

  const followUpTwoMonthRows = activeMatchesWithMentorAndMentee
    .filter((match) => match.mentee_person_id && !closedMenteeIds.has(match.mentee_person_id) && !closedPreviousMenteeIds.has(match.mentee_person_id))
    .map((match) => {
      const menteeId = match.mentee_person_id!;
      const mentorId = match.mentor_person_id!;
      const mentee = peopleById.get(menteeId);
      const mentor = peopleById.get(mentorId);
      const recapsBeforeSelectedMonth = (recapsByMentee.get(menteeId) ?? []).filter((recap) => String(recap.meeting_month ?? "") <= selectedMonth);
      const lastDate = latestRecapDate(recapsBeforeSelectedMonth);
      const lastMonth = lastDate ? lastDate.slice(0, 7) : null;
      return {
        mentee_id: menteeId,
        mentee_name: mentee?.full_name ?? null,
        mentee_email: mentee?.email_primary ?? null,
        mentor_name: mentor?.full_name ?? null,
        last_recap_date: lastDate ?? "Chưa có recap",
        months_silent: lastMonth ? Math.max(0, monthDiff(selectedMonth, lastMonth)) : "Chưa có recap"
      };
    })
    .sort((a, b) => {
      const aMonths = typeof a.months_silent === "number" ? a.months_silent : 999;
      const bMonths = typeof b.months_silent === "number" ? b.months_silent : 999;
      return bMonths - aMonths || String(a.mentee_name ?? "").localeCompare(String(b.mentee_name ?? ""), "vi");
    })
    .slice(0, 8);

  const mentorBuckets = [
    { name: "0 mentee", value: mentorsWithoutAssignedMentees },
    { name: "1 mentee", value: data.mentors.data.filter((mentor) => mentor.person_id && (activeMenteeCountByMentor.get(mentor.person_id)?.size ?? 0) === 1).length },
    { name: "2 mentees", value: data.mentors.data.filter((mentor) => mentor.person_id && (activeMenteeCountByMentor.get(mentor.person_id)?.size ?? 0) === 2).length },
    { name: "3+ mentees", value: data.mentors.data.filter((mentor) => mentor.person_id && (activeMenteeCountByMentor.get(mentor.person_id)?.size ?? 0) >= 3).length }
  ];

  // Season 11 data reconciliation note (updated 2026-05-05 after backfill).
  // Two backfill waves added 281 recaps (61 URL-backed + 220 no-URL flagged, issue_flag=TRUE).
  // DB now holds ~1,405 of the ~1,735 sessions in the raw Báo cáo Recap report.
  // Remaining 330-row gap is structurally unresolvable from current tracking data
  // (Zalo recaps, verbal reports, missing mentee codes, no active match).
  // TODO: set showS11ReconciliationNote = false when the team closes out the gap investigation.
  const totalDbOperationalRecaps = validOperationalRecaps.length;
  const showS11ReconciliationNote = true;

  const warningRows = [
    { label: "People thiếu số điện thoại", count: peopleMissingPhone, href: "/data-issues?issue=missing_phone#issue-missing-phone" },
    { label: "Mentee thiếu school_code hoặc school_code OTHER/blank", count: menteesMissingSchool, href: "/data-issues?issue=missing_school_code#issue-missing-school-code" },
    { label: "Mentor thiếu bio_url", count: mentorsMissingBioUrl, href: "/data-issues?issue=missing_mentor_bio_url#issue-missing-mentor-bio-url" },
    { label: "Mentee chưa có active mentor", count: menteesWithoutMentor, href: "/data-issues?issue=mentee_without_active_mentor#issue-mentee-without-active-mentor" },
    { label: "Active match thiếu mentor/mentee", count: activeMatchesMissingMentorOrMentee, href: "/data-issues?issue=active_match_missing_person#issue-active-match-missing-person" },
    { label: "Email trùng cần rà soát", count: data.duplicateEmails.data, href: "/data-issues?issue=duplicate_email#issue-duplicate-email" }
  ];

  return (
    <>
      <PageHeader title="Dashboard" description="Tổng quan vận hành VAM OS MVP cho UEH Mentoring Season 11." />
      {errors.length ? <ErrorBox message="Không tải được một phần dữ liệu dashboard. Các chỉ số liên quan có thể đang hiển thị 0 hoặc thiếu dữ liệu." /> : null}
      {errors.map((error) => (
        <ErrorBox key={error} message={error} />
      ))}

      <div className="mb-4 text-sm">
        <p className="text-slate-600 font-medium">Tháng đã chốt: {officialClosedMonth ?? "Chưa có"}</p>
        {!officialClosedMonth && opsSelectedMonth ? (
          <p className="text-amber-600 mt-1">Đang hiển thị tháng mở {opsSelectedMonth} do chưa có dữ liệu chốt</p>
        ) : null}
      </div>

      {/* Season 11 data reconciliation note — updated 2026-05-05 after backfill completion.
          281 recaps added across two waves (61 URL-backed + 220 no-URL flagged).
          DB now holds ~1,405 / 1,735 sessions; remaining 330-row gap is structural.
          TODO: set showS11ReconciliationNote = false to dismiss when no longer needed. */}
      {showS11ReconciliationNote ? (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">Lưu ý dữ liệu Season 11</p>
          <p className="mt-1">
            Hệ thống đã backfill thêm 281 recap từ file tracking, bao gồm cả các recap không có URL nhưng được đánh dấu để audit.
            Tổng recap hiện có trong DB là{" "}
            <strong>{totalDbOperationalRecaps.toLocaleString("vi")}/1.735</strong> theo báo cáo tracking gốc.
            Phần chênh lệch còn lại chủ yếu đến từ recap qua Zalo, báo cáo miệng, thiếu mã mentee hoặc không map được với match đang hoạt động, nên chưa thể tự động khôi phục.
            Dashboard hiện phản ánh dữ liệu đã được chuẩn hóa trong DB.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Số recap tháng này" value={homeRecapKpi} />
        <KpiCard label="Mentee active tháng này" value={homeMenteeActiveKpi} />
        <KpiCard label="Mentor active tháng này" value={homeMentorActiveKpi} />
        <KpiCard label="Mentee active tháng đã đóng" value={activeClosedMonthCount} />
        <KpiCard label="Chưa có recap tháng gần nhất" value={missingClosedMonthCount} />
        <KpiCard label="Im lặng 2 tháng liên tiếp / cần follow-up" value={homeFollowUpKpi} />
      </div>

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold text-vam-ink">Sức khỏe mentoring</h2>
        <div className="grid gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <div className="mb-3">
              <h3 className="text-base font-semibold text-vam-ink">Recap mentoring theo tháng</h3>
              <p className="mt-1 text-sm text-slate-500">Số recap phản ánh số buổi mentoring 1-on-1 được ghi nhận.</p>
            </div>
            <BarSummary data={recapByMonth} highlightedName={selectedMonth} tooltipLabelPrefix="Tháng" valueLabel="Số recap" />
          </Card>
          <Card>
            <div className="mb-3">
              <h3 className="text-base font-semibold text-vam-ink">Sức khỏe mentee - {healthMonthLabel}</h3>
              <p className="mt-1 text-sm text-slate-500">Dựa trên active match và recap được ghi nhận trong tháng.</p>
            </div>
            <DonutSummary data={menteeHealthData} />
          </Card>
        </div>
      </section>

      <section className="mt-6 grid gap-4 xl:grid-cols-2">
        <Card>
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-vam-ink">Top mentor theo số recap tháng này</h2>
              <p className="mt-1 text-sm text-slate-500">Mentor có nhiều buổi mentoring 1-on-1 được ghi nhận nhất trong {selectedMonth}.</p>
            </div>
            <Link href={`/operations?month=${selectedMonth}`} className="rounded-md border border-vam-line px-3 py-2 text-sm font-medium text-vam-green hover:bg-vam-mint">
              Xem Operations
            </Link>
          </div>
          <SimpleTable
            rows={topMentorRecapRows}
            columns={[
              { key: "mentor_name", label: "Mentor", render: (row) => displayText(row.mentor_name) },
              { key: "mentor_email", label: "Email", render: (row) => displayText(row.mentor_email) },
              { key: "recap_count", label: "Số recap" },
              { key: "mentee_count", label: "Số mentee" },
              { key: "mentor_link", label: "Profile", render: (row) => <Link href={`/people/${row.mentor_id}`} className="text-sm font-medium text-vam-green">Xem mentor</Link> }
            ]}
          />
        </Card>
        <Card>
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-vam-ink">Mentee cần follow-up</h2>
              <p className="mt-1 text-sm text-slate-500">Mentee có active match nhưng chưa có recap trong tháng này và tháng trước.</p>
            </div>
            <Link href={`/operations/tasks?month=${selectedMonth}&type=followup_no_recap`} className="rounded-md border border-vam-line px-3 py-2 text-sm font-medium text-vam-green hover:bg-vam-mint">
              Mở queue
            </Link>
          </div>
          <SimpleTable
            rows={followUpTwoMonthRows}
            columns={[
              { key: "mentee_name", label: "Mentee", render: (row) => displayText(row.mentee_name) },
              { key: "mentee_email", label: "Email", render: (row) => displayText(row.mentee_email) },
              { key: "mentor_name", label: "Mentor", render: (row) => displayText(row.mentor_name) },
              { key: "months_silent", label: "Số tháng im lặng" },
              { key: "profile", label: "Profile", render: (row) => <Link href={`/people/${row.mentee_id}`} className="text-sm font-medium text-vam-green">Xem mentee</Link> }
            ]}
          />
        </Card>
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold text-vam-ink">Quy mô dữ liệu / Master data</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <KpiCard label="Tổng người" value={data.counts.people.data} />
          <KpiCard label="Tổng mentor" value={data.counts.mentors.data} />
          <KpiCard label="Tổng mentee" value={data.counts.mentees.data} />
          <KpiCard label="Ứng tuyển" value={data.counts.applications.data} />
          <KpiCard label="Match active" value={activeMatches.length} />
          <KpiCard label="Tổng match" value={seasonMatches.length} />
          <KpiCard label="Mentee đã có mentor" value={menteesWithMentor} />
          <KpiCard label="Mentee chưa có mentor" value={menteesWithoutMentor} />
          <KpiCard label="Mentor đang phụ trách mentee" value={mentorsWithAssignedMentees} />
          <KpiCard label="Mentor chưa có mentee" value={mentorsWithoutAssignedMentees} />
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold text-vam-ink">Tình trạng vận hành dữ liệu</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Tỷ lệ mentee đã có mentor" value={percent(menteesWithMentor, data.counts.mentees.data)} />
          <KpiCard label="Tỷ lệ mentor có mentee" value={percent(mentorsWithAssignedMentees, data.counts.mentors.data)} />
          <KpiCard label="Số mentee trung bình / mentor có mentee" value={average(menteesWithMentor, mentorsWithAssignedMentees)} />
          <KpiCard label="Cảnh báo dữ liệu" value={warningCount} />
        </div>
      </section>

      <section className="mt-6 grid gap-4 xl:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Mentee theo school_code</h2>
          <BarSummary data={countByLabel(data.mentees.data, "school_code")} />
        </Card>
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Match theo trạng thái</h2>
          <DonutSummary data={countByLabel(seasonMatches, "status")} />
        </Card>
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Ứng tuyển theo trạng thái cuối</h2>
          <DonutSummary data={countByLabel(data.applications.data, "final_status")} />
        </Card>
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Mentor theo số mentee phụ trách</h2>
          <BarSummary data={mentorBuckets} />
        </Card>
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold text-vam-ink">Mentor đang phụ trách nhiều mentee nhất</h2>
        <SimpleTable
          rows={topMentorRows}
          columns={[
            { key: "full_name", label: "Mentor" },
            { key: "email_primary", label: "Email" },
            { key: "company_current", label: "Công ty", displayKey: "company_current_display" },
            { key: "assigned_mentee_count", label: "Số mentee" },
            { key: "active_match_count", label: "Match active" },
            { key: "mentor_link", label: "Profile", internalHrefKey: "person_id", internalHrefPrefix: "/people/", internalLabel: "Xem mentor" }
          ]}
        />
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold text-vam-ink">Cảnh báo dữ liệu cần rà soát</h2>
        <SimpleTable
          rows={warningRows}
          columns={[
            { key: "label", label: "Cảnh báo", render: (row) => displayCode(row.label) },
            { key: "count", label: "Số lượng" },
            { key: "href", label: "Trang rà soát", render: (row) => <Link href={row.href} className="text-sm font-medium text-vam-green">Mở trang</Link> }
          ]}
        />
      </section>
    </>
  );
}
