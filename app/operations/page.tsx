import Link from "next/link";
import { BarSummary, DonutSummary } from "@/components/charts";
import { Card, EmptyState, ErrorBox, ExternalLinkButton, KpiCard, PageHeader, SimpleTable } from "@/components/ui";
import { getOperationsData, keyById } from "@/lib/data";
import type { Event, Match, MentoringRecap, Person } from "@/lib/types";
import { displayCode, displayText, formatDate } from "@/lib/utils";
import { MonthSelector } from "./month-selector";

const SEASON_CODE = "UEHM-S11";
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

function percent(numerator: number, denominator: number) {
  if (!denominator) return "0%";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function attendanceRate(attended: number, registeredAbsent: number) {
  const denominator = attended + registeredAbsent;
  if (!denominator) return "Chưa có dữ liệu";
  return percent(attended, denominator);
}

function selectedSearchMonth(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function sanitizeMonthParam(value: string | string[] | undefined) {
  const raw = selectedSearchMonth(value);
  const match = String(raw ?? "").trim().match(/^(\d{4}-\d{2})/);
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
  const data = await getOperationsData();
  const errors = [
    data.seasons.error,
    data.people.error,
    data.mentees.error,
    data.matches.error,
    data.recaps.error,
    data.events.error,
    data.eventParticipations.error
  ].filter(Boolean);

  const validRecaps = data.recaps.data.filter(isValidRecapActivity);
  const availableMonths = Array.from(new Set(validRecaps.map((recap) => recap.meeting_month).filter((month): month is string => /^\d{4}-\d{2}$/.test(String(month)))))
    .sort((a, b) => b.localeCompare(a));
  const nowMonth = currentMonth();
  const latestNonFutureMonth = availableMonths.find((month) => month <= nowMonth);
  const defaultMonth = latestNonFutureMonth ?? availableMonths[0] ?? nowMonth;
  const monthOptions = availableMonths.length ? availableMonths : [defaultMonth];
  const requestedMonth = sanitizeMonthParam(searchParams?.month);
  const selectedMonth = requestedMonth && monthOptions.includes(requestedMonth) ? requestedMonth : defaultMonth;
  const previousMonth = addMonths(selectedMonth, -1);

  const peopleById = keyById(data.people.data);
  const menteeProfilesByPersonId = new Map(data.mentees.data.filter((profile) => profile.person_id).map((profile) => [profile.person_id, profile]));
  const season = data.seasons.data.find((row) => row.code === SEASON_CODE);
  const activeMatches = data.matches.data.filter((match) => {
    if (!isActiveMatch(match)) return false;
    if (season?.id) return match.season_id === season.id;
    return true;
  });
  const activeMatchesWithPeople = activeMatches.filter((match) => match.mentor_person_id && match.mentee_person_id);
  const activeMenteeIds = new Set(activeMatchesWithPeople.map((match) => match.mentee_person_id).filter(Boolean));
  const activeMentorIds = new Set(activeMatchesWithPeople.map((match) => match.mentor_person_id).filter(Boolean));

  const selectedRecaps = validRecaps.filter((recap) => recap.meeting_month === selectedMonth);
  const previousRecaps = validRecaps.filter((recap) => recap.meeting_month === previousMonth);
  const selectedMenteeIds = new Set(selectedRecaps.map((recap) => recap.mentee_person_id).filter(Boolean));
  const selectedMentorIds = new Set(selectedRecaps.map((recap) => recap.mentor_person_id).filter(Boolean));
  const previousMenteeIds = new Set(previousRecaps.map((recap) => recap.mentee_person_id).filter(Boolean));

  const activeMenteeCount = Array.from(selectedMenteeIds).filter((id) => activeMenteeIds.has(id)).length;
  const silentOneMonthCount = Array.from(activeMenteeIds).filter((id) => !selectedMenteeIds.has(id) && previousMenteeIds.has(id)).length;
  const followUpCount = Array.from(activeMenteeIds).filter((id) => !selectedMenteeIds.has(id) && !previousMenteeIds.has(id)).length;
  const mentorWithoutRecapCount = Array.from(activeMentorIds).filter((id) => !selectedMentorIds.has(id)).length;

  const eventsInMonth = data.events.data.filter((event) => eventMonth(event) === selectedMonth);
  const eventIdsInMonth = new Set(eventsInMonth.map((event) => event.id));
  const eventParticipationsInMonth = data.eventParticipations.data.filter((row) => row.event_id && eventIdsInMonth.has(row.event_id));
  const attendedCount = eventParticipationsInMonth.filter((row) => normalizeStatus(row.attendance_status) === "attended").length;
  const registeredAbsentCount = eventParticipationsInMonth.filter((row) => normalizeStatus(row.attendance_status) === "registered_absent").length;

  const recapByMonth = Array.from(
    validRecaps.reduce((counts, recap) => {
      if (!recap.meeting_month) return counts;
      counts.set(recap.meeting_month, (counts.get(recap.meeting_month) ?? 0) + 1);
      return counts;
    }, new Map<string, number>())
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

  const followUpRows: FollowUpRow[] = activeMatchesWithPeople
    .filter((match) => match.mentee_person_id && !selectedMenteeIds.has(match.mentee_person_id) && !previousMenteeIds.has(match.mentee_person_id))
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

  const healthData = [
    { name: "Active tháng này", value: activeMenteeCount },
    { name: "Silent 1 tháng", value: silentOneMonthCount },
    { name: "Silent 2+ tháng / cần follow-up", value: followUpCount }
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
          <p className="text-sm text-slate-600">
            Follow-up là danh sách gợi ý dựa trên dữ liệu recap, chưa phải trạng thái xử lý chính thức.
          </p>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Số recap trong tháng" value={selectedRecaps.length} />
        <KpiCard label="Mentee active" value={selectedMenteeIds.size} />
        <KpiCard label="Mentor active" value={selectedMentorIds.size} />
        <KpiCard label="Tỷ lệ mentee active" value={percent(activeMenteeCount, activeMenteeIds.size)} />
        <KpiCard label="Mentor chưa có recap" value={mentorWithoutRecapCount} />
        <KpiCard label="Event/training trong tháng" value={eventsInMonth.length} />
        <KpiCard label="Lượt tham dự event" value={attendedCount} />
        <KpiCard label="Tỷ lệ attendance" value={attendanceRate(attendedCount, registeredAbsentCount)} />
        <KpiCard label="Feedback count" value="Chưa triển khai" />
        <KpiCard label="Mentee cần follow-up" value={followUpCount} />
      </div>

      <section className="mt-6 grid gap-4 xl:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Recap theo tháng</h2>
          {recapByMonth.length ? <BarSummary data={recapByMonth} /> : <EmptyState message="Chưa có dữ liệu recap." />}
        </Card>
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Mentee health - {monthLabel(selectedMonth)}</h2>
          <DonutSummary data={healthData} />
          <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-3">
            <div>Active this month: <span className="font-semibold text-vam-ink">{activeMenteeCount}</span></div>
            <div>Silent 1 month: <span className="font-semibold text-vam-ink">{silentOneMonthCount}</span></div>
            <div>Silent 2+ months: <span className="font-semibold text-vam-ink">{followUpCount}</span></div>
          </div>
        </Card>
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold text-vam-ink">Top mentor theo số recap trong tháng</h2>
        <SimpleTable
          rows={topMentorRows}
          columns={[
            { key: "mentor_name", label: "Mentor", render: (row) => displayText(row.mentor_name) },
            { key: "mentor_email", label: "Email", render: (row) => displayText(row.mentor_email) },
            { key: "recap_count", label: "Số recap" },
            { key: "distinct_mentee_count", label: "Số mentee" },
            { key: "profile", label: "Profile", render: (row) => <Link href={`/people/${row.mentor_id}`} className="text-sm font-medium text-vam-green">Xem mentor</Link> }
          ]}
        />
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold text-vam-ink">Mentee cần follow-up</h2>
        <SimpleTable
          rows={followUpRows}
          columns={[
            { key: "mentee_name", label: "Mentee", render: (row) => displayText(row.mentee_name) },
            { key: "mentee_email", label: "Email", render: (row) => displayText(row.mentee_email) },
            { key: "mentee_code", label: "Mã mentee", render: (row) => displayCode(row.mentee_code) },
            { key: "mentor_name", label: "Mentor", render: (row) => displayText(row.mentor_name) },
            { key: "last_recap_date", label: "Recap gần nhất", render: (row) => (row.last_recap_date ? formatDate(row.last_recap_date) : "Chưa có recap") },
            { key: "months_silent", label: "Số tháng silent" },
            { key: "profile", label: "Profile", render: (row) => <Link href={`/people/${row.mentee_id}`} className="text-sm font-medium text-vam-green">Xem mentee</Link> }
          ]}
        />
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold text-vam-ink">Recap gần đây trong tháng</h2>
        <SimpleTable
          rows={recentRecapRows}
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
    </>
  );
}
