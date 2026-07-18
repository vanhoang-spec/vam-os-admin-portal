import Link from "next/link";
import { BarSummary, DonutSummary } from "@/components/charts";
import { Card, EmptyState, ErrorBox, ExternalLinkButton, InternalLinkButton, KpiCard, PageHeader, ProgressiveTable, SimpleTable } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import { getOperationsData, keyById } from "@/lib/data";
import { isEventAbsenceStatus, isEventAttendedStatus } from "@/lib/events";
import { canOperateAnyScope, getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import type { Event, Match, MentoringRecap, Person } from "@/lib/types";
import { displayCode, displayText, formatDate } from "@/lib/utils";
import { MonthSelector } from "./month-selector";
import { SEASON_CONFIG } from "@/lib/season-config";

const SEASON_CODE = SEASON_CONFIG.CURRENT_OPERATING_SEASON_CODE;
const OPERATIONAL_MONTH_START = "2025-10";
const OPERATIONAL_MONTH_END = "2026-06";
const OUTLIER_RECAP_LIMIT = 50;
const VALID_ACTIVITY_STATUSES = new Set(["", "submitted", "needs_review"]);

type TopMentorRow = {
  mentor_id: string;
  mentor_name: string | null;
  mentor_email: string | null;
  recap_count: number;
  distinct_mentee_count: number;
};

type TopMentorAccumulatorRow = Omit<TopMentorRow, "distinct_mentee_count"> & {
  menteeIds: Set<string>;
};

type FollowUpRow = {
  mentee_id: string;
  mentee_name: string | null;
  mentee_email: string | null;
  mentee_code: string | null;
  mentor_name: string | null;
  last_recap_date: string | null;
  months_silent: number | string;
};

type RecentRecapRow = MentoringRecap & {
  mentee?: Person;
  mentor?: Person;
};

type OutlierRecapRow = RecentRecapRow & {
  profilePersonId: string | null;
};

function normalizeStatus(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function isActiveMatch(match: Match) {
  return normalizeStatus(match.status) === "active";
}

function isValidRecapActivity(recap: MentoringRecap) {
  return VALID_ACTIVITY_STATUSES.has(normalizeStatus(recap.status));
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function monthDate(month: string) {
  return new Date(`${month}-01T00:00:00Z`);
}

function addMonths(month: string, delta: number) {
  const date = monthDate(month);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 7);
}

function operationalMonths() {
  const months: string[] = [];
  for (let month = OPERATIONAL_MONTH_START; month <= OPERATIONAL_MONTH_END; month = addMonths(month, 1)) {
    months.push(month);
  }
  return months;
}

function monthDiff(laterMonth: string, earlierMonth: string) {
  const later = monthDate(laterMonth);
  const earlier = monthDate(earlierMonth);
  return (later.getUTCFullYear() - earlier.getUTCFullYear()) * 12 + later.getUTCMonth() - earlier.getUTCMonth();
}

function monthFromDate(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}/.test(raw)) return raw.slice(0, 7);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 7);
}

function eventMonth(event: Event) {
  return monthFromDate(event.starts_at);
}

function isOperationalMonth(month: unknown) {
  const value = String(month ?? "").trim();
  return /^\d{4}-\d{2}$/.test(value) && value >= OPERATIONAL_MONTH_START && value <= OPERATIONAL_MONTH_END;
}

function isOutlierRecap(recap: MentoringRecap) {
  return !isOperationalMonth(recap.meeting_month);
}

