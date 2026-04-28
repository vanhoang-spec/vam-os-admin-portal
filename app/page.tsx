import Link from "next/link";
import { BarSummary, DonutSummary } from "@/components/charts";
import { Card, ErrorBox, KpiCard, PageHeader, SimpleTable } from "@/components/ui";
import { getDashboardData, keyById } from "@/lib/data";
import { displayCode, displayText } from "@/lib/utils";

function statusKey(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function isActive(value: unknown) {
  return statusKey(value) === "active";
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
  const data = await getDashboardData();
  const errors = [
    data.people.error,
    data.mentors.error,
    data.mentees.error,
    data.applications.error,
    data.matches.error,
    data.counts.people.error,
    data.counts.mentors.error,
    data.counts.mentees.error,
    data.counts.applications.error,
    data.counts.matches.error,
    data.counts.activeMatches.error,
    data.duplicateEmails.error,
    data.activeMissing.error
  ].filter(Boolean);

  const peopleById = keyById(data.people.data);
  const activeMatches = data.matches.data.filter((match) => isActive(match.status));
  const activeMatchesWithMentorAndMentee = activeMatches.filter((match) => match.mentor_person_id && match.mentee_person_id);
  const activeMenteeIds = new Set(activeMatchesWithMentorAndMentee.map((match) => match.mentee_person_id).filter(Boolean));
  const activeMentorIds = new Set(activeMatchesWithMentorAndMentee.map((match) => match.mentor_person_id).filter(Boolean));
  const activeMenteeCountByMentor = new Map<string, Set<string>>();

  for (const match of activeMatchesWithMentorAndMentee) {
    if (!match.mentor_person_id || !match.mentee_person_id) continue;
    const menteeIds = activeMenteeCountByMentor.get(match.mentor_person_id) ?? new Set<string>();
    menteeIds.add(match.mentee_person_id);
    activeMenteeCountByMentor.set(match.mentor_person_id, menteeIds);
  }

  const menteesWithMentor = activeMenteeIds.size;
  const menteesWithoutMentor = Math.max(0, data.counts.mentees.data - menteesWithMentor);
  const mentorsWithAssignedMentees = activeMentorIds.size;
  const mentorsWithoutAssignedMentees = Math.max(0, data.counts.mentors.data - mentorsWithAssignedMentees);
  const peopleMissingPhone = data.people.data.filter((person) => isBlank(person.phone_primary)).length;
  const menteesMissingSchool = data.mentees.data.filter((mentee) => isMissingSchoolCode(mentee.school_code)).length;
  const mentorsMissingBioUrl = data.mentors.data.filter((mentor) => isBlank(mentor.bio_url)).length;
  const activeMatchesMissingMentorOrMentee = data.activeMissing.data;
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

  const mentorBuckets = [
    { name: "0 mentee", value: mentorsWithoutAssignedMentees },
    { name: "1 mentee", value: data.mentors.data.filter((mentor) => mentor.person_id && (activeMenteeCountByMentor.get(mentor.person_id)?.size ?? 0) === 1).length },
    { name: "2 mentees", value: data.mentors.data.filter((mentor) => mentor.person_id && (activeMenteeCountByMentor.get(mentor.person_id)?.size ?? 0) === 2).length },
    { name: "3+ mentees", value: data.mentors.data.filter((mentor) => mentor.person_id && (activeMenteeCountByMentor.get(mentor.person_id)?.size ?? 0) >= 3).length }
  ];

  const warningRows = [
    { label: "People thiếu số điện thoại", count: peopleMissingPhone, href: "/people" },
    { label: "Mentee thiếu school_code hoặc school_code OTHER/blank", count: menteesMissingSchool, href: "/mentees" },
    { label: "Mentor thiếu bio_url", count: mentorsMissingBioUrl, href: "/mentors" },
    { label: "Mentee chưa có active mentor", count: menteesWithoutMentor, href: "/mentees?has_mentor=no" },
    { label: "Active match thiếu mentor/mentee", count: activeMatchesMissingMentorOrMentee, href: "/matches" },
    { label: "Email trùng cần rà soát", count: data.duplicateEmails.data, href: "/people" }
  ];

  return (
    <>
      <PageHeader title="Dashboard" description="Tổng quan vận hành VAM OS MVP cho UEH Mentoring Season 11." />
      {errors.length ? <ErrorBox message="Không tải được một phần dữ liệu dashboard. Các chỉ số liên quan có thể đang hiển thị 0 hoặc thiếu dữ liệu." /> : null}
      {errors.map((error) => (
        <ErrorBox key={error} message={error} />
      ))}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Tổng thành viên" value={data.counts.people.data} />
        <KpiCard label="Mentor" value={data.counts.mentors.data} />
        <KpiCard label="Mentee" value={data.counts.mentees.data} />
        <KpiCard label="Ứng tuyển" value={data.counts.applications.data} />
        <KpiCard label="Tổng match" value={data.counts.matches.data} />
        <KpiCard label="Match active" value={data.counts.activeMatches.data} />
        <KpiCard label="Mentee đã có mentor" value={menteesWithMentor} />
        <KpiCard label="Mentee chưa có mentor" value={menteesWithoutMentor} />
        <KpiCard label="Mentor đang phụ trách mentee" value={mentorsWithAssignedMentees} />
        <KpiCard label="Mentor chưa có mentee" value={mentorsWithoutAssignedMentees} />
      </div>

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold text-vam-ink">Tình trạng vận hành</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Tỷ lệ mentee đã có mentor" value={percent(menteesWithMentor, data.counts.mentees.data)} />
          <KpiCard label="Tỷ lệ mentor đang hoạt động" value={percent(mentorsWithAssignedMentees, data.counts.mentors.data)} />
          <KpiCard label="Số mentee trung bình / mentor active" value={average(menteesWithMentor, mentorsWithAssignedMentees)} />
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
          <DonutSummary data={countByLabel(data.matches.data, "status")} />
        </Card>
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Ứng tuyển theo final_status</h2>
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
            { key: "full_name", label: "Mentor name" },
            { key: "email_primary", label: "Email" },
            { key: "company_current", label: "Company", displayKey: "company_current_display" },
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