function percent(numerator: number, denominator: number) {
  if (!denominator) return "0%";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function attendanceRateOverTotal(attended: number, totalParticipants: number) {
  if (!totalParticipants) return "—";
  const value = (attended / totalParticipants) * 100;
  return `${value.toFixed(1).replace(/\.0$/, "")}%`;
}

function selectedSearchMonth(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function sanitizeMonthParam(value: string | string[] | undefined) {
  const raw = selectedSearchMonth(value);
  const match = String(raw ?? "").trim().match(/^(\d{4}-(0[1-9]|1[0-2]))/);
  return match?.[1] ?? null;
}

function latestRecapDate(recaps: MentoringRecap[]) {
  const dates = recaps
    .map((recap) => String(recap.meeting_date ?? "").slice(0, 10))
    .filter(Boolean)
    .sort();
  return dates.at(-1) ?? null;
}

function monthLabel(month: string) {
  return month;
}

export default async function OperationsPage({ searchParams }: { searchParams?: { month?: string | string[] } }) {
  const scopeContext = await getAdminScopeContext();
  const scope = await getScopeFilter(scopeContext);
  const [data, adminUser] = await Promise.all([
    getOperationsData(scope),
    getCurrentAdminUser()
  ]);
  const allowRecapEdit = canEditRecaps(adminUser) && canOperateAnyScope(scopeContext);
  const errors = [
    data.seasons.error,
    data.people.error,
    data.mentees.error,
    data.matches.error,
    data.recaps.error,
    data.events.error,
    data.eventParticipations.error,
    data.kpis.error
  ].filter(Boolean);

  const peopleById = keyById(data.people.data);
  const menteeProfilesByPersonId = new Map(data.mentees.data.filter((profile) => profile.person_id).map((profile) => [profile.person_id, profile]));
  const season = data.seasons.data.find((row) => row.code === SEASON_CODE);
  const seasonMatches = data.matches.data.filter((match) => {
    if (season?.id) return match.season_id === season.id;
    return true;
  });
  const seasonRecaps = data.recaps.data.filter((recap) => {
    if (season?.id) return recap.season_id === season.id;
    return true;
  });
  const seasonEvents = data.events.data.filter((event) => {
    if (season?.id) return event.season_id === season.id;
    return true;
  });
  const seasonEventIds = new Set(seasonEvents.map((event) => event.id));
  const seasonEventParticipations = data.eventParticipations.data.filter((row) => {
    if (season?.id) return row.season_id === season.id || (row.event_id ? seasonEventIds.has(row.event_id) : false);
    return true;
  });

  const validRecaps = seasonRecaps.filter(isValidRecapActivity);
  const validOperationalRecaps = validRecaps.filter((recap) => isOperationalMonth(recap.meeting_month));
  const outlierRecaps = validRecaps.filter(isOutlierRecap);
  const seasonMonths = operationalMonths();
  const validEventMonths = seasonEvents.map(eventMonth).filter((month): month is string => isOperationalMonth(month));
  const monthsWithOperationalData = new Set([
    ...validOperationalRecaps.map((recap) => recap.meeting_month).filter((month): month is string => Boolean(month)),
    ...validEventMonths
  ]);
  const availableMonths = seasonMonths.filter((month) => monthsWithOperationalData.has(month)).sort((a, b) => b.localeCompare(a));
  const nowMonth = currentMonth();
  const latestNonFutureMonth = availableMonths.find((month) => month <= nowMonth);
  const currentOperationalMonth = isOperationalMonth(nowMonth) ? nowMonth : null;
  const seasonLatestClosedMonth = data.latestClosedMonth?.data?.find((row: any) => row.season_id === season?.id);
  const officialClosedMonth = typeof seasonLatestClosedMonth?.latest_closed_month === "string" ? seasonLatestClosedMonth.latest_closed_month : null;

  const rpcSelectedMonth = data.kpis.data?.selectedMonth;
  const defaultMonth = officialClosedMonth ?? rpcSelectedMonth ?? latestNonFutureMonth ?? currentOperationalMonth ?? availableMonths[0] ?? OPERATIONAL_MONTH_START;
  const monthOptions = (availableMonths.length ? availableMonths : seasonMonths).sort((a, b) => b.localeCompare(a));
  const requestedMonth = sanitizeMonthParam(searchParams?.month);
  const selectedMonth = requestedMonth ?? defaultMonth;
  const previousMonth = addMonths(selectedMonth, -1);
  const closedMonth = officialClosedMonth ?? (selectedMonth >= nowMonth ? addMonths(nowMonth, -1) : selectedMonth);
  const closedPreviousMonth = typeof seasonLatestClosedMonth?.previous_closed_month === "string" ? seasonLatestClosedMonth.previous_closed_month : addMonths(closedMonth, -1);

  const activeMatches = seasonMatches.filter(isActiveMatch);
  const activeMatchesWithPeople = activeMatches.filter((match) => match.mentor_person_id && match.mentee_person_id);
  const activeMenteeIds = new Set(activeMatchesWithPeople.map((match) => match.mentee_person_id).filter(Boolean));
  const activeMentorIds = new Set(activeMatchesWithPeople.map((match) => match.mentor_person_id).filter(Boolean));

  const selectedRecaps = seasonRecaps.filter((recap) => isValidRecapActivity(recap) && recap.meeting_month === selectedMonth);
  const previousRecaps = seasonRecaps.filter((recap) => isValidRecapActivity(recap) && recap.meeting_month === previousMonth);
  const selectedMenteeIds = new Set(selectedRecaps.map((recap) => recap.mentee_person_id).filter(Boolean));
  const selectedMentorIds = new Set(selectedRecaps.map((recap) => recap.mentor_person_id).filter(Boolean));
  const previousMenteeIds = new Set(previousRecaps.map((recap) => recap.mentee_person_id).filter(Boolean));

  const closedRecaps = seasonRecaps.filter((recap) => isValidRecapActivity(recap) && recap.meeting_month === closedMonth);
  const closedPreviousRecaps = seasonRecaps.filter((recap) => isValidRecapActivity(recap) && recap.meeting_month === closedPreviousMonth);
  const closedMenteeIds = new Set(closedRecaps.map((recap) => recap.mentee_person_id).filter(Boolean));
  const closedPreviousMenteeIds = new Set(closedPreviousRecaps.map((recap) => recap.mentee_person_id).filter(Boolean));

  const activeClosedMonthCount = Array.from(activeMenteeIds).filter((id) => closedMenteeIds.has(id)).length;
  const missingClosedMonthCount = Array.from(activeMenteeIds).filter((id) => !closedMenteeIds.has(id)).length;
  const followUpTwoMonthCount = Array.from(activeMenteeIds).filter((id) => !closedMenteeIds.has(id) && !closedPreviousMenteeIds.has(id)).length;

  const activeMenteeCount = Array.from(selectedMenteeIds).filter((id) => activeMenteeIds.has(id)).length;
  const mentorWithoutRecapCount = Array.from(activeMentorIds).filter((id) => !selectedMentorIds.has(id)).length;

  const eventsInMonth = seasonEvents.filter((event) => eventMonth(event) === selectedMonth);
  const eventIdsInMonth = new Set(eventsInMonth.map((event) => event.id));
  const eventParticipationsInMonth = seasonEventParticipations.filter((row) => row.event_id && eventIdsInMonth.has(row.event_id));
  const attendedCount = eventParticipationsInMonth.filter((row) => isEventAttendedStatus(row.attendance_status)).length;
  const registeredAbsentCount = eventParticipationsInMonth.filter((row) => isEventAbsenceStatus(row.attendance_status)).length;
  const totalEventParticipantCount = eventParticipationsInMonth.length;
  const notUpdatedAttendanceCount = Math.max(0, totalEventParticipantCount - attendedCount - registeredAbsentCount);
  const hasEventCheckinData = totalEventParticipantCount > 0;
  const rpcKpis = data.kpis.data?.selectedMonth === selectedMonth ? data.kpis.data : null;

  const recapByMonth = Array.from(
    validOperationalRecaps.reduce((counts, recap) => {
      if (!recap.meeting_month || !isOperationalMonth(recap.meeting_month)) return counts;
      counts.set(recap.meeting_month, (counts.get(recap.meeting_month) ?? 0) + 1);
      return counts;
    }, new Map<string, number>(seasonMonths.map((month) => [month, 0])))
  )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => ({ name, value }));

  const topMentorRows: TopMentorRow[] = Array.from(
    selectedRecaps.reduce((rows, recap) => {
      if (!recap.mentor_person_id) return rows;
      const row = rows.get(recap.mentor_person_id) ?? {
        mentor_id: recap.mentor_person_id,
        mentor_name: peopleById.get(recap.mentor_person_id)?.full_name ?? null,
        mentor_email: peopleById.get(recap.mentor_person_id)?.email_primary ?? null,
        recap_count: 0,
        menteeIds: new Set<string>()
      };
      row.recap_count += 1;
      if (recap.mentee_person_id) row.menteeIds.add(recap.mentee_person_id);
      rows.set(recap.mentor_person_id, row);
      return rows;
    }, new Map<string, TopMentorAccumulatorRow>())
  )
    .map(([, row]) => ({ ...row, distinct_mentee_count: row.menteeIds.size }))
    .sort((a, b) => b.recap_count - a.recap_count || b.distinct_mentee_count - a.distinct_mentee_count || String(a.mentor_name ?? "").localeCompare(String(b.mentor_name ?? ""), "vi"))
    .slice(0, 10);

  const recapsByMentee = new Map<string, MentoringRecap[]>();
  for (const recap of validRecaps) {
    if (!recap.mentee_person_id) continue;
    const rows = recapsByMentee.get(recap.mentee_person_id) ?? [];
    rows.push(recap);
    recapsByMentee.set(recap.mentee_person_id, rows);
  }

  const followUpTwoMonthRows: FollowUpRow[] = activeMatchesWithPeople
    .filter((match) => match.mentee_person_id && !closedMenteeIds.has(match.mentee_person_id) && !closedPreviousMenteeIds.has(match.mentee_person_id))
    .map((match) => {
      const menteeId = match.mentee_person_id!;
      const mentee = peopleById.get(menteeId);
      const mentor = match.mentor_person_id ? peopleById.get(match.mentor_person_id) : undefined;
      const menteeProfile = menteeProfilesByPersonId.get(menteeId);
      const recapsBeforeOrInSelectedMonth = (recapsByMentee.get(menteeId) ?? []).filter((recap) => String(recap.meeting_month ?? "") <= selectedMonth);
      const lastDate = latestRecapDate(recapsBeforeOrInSelectedMonth);
      const lastMonth = lastDate ? lastDate.slice(0, 7) : null;
      return {
        mentee_id: menteeId,
        mentee_name: mentee?.full_name ?? null,
        mentee_email: mentee?.email_primary ?? null,
        mentee_code: menteeProfile?.mentee_code ?? null,
        mentor_name: mentor?.full_name ?? null,
        last_recap_date: lastDate,
        months_silent: lastMonth ? Math.max(0, monthDiff(selectedMonth, lastMonth)) : "Chưa có recap"
      };
    })
    .sort((a, b) => {
      const aMonths = typeof a.months_silent === "number" ? a.months_silent : 999;
      const bMonths = typeof b.months_silent === "number" ? b.months_silent : 999;
      return bMonths - aMonths || String(a.mentee_name ?? "").localeCompare(String(b.mentee_name ?? ""), "vi");
    });

  const recentRecapRows: RecentRecapRow[] = selectedRecaps
    .map((recap) => ({
      ...recap,
      mentee: recap.mentee_person_id ? peopleById.get(recap.mentee_person_id) : undefined,
      mentor: recap.mentor_person_id ? peopleById.get(recap.mentor_person_id) : undefined
    }))
    .sort((a, b) => String(b.meeting_date ?? "").localeCompare(String(a.meeting_date ?? "")))
    .slice(0, 30);

  const outlierRecapRows: OutlierRecapRow[] = outlierRecaps
    .map((recap) => {
      const mentee = recap.mentee_person_id ? peopleById.get(recap.mentee_person_id) : undefined;
      const mentor = recap.mentor_person_id ? peopleById.get(recap.mentor_person_id) : undefined;
      return {
        ...recap,
        mentee,
        mentor,
        profilePersonId: recap.mentee_person_id ?? recap.mentor_person_id ?? null
      };
    })
    .sort((a, b) => String(a.meeting_month ?? "").localeCompare(String(b.meeting_month ?? "")) || String(b.meeting_date ?? "").localeCompare(String(a.meeting_date ?? "")))
    .slice(0, OUTLIER_RECAP_LIMIT);

  const healthData = [
    { name: "Mentee active tháng đã đóng", value: activeClosedMonthCount },
    { name: "Chưa có recap tháng gần nhất", value: missingClosedMonthCount },
    { name: "Im lặng 2 tháng liên tiếp / cần follow-up", value: followUpTwoMonthCount }
  ];

  return (
    <>
      <PageHeader title="Operations" description="Dashboard vận hành tháng cho hoạt động mentoring Season 11." />
      {errors.length ? <ErrorBox message="Không tải được một phần dữ liệu operations. Một số chỉ số có thể đang hiển thị 0 hoặc thiếu dữ liệu." /> : null}
      {errors.map((error) => (
        <ErrorBox key={error} message={error} />
      ))}

      <Card className="mb-4">
        <div className="grid gap-4 md:grid-cols-[minmax(220px,320px)_1fr] md:items-end">
          <MonthSelector months={monthOptions} selectedMonth={selectedMonth} />
          <div className="text-sm">
            <p className="text-slate-600 font-medium">Tháng đã chốt: {officialClosedMonth ?? "Chưa có"}</p>
            {selectedMonth > (officialClosedMonth ?? "") ? (
              <p className="text-amber-600 mt-1">Dữ liệu tháng mở không dùng cho KPI chính thức</p>
            ) : null}
            <p className="text-slate-500 mt-1">
              Follow-up là danh sách gợi ý dựa trên dữ liệu recap, chưa phải trạng thái xử lý chính thức.
            </p>
          </div>
        </div>
      </Card>

      {outlierRecaps.length ? (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Có dữ liệu recap nằm ngoài khung mùa vận hành, cần rà soát thủ công. Số recap cần rà soát:{" "}
          <span className="font-semibold">{outlierRecaps.length}</span>.
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Số recap trong tháng" value={rpcKpis?.recapCount ?? selectedRecaps.length} />
        <KpiCard label="Mentee active" value={rpcKpis?.activeMenteeCount ?? selectedMenteeIds.size} />
        <KpiCard label="Mentor active" value={rpcKpis?.activeMentorCount ?? selectedMentorIds.size} />
        <KpiCard label="Tỷ lệ mentee active" value={percent(activeMenteeCount, activeMenteeIds.size)} />
        <KpiCard label="Mentor chưa có recap" value={rpcKpis?.mentorWithoutRecapCount ?? mentorWithoutRecapCount} />
        <KpiCard label="Event/training trong tháng" value={rpcKpis?.eventTrainingCount ?? eventsInMonth.length} />
        <KpiCard label="Lượt tham dự event" value={rpcKpis?.eventAttendanceCount ?? attendedCount} />
        <Card>
          <div className="text-sm text-slate-500">Tỷ lệ tham dự / tổng đăng ký</div>
          <div className="mt-2 text-3xl font-semibold text-vam-ink">{attendanceRateOverTotal(attendedCount, totalEventParticipantCount)}</div>
          {hasEventCheckinData ? (
            <>
              <p className="mt-2 text-xs leading-5 text-slate-500">Bao gồm cả các lượt chưa cập nhật trạng thái trong mẫu số.</p>
              <p className="mt-1 text-xs font-medium text-slate-600">Chưa cập nhật: {notUpdatedAttendanceCount}</p>
            </>
          ) : (
            <p className="mt-2 text-xs leading-5 text-slate-500">Chưa có dữ liệu event/check-in cho tháng đang xem.</p>
          )}
        </Card>
        <KpiCard label="Mentee active tháng đã đóng" value={activeClosedMonthCount} />
        <KpiCard label="Chưa có recap tháng gần nhất" value={missingClosedMonthCount} />
        <KpiCard label="Im lặng 2 tháng liên tiếp / cần follow-up" value={followUpTwoMonthCount} />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto]">
        <nav aria-label="Operations views" className="flex flex-wrap gap-2 rounded-lg border border-vam-line bg-slate-50 p-2">
          <Link href={`/operations/monthly?month=${encodeURIComponent(selectedMonth)}`} className="rounded-md border border-vam-line bg-white px-3 py-2 text-sm font-medium text-vam-ink shadow-sm hover:bg-vam-mint">
            Tổng quan tháng (CEO view)
          </Link>
          <Link href="/operations/intelligence" className="rounded-md border border-vam-line bg-white px-3 py-2 text-sm font-medium text-vam-ink shadow-sm hover:bg-vam-mint">
            Phân tích cộng đồng mentor/mentee
          </Link>
          <Link href="/events" className="rounded-md border border-vam-line bg-white px-3 py-2 text-sm font-medium text-vam-ink shadow-sm hover:bg-vam-mint">
            Quản lý sự kiện & tham gia
          </Link>
        </nav>
        <div aria-label="Operations actions" className="flex flex-wrap gap-2 lg:justify-end">
          <Link href={`/operations/tasks?month=${encodeURIComponent(selectedMonth)}&type=followup_no_recap`} className="rounded-md border border-vam-green/30 bg-white px-3 py-2 text-sm font-medium text-vam-green shadow-soft hover:bg-vam-mint">
            Xem danh sách cần follow-up
          </Link>
          <Link href={`/operations/tasks?month=${encodeURIComponent(selectedMonth)}&type=data_issue`} className="rounded-md border border-vam-green/30 bg-white px-3 py-2 text-sm font-medium text-vam-green shadow-soft hover:bg-vam-mint">
            Xem lỗi dữ liệu
          </Link>
          <Link href={`/operations/tasks?month=${encodeURIComponent(selectedMonth)}&overdue=true`} className="rounded-md border border-vam-green/30 bg-white px-3 py-2 text-sm font-medium text-vam-green shadow-soft hover:bg-vam-mint">
            Công việc quá hạn
          </Link>
          {allowRecapEdit ? (
            <Link href="/recaps/create" className="rounded-md border border-vam-line bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
              Thêm recap thủ công
            </Link>
          ) : null}
        </div>
      </div>

      <section className="mt-6 grid gap-4 xl:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Recap theo tháng</h2>
          {recapByMonth.length ? <BarSummary data={recapByMonth} highlightedName={selectedMonth} tooltipLabelPrefix="Tháng" valueLabel="Số recap" /> : <EmptyState message="Chưa có dữ liệu recap." />}
        </Card>
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Mentee health - {monthLabel(selectedMonth)}</h2>
          <DonutSummary data={healthData} />
        </Card>
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold text-vam-ink">Top mentor theo số recap trong tháng</h2>
        <SimpleTable
          rows={topMentorRows}
          columns={[
            { key: "mentor_name", label: "Mentor", render: (row) => displayText(row.mentor_name) },
            { key: "mentor_email", label: "Email" },
            { key: "recap_count", label: "Số recap" },
            { key: "distinct_mentee_count", label: "Số mentee" },
            { key: "profile", label: "Hồ sơ", render: (row) => <InternalLinkButton href={`/people/${row.mentor_id}`} label="Xem mentor" /> }
          ]}
        />
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold text-vam-ink">Mentee cần follow-up</h2>
        <ProgressiveTable
          rows={followUpTwoMonthRows}
          initialCount={20}
          summaryLabel={`Xem thêm ${Math.max(0, followUpTwoMonthRows.length - 20)} mentee cần follow-up`}
          columns={[
            { key: "mentee_name", label: "Mentee", render: (row) => displayText(row.mentee_name) },
            { key: "mentee_email", label: "Email" },
            { key: "mentee_code", label: "Mã mentee", render: (row) => displayCode(row.mentee_code) },
            { key: "mentor_name", label: "Mentor", render: (row) => displayText(row.mentor_name) },
            { key: "last_recap_date", label: "Recap gần nhất", render: (row) => (row.last_recap_date ? formatDate(row.last_recap_date) : "Chưa có recap") },
            { key: "months_silent", label: "Số tháng silent" },
            { key: "profile", label: "Hồ sơ", render: (row) => <InternalLinkButton href={`/people/${row.mentee_id}`} label="Xem mentee" /> }
          ]}
        />
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold text-vam-ink">Recap gần đây trong tháng</h2>
        <ProgressiveTable
          rows={recentRecapRows}
          initialCount={20}
          summaryLabel={`Xem thêm ${Math.max(0, recentRecapRows.length - 20)} recap`}
          columns={[
            { key: "meeting_date", label: "Ngày gặp", render: (row) => formatDate(row.meeting_date) },
            { key: "mentee", label: "Mentee", render: (row) => displayText(row.mentee?.full_name ?? row.mentee?.email_primary) },
            { key: "mentor", label: "Mentor", render: (row) => displayText(row.mentor?.full_name ?? row.mentor?.email_primary) },
            { key: "recap_url", label: "Link recap", render: (row) => <ExternalLinkButton href={row.recap_url} label="Mở recap" /> },
            { key: "meeting_type", label: "Loại meeting", render: (row) => displayText(row.meeting_type) },
            { key: "captured_by", label: "Nguồn", render: (row) => displayText(row.captured_by ?? row.recap_source) },
            { key: "status", label: "Trạng thái", render: (row) => displayText(row.status) }
          ]}
        />
      </section>

      {outlierRecaps.length ? (
        <section className="mt-6">
          <h2 className="mb-3 text-lg font-semibold text-vam-ink">Recap cần rà soát ngày/tháng</h2>
          <ProgressiveTable
            rows={outlierRecapRows}
            initialCount={20}
            summaryLabel={`Xem thêm ${Math.max(0, outlierRecapRows.length - 20)} recap cần rà soát`}
            columns={[
              { key: "meeting_date", label: "Ngày gặp", render: (row) => formatDate(row.meeting_date) },
              { key: "meeting_month", label: "Tháng ghi nhận", render: (row) => displayText(row.meeting_month) },
              { key: "mentee", label: "Mentee", render: (row) => displayText(row.mentee?.full_name ?? row.mentee?.email_primary) },
              { key: "mentor", label: "Mentor", render: (row) => displayText(row.mentor?.full_name ?? row.mentor?.email_primary) },
              { key: "recap_url", label: "Link recap", render: (row) => <ExternalLinkButton href={row.recap_url} label="Mở recap" /> },
              { key: "recap_note", label: "Ghi chú recap" },
              { key: "admin_notes", label: "Ghi chú admin" },
              {
                key: "profile",
                label: "Hồ sơ",
                render: (row) =>
                  row.profilePersonId ? (
                    <InternalLinkButton href={`/people/${row.profilePersonId}`} label="Xem hồ sơ" />
                  ) : (
                    "-"
                  )
              },
              {
                key: "edit",
                label: "Chỉnh sửa",
                render: (row) =>
                  allowRecapEdit ? (
                    <Link href={`/recaps/${row.id}/edit`} className="inline-flex rounded-md border border-vam-line px-2.5 py-1 text-xs font-medium text-vam-green hover:bg-vam-mint">
                      Sửa
                    </Link>
                  ) : (
                    "-"
                  )
              }
            ]}
          />
          {outlierRecaps.length > OUTLIER_RECAP_LIMIT ? (
            <p className="mt-2 text-sm text-slate-500">Đang hiển thị 50 recap đầu tiên cần rà soát.</p>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
