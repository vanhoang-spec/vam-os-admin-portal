import Link from "next/link";
import { Card, DetailGrid, EmptyState, ErrorBox, ExternalLinkButton, PageHeader, SimpleTable } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import {
  getApplications,
  getEventParticipationsByPersonId,
  getEvents,
  getFunctionAreas,
  getIndustries,
  getMatches,
  getMenteeProfiles,
  getMentoringRecapsByMenteePersonId,
  getMentoringRecapsByMentorPersonId,
  getMentorFunctionAreaLinks,
  getMentorIndustryLinks,
  getMentorProfiles,
  getMentorProgramParticipations,
  getOperationalTeamAssignmentsByPerson,
  getPeople,
  getPerson,
  getPrograms,
  getRolesForPerson,
  getSeasons,
  keyById
} from "@/lib/data";
import { isEventAbsenceStatus, isEventAttendedStatus } from "@/lib/events";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import type { Event, EventParticipation, FunctionArea, Industry, Match, MenteeProfile, MentorProfile, MentoringRecap, OperationalTeamAssignment, Person, Program, Season } from "@/lib/types";
import { displayAdminNote, displayCode, displayOptional, displayText, formatDate, text } from "@/lib/utils";

type MentorMenteeRow = Match & {
  mentee?: Person;
  menteeProfile?: MenteeProfile;
  season?: Season;
};

type MenteeMentorRow = Match & {
  mentor?: Person;
  mentorProfile?: MentorProfile;
  season?: Season;
};

type MenteeRecapRow = MentoringRecap & {
  mentor?: Person;
};

type MentorRecapRow = MentoringRecap & {
  mentee?: Person;
};

type EventActivityRow = EventParticipation & {
  event?: Event;
};

type OperationalTeamAssignmentRow = OperationalTeamAssignment;

function actionLink(href: string, label: string) {
  return (
    <Link href={href} className="inline-flex rounded-md border border-vam-line px-2.5 py-1 text-xs font-medium text-vam-green hover:bg-vam-mint">
      {label}
    </Link>
  );
}

function normalizeStatus(status: unknown) {
  return String(status ?? "").trim().toLowerCase();
}

function hasRole(rows: Array<Record<string, unknown>>, roleName: string) {
  return rows.some((row) => normalizeStatus(row.role) === roleName);
}

function currentMonth() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}`;
}

function latestDate(rows: Array<{ meeting_date?: string | null }>) {
  const dates = rows.map((row) => row.meeting_date).filter(Boolean).sort().reverse();
  return dates[0] ? formatDate(dates[0]) : "-";
}

function activityKpi(label: string, value: number | string) {
  return (
    <div className="rounded-md border border-vam-line bg-slate-50 px-3 py-2">
      <div className="text-xs font-medium uppercase text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-vam-ink">{value}</div>
    </div>
  );
}

function recapStatusLabel(status: unknown) {
  const normalized = normalizeStatus(status);
  if (normalized === "submitted") return "Đã ghi nhận";
  if (normalized === "needs_review") return "Cần rà soát";
  if (normalized === "invalid") return "Không hợp lệ";
  if (normalized === "duplicate") return "Trùng";
  return displayText(status);
}

function attendanceStatusLabel(status: unknown) {
  const normalized = normalizeStatus(status);
  if (normalized === "attended") return "Tham dự";
  if (normalized === "absent_excused") return "Vắng có phép";
  if (normalized === "absent_unexcused") return "Vắng không phép";
  if (normalized === "registered_no_response") return "Đã đăng ký - chưa phản hồi";
  if (normalized === "walk_in") return "Walk-in";
  if (normalized === "registered_absent") return "Đăng ký nhưng không tham dự";
  return displayText(status);
}

function issueLabel(value: unknown) {
  return value === true ? "Cần theo dõi" : "-";
}

function eventName(row: EventActivityRow) {
  return displayText(row.event?.event_name ?? row.event?.name);
}

function eventDate(row: EventActivityRow) {
  return formatDate(row.event?.event_date ?? row.event?.date ?? row.attendance_date);
}

function sourceRoleGroupLabel(value: unknown) {
  const normalized = normalizeStatus(value);
  if (normalized === "coreteam") return "Coreteam";
  if (normalized === "support_team") return "Support team";
  return displayText(value);
}

function functionalTeamLabel(value: unknown) {
  const normalized = normalizeStatus(value);
  if (normalized === "project_coordination") return "Project Co-ordination";
  if (normalized === "communication_media") return "Communication / Content & Media";
  if (normalized === "event") return "Event";
  if (normalized === "design") return "Design";
  if (normalized === "other") return "Khác";
  if (normalized === "unknown") return "Chưa xác định";
  return displayText(value);
}

function operationalRoleLabel(value: unknown) {
  const normalized = normalizeStatus(value);
  if (normalized === "core_team") return "Coreteam";
  if (normalized === "project_coordination_support") return "Điều phối dự án";
  if (normalized === "communication_support") return "Truyền thông / Nội dung";
  if (normalized === "event_support") return "Sự kiện";
  if (normalized === "design_support") return "Thiết kế";
  if (normalized === "support_team_member") return "Thành viên support team";
  if (normalized === "other") return "Khác";
  return displayText(value);
}

export default async function PersonDetailPage({ params }: { params: { id: string } }) {
  const scope = await getScopeFilter(await getAdminScopeContext());
  const [
    adminUser,
    person,
    roles,
    people,
    mentors,
    mentees,
    applications,
    matches,
    seasons,
    menteeRecaps,
    mentorRecaps,
    eventParticipations,
    events,
    operationalAssignments,
    programs,
    industries,
    functionAreas,
    programLinks,
    industryLinks,
    functionLinks
  ] = await Promise.all([
    getCurrentAdminUser(),
    getPerson(params.id, scope),
    getRolesForPerson(params.id),
    getPeople(scope),
    getMentorProfiles(scope),
    getMenteeProfiles(scope),
    getApplications(scope),
    getMatches(scope),
    getSeasons(scope),
    getMentoringRecapsByMenteePersonId(params.id, scope),
    getMentoringRecapsByMentorPersonId(params.id, scope),
    getEventParticipationsByPersonId(params.id, scope),
    getEvents(scope),
    getOperationalTeamAssignmentsByPerson(params.id),
    getPrograms(),
    getIndustries(),
    getFunctionAreas(),
    getMentorProgramParticipations(),
    getMentorIndustryLinks(),
    getMentorFunctionAreaLinks()
  ]);
  const allowRecapEdit = canEditRecaps(adminUser);
  const personApplications = applications.data.filter((application) => application.person_id === params.id);
  const peopleById = keyById(people.data);
  const seasonsById = keyById(seasons.data);
  const eventsById = keyById(events.data);
  const mentorProfilesByPersonId = new Map(mentors.data.filter((profile) => profile.person_id).map((profile) => [profile.person_id, profile]));
  const menteeProfilesByPersonId = new Map(mentees.data.filter((profile) => profile.person_id).map((profile) => [profile.person_id, profile]));
  const mentorProfile = mentorProfilesByPersonId.get(params.id);
  const menteeProfile = menteeProfilesByPersonId.get(params.id);
  const programsById = new Map<string, Program>(programs.data.map((row) => [row.id, row]));
  const industriesById = new Map<string, Industry>(industries.data.map((row) => [row.id, row]));
  const functionAreasById = new Map<string, FunctionArea>(functionAreas.data.map((row) => [row.id, row]));
  const mentorProgramTags = mentorProfile
    ? programLinks.data
        .filter((link) => link.mentor_profile_id === mentorProfile.id)
        .map((link) => programsById.get(link.program_id))
        .filter((row): row is Program => Boolean(row))
        .sort((a, b) => a.name.localeCompare(b.name, "vi"))
    : [];
  const mentorIndustryTags = mentorProfile
    ? industryLinks.data
        .filter((link) => link.mentor_profile_id === mentorProfile.id)
        .map((link) => industriesById.get(link.industry_id))
        .filter((row): row is Industry => Boolean(row))
        .sort((a, b) => a.name.localeCompare(b.name, "vi"))
    : [];
  const mentorFunctionTags = mentorProfile
    ? functionLinks.data
        .filter((link) => link.mentor_profile_id === mentorProfile.id)
        .map((link) => functionAreasById.get(link.function_area_id))
        .filter((row): row is FunctionArea => Boolean(row))
        .sort((a, b) => a.name.localeCompare(b.name, "vi"))
    : [];
  const mentorMatches = matches.data.filter((match) => match.mentor_person_id === params.id);
  const menteeMatches = matches.data.filter((match) => match.mentee_person_id === params.id);
  const menteesForMentor: MentorMenteeRow[] = mentorMatches.map((match) => ({
    ...match,
    mentee: match.mentee_person_id ? peopleById.get(match.mentee_person_id) : undefined,
    menteeProfile: match.mentee_person_id ? menteeProfilesByPersonId.get(match.mentee_person_id) : undefined,
    season: match.season_id ? seasonsById.get(match.season_id) : undefined
  }));
  const mentorsForMentee: MenteeMentorRow[] = menteeMatches.map((match) => ({
    ...match,
    mentor: match.mentor_person_id ? peopleById.get(match.mentor_person_id) : undefined,
    mentorProfile: match.mentor_person_id ? mentorProfilesByPersonId.get(match.mentor_person_id) : undefined,
    season: match.season_id ? seasonsById.get(match.season_id) : undefined
  }));
  const menteeActivityRows: MenteeRecapRow[] = menteeRecaps.data.map((recap) => ({
    ...recap,
    mentor: recap.mentor_person_id ? peopleById.get(recap.mentor_person_id) : undefined
  }));
  const mentorActivityRows: MentorRecapRow[] = mentorRecaps.data.map((recap) => ({
    ...recap,
    mentee: recap.mentee_person_id ? peopleById.get(recap.mentee_person_id) : undefined
  }));
  const eventActivityRows: EventActivityRow[] = eventParticipations.data.map((participation) => ({
    ...participation,
    event: participation.event_id ? eventsById.get(participation.event_id) : undefined
  }));
  const operationalAssignmentRows: OperationalTeamAssignmentRow[] = operationalAssignments.data;
  const currentMeetingMonth = currentMonth();
  const relatedMatches = Array.from(new Map([...mentorMatches, ...menteeMatches].map((match) => [match.id, match])).values());
  const activeMatchCount = relatedMatches.filter((match) => normalizeStatus(match.status) === "active").length;
  const menteeCount = new Set(mentorMatches.map((match) => match.mentee_person_id).filter(Boolean)).size;
  const mentorCount = new Set(menteeMatches.map((match) => match.mentor_person_id).filter(Boolean)).size;
  const isMentor = hasRole(roles.data, "mentor");
  const isMentee = hasRole(roles.data, "mentee");
  const hasMentorSide = Boolean(mentorProfile) || mentorMatches.length > 0;
  const hasMenteeSide = Boolean(menteeProfile) || menteeMatches.length > 0;
  const error =
    person.error ||
    roles.error ||
    people.error ||
    mentors.error ||
    mentees.error ||
    applications.error ||
    matches.error ||
    seasons.error ||
    menteeRecaps.error ||
    mentorRecaps.error ||
    eventParticipations.error ||
    events.error ||
    operationalAssignments.error;

  if (!person.data) {
    return (
      <>
        <PageHeader title="Không tìm thấy hồ sơ" />
        <ErrorBox message={error} />
        <EmptyState message="Không tìm thấy person_id này trong bảng people." />
      </>
    );
  }

  return (
    <>
      <PageHeader title={text(person.data.full_name, "Hồ sơ cá nhân")} description={text(person.data.email_primary)} />
      <ErrorBox message={error} />

      {allowRecapEdit && (menteeProfile || mentorProfile) ? (
        <div className="mb-4 flex flex-wrap gap-2">
          {menteeProfile ? (
            <Link
              href={`/mentees/${menteeProfile.id}/edit`}
              className="inline-flex items-center rounded-md bg-vam-green px-3 py-1.5 text-xs font-medium text-white hover:bg-vam-green/90"
            >
              Sửa hồ sơ mentee
            </Link>
          ) : null}
          {mentorProfile ? (
            <Link
              href={`/mentors/${mentorProfile.id}/edit`}
              className="inline-flex items-center rounded-md border border-vam-line bg-white px-3 py-1.5 text-xs font-medium text-vam-green hover:bg-vam-mint"
            >
              Sửa hồ sơ mentor
            </Link>
          ) : null}
        </div>
      ) : null}

      <Card className="mb-4">
        <h2 className="mb-3 text-base font-semibold text-vam-ink">Tóm tắt quan hệ mentoring</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {isMentor ? (
            <div className="rounded-md border border-vam-line bg-slate-50 px-3 py-2">
              <div className="text-xs font-medium uppercase text-slate-500">Số mentee đang phụ trách</div>
              <div className="mt-1 text-2xl font-semibold text-vam-ink">{menteeCount}</div>
            </div>
          ) : null}
          {isMentee ? (
            <div className="rounded-md border border-vam-line bg-slate-50 px-3 py-2">
              <div className="text-xs font-medium uppercase text-slate-500">Số mentor của mentee</div>
              <div className="mt-1 text-2xl font-semibold text-vam-ink">{mentorCount}</div>
            </div>
          ) : null}
          <div className="rounded-md border border-vam-line bg-slate-50 px-3 py-2">
            <div className="text-xs font-medium uppercase text-slate-500">Match đang active</div>
            <div className="mt-1 text-2xl font-semibold text-vam-ink">{activeMatchCount}</div>
          </div>
        </div>
      </Card>

      <Card className="mb-4">
        <h2 className="mb-3 text-base font-semibold text-vam-ink">Vai trò vận hành VAM</h2>
        {operationalAssignmentRows.length > 0 ? (
          <SimpleTable
            rows={operationalAssignmentRows}
            columns={[
              { key: "source_role_group", label: "Nhóm", render: (row) => sourceRoleGroupLabel(row.source_role_group) },
              { key: "functional_team", label: "Team chức năng", render: (row) => functionalTeamLabel(row.functional_team) },
              { key: "operational_role", label: "Vai trò vận hành", render: (row) => operationalRoleLabel(row.operational_role) },
              { key: "role_note", label: "Vai trò trong team", render: (row) => displayText(row.role_note) },
              { key: "assigned_scope", label: "Phạm vi phụ trách", render: (row) => displayText(row.assigned_scope) },
              { key: "status", label: "Trạng thái", render: (row) => displayText(row.status) },
              { key: "notes", label: "Ghi chú", render: (row) => displayText(row.notes) }
            ]}
          />
        ) : (
          <EmptyState message="Chưa có vai trò vận hành được ghi nhận." />
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Thông tin person</h2>
          <DetailGrid
            rows={[
              ["full_name", person.data.full_name],
              ["email_primary", person.data.email_primary],
              ["phone_primary", person.data.phone_primary],
              ["gender", person.data.gender],
              ["source_sheets", person.data.source_sheets],
              ["data_quality_flags", person.data.data_quality_flags]
            ]}
          />
        </Card>
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Roles</h2>
          <SimpleTable rows={roles.data} columns={[{ key: "role", label: "role" }, { key: "status", label: "status" }, { key: "notes", label: "notes" }]} />
        </Card>
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-vam-ink">Mentor profile</h2>
            {mentorProfile && allowRecapEdit ? (
              <Link
                href={`/mentors/${mentorProfile.id}/edit`}
                className="inline-flex w-fit rounded-md bg-vam-green px-3 py-1.5 text-xs font-medium text-white hover:bg-vam-green/90"
              >
                Sửa hồ sơ
              </Link>
            ) : null}
          </div>
          {mentorProfile ? (
            <div className="grid gap-3">
              <div className="rounded-md border border-vam-line bg-slate-50 px-3 py-2">
                <div className="text-xs font-medium uppercase text-slate-500">Chương trình mentoring</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {mentorProgramTags.length === 0 ? (
                    <span className="text-xs text-slate-500">Chưa gán chương trình.</span>
                  ) : (
                    mentorProgramTags.map((row) => (
                      <span key={row.id} className="inline-flex rounded bg-vam-mint px-2 py-0.5 text-xs font-medium text-vam-green">
                        {row.name}
                      </span>
                    ))
                  )}
                </div>
              </div>
              <div className="rounded-md border border-vam-line bg-slate-50 px-3 py-2">
                <div className="text-xs font-medium uppercase text-slate-500">Ngành nghề</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {mentorIndustryTags.length === 0 ? (
                    <span className="text-xs text-slate-500">Chưa có ngành.</span>
                  ) : (
                    mentorIndustryTags.map((row) => (
                      <span key={row.id} className="inline-flex rounded bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">
                        {row.name}
                      </span>
                    ))
                  )}
                </div>
              </div>
              <div className="rounded-md border border-vam-line bg-slate-50 px-3 py-2">
                <div className="text-xs font-medium uppercase text-slate-500">Chức năng chuyên môn</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {mentorFunctionTags.length === 0 ? (
                    <span className="text-xs text-slate-500">Chưa có chức năng.</span>
                  ) : (
                    mentorFunctionTags.map((row) => (
                      <span key={row.id} className="inline-flex rounded bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
                        {row.name}
                      </span>
                    ))
                  )}
                </div>
              </div>
              <DetailGrid
                rows={[
                  ["mentor_code", mentorProfile.mentor_code],
                  ["company_current", mentorProfile.company_current],
                  ["title_current", mentorProfile.title_current],
                  ["years_experience_min", mentorProfile.years_experience_min],
                  ["years_experience_text", mentorProfile.years_experience_text],
                  ["interests_text", mentorProfile.interests_text],
                  ["admin_notes", displayAdminNote(mentorProfile.admin_notes)]
                ]}
              />
              <div className="rounded-md border border-vam-line bg-slate-50 px-3 py-2">
                <div className="text-xs font-medium uppercase text-slate-500">profile mentor</div>
                <div className="mt-1">
                  <ExternalLinkButton href={mentorProfile.bio_url} label="Xem profile mentor" />
                </div>
              </div>
            </div>
          ) : (
            <EmptyState message="Người này chưa có mentor profile." />
          )}
        </Card>
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-vam-ink">Mentee profile</h2>
            {menteeProfile && allowRecapEdit ? (
              <Link
                href={`/mentees/${menteeProfile.id}/edit`}
                className="inline-flex w-fit rounded-md bg-vam-green px-3 py-1.5 text-xs font-medium text-white hover:bg-vam-green/90"
              >
                Sửa hồ sơ mentee
              </Link>
            ) : null}
          </div>
          {menteeProfile ? (
            <DetailGrid
              rows={[
                ["mentee_code", menteeProfile.mentee_code],
                ["school_code", displayCode(menteeProfile.school_code)],
                ["school_raw", displayText(menteeProfile.school_raw)],
                ["major", displayText(menteeProfile.major)],
                ["class_cohort", displayText(menteeProfile.class_cohort)],
                ["mssv", displayText(menteeProfile.mssv)],
                ["gpa_4", displayOptional(menteeProfile.gpa_4)]
              ]}
            />
          ) : (
            <EmptyState message="Người này chưa có mentee profile." />
          )}
        </Card>
      </div>
      <div className="mt-4 grid gap-4">
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Applications</h2>
          <SimpleTable
            rows={personApplications.map((application) => ({ ...application, season_code: application.season_id ? seasonsById.get(application.season_id)?.code : "-" }))}
            columns={[
              { key: "season_code", label: "season_code" },
              { key: "role_applied", label: "role_applied" },
              { key: "final_status", label: "final_status" },
              { key: "submitted_at", label: "submitted_at", render: (row) => formatDate(row.submitted_at) },
              { key: "acquisition_channel", label: "acquisition_channel" },
              { key: "application_link", label: "Chi tiết", internalHrefKey: "id", internalHrefPrefix: "/applications/", internalLabel: "Xem chi tiết" }
            ]}
          />
        </Card>
        {hasMentorSide ? (
          <Card>
            <h2 className="mb-3 text-base font-semibold text-vam-ink">Mentees đang được mentor này phụ trách</h2>
            {menteesForMentor.length > 0 ? (
              <SimpleTable
                rows={menteesForMentor}
                columns={[
                  { key: "mentee_name", label: "Tên mentee", render: (row) => displayText(row.mentee?.full_name) },
                  { key: "mentee_email", label: "Email mentee", render: (row) => displayText(row.mentee?.email_primary) },
                  { key: "mentee_code", label: "Mã mentee", render: (row) => displayCode(row.menteeProfile?.mentee_code) },
                  { key: "school_code", label: "Mã trường", render: (row) => displayCode(row.menteeProfile?.school_code) },
                  { key: "major", label: "Ngành học", render: (row) => displayText(row.menteeProfile?.major) },
                  { key: "season_code", label: "Mùa", render: (row) => displayCode(row.season?.code ?? row.season?.name) },
                  { key: "status", label: "Trạng thái", render: (row) => displayText(row.status) },
                  { key: "match_type", label: "Loại match", render: (row) => displayText(row.match_type) },
                  { key: "match_confidence", label: "Độ tin cậy", render: (row) => displayOptional(row.match_confidence) },
                  { key: "match_link", label: "Match", render: (row) => actionLink(`/matches/${row.id}`, "Xem match") },
                  {
                    key: "mentee_link",
                    label: "Mentee",
                    render: (row) => (row.mentee_person_id ? actionLink(`/people/${row.mentee_person_id}`, "Xem mentee") : text(null))
                  }
                ]}
              />
            ) : (
              <EmptyState message="Chưa có mentee nào được ghép với mentor này." />
            )}
          </Card>
        ) : null}
        {hasMenteeSide ? (
          <Card>
            <h2 className="mb-3 text-base font-semibold text-vam-ink">Mentor của mentee này</h2>
            {mentorsForMentee.length > 0 ? (
              <SimpleTable
                rows={mentorsForMentee}
                columns={[
                  { key: "mentor_name", label: "Tên mentor", render: (row) => displayText(row.mentor?.full_name) },
                  { key: "mentor_email", label: "Email mentor", render: (row) => displayText(row.mentor?.email_primary) },
                  { key: "mentor_code", label: "Mã mentor", render: (row) => displayCode(row.mentorProfile?.mentor_code) },
                  { key: "company_current", label: "Công ty hiện tại", render: (row) => displayText(row.mentorProfile?.company_current) },
                  { key: "title_current", label: "Chức danh hiện tại", render: (row) => displayText(row.mentorProfile?.title_current) },
                  { key: "season_code", label: "Mùa", render: (row) => displayCode(row.season?.code ?? row.season?.name) },
                  { key: "status", label: "Trạng thái", render: (row) => displayText(row.status) },
                  { key: "match_type", label: "Loại match", render: (row) => displayText(row.match_type) },
                  { key: "match_confidence", label: "Độ tin cậy", render: (row) => displayOptional(row.match_confidence) },
                  {
                    key: "mentor_profile",
                    label: "Profile mentor",
                    render: (row) => <ExternalLinkButton href={row.mentorProfile?.bio_url} label="Xem profile mentor" />
                  },
                  { key: "match_link", label: "Match", render: (row) => actionLink(`/matches/${row.id}`, "Xem match") },
                  {
                    key: "mentor_link",
                    label: "Mentor",
                    render: (row) => (row.mentor_person_id ? actionLink(`/people/${row.mentor_person_id}`, "Xem mentor") : text(null))
                  }
                ]}
              />
            ) : (
              <EmptyState message="Chưa có mentor nào được ghép với mentee này." />
            )}
          </Card>
        ) : null}
        {hasMenteeSide ? (
          <Card>
            <h2 className="mb-3 text-base font-semibold text-vam-ink">Hoạt động mentoring</h2>
            <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {activityKpi("Tổng số recap", menteeActivityRows.length)}
              {activityKpi("Ngày gặp gần nhất", latestDate(menteeActivityRows))}
              {activityKpi("Recap tháng hiện tại", menteeActivityRows.some((row) => row.meeting_month === currentMeetingMonth) ? "Có" : "Chưa có")}
              {activityKpi("Issue cần theo dõi", menteeActivityRows.filter((row) => row.issue_flag === true).length)}
            </div>
            {menteeActivityRows.length > 0 ? (
              <SimpleTable
                rows={menteeActivityRows}
                columns={[
                  { key: "meeting_month", label: "Tháng", render: (row) => displayText(row.meeting_month) },
                  { key: "meeting_date", label: "Ngày gặp", render: (row) => formatDate(row.meeting_date) },
                  { key: "mentor", label: "Mentor", render: (row) => displayText(row.mentor?.full_name ?? row.mentor?.email_primary) },
                  { key: "recap_url", label: "Link recap", render: (row) => <ExternalLinkButton href={row.recap_url} label="Xem recap" /> },
                  { key: "recap_note", label: "Ghi chú", render: (row) => displayText(row.recap_note) },
                  { key: "issue_flag", label: "Issue", render: (row) => issueLabel(row.issue_flag) },
                  { key: "status", label: "Trạng thái", render: (row) => recapStatusLabel(row.status) },
                  { key: "edit", label: "Sửa", render: (row) => (allowRecapEdit ? actionLink(`/recaps/${row.id}/edit`, "Sửa") : "-") }
                ]}
              />
            ) : (
              <EmptyState message="Chưa có hoạt động được ghi nhận." />
            )}
          </Card>
        ) : null}
        {hasMentorSide ? (
          <Card>
            <h2 className="mb-3 text-base font-semibold text-vam-ink">Hoạt động mentor</h2>
            <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {activityKpi("Tổng số buổi gặp được ghi nhận", mentorActivityRows.length)}
              {activityKpi("Số mentee có recap", new Set(mentorActivityRows.map((row) => row.mentee_person_id).filter(Boolean)).size)}
              {activityKpi("Ngày hoạt động gần nhất", latestDate(mentorActivityRows))}
              {activityKpi("Issue cần theo dõi", mentorActivityRows.filter((row) => row.issue_flag === true).length)}
            </div>
            {mentorActivityRows.length > 0 ? (
              <SimpleTable
                rows={mentorActivityRows}
                columns={[
                  { key: "meeting_month", label: "Tháng", render: (row) => displayText(row.meeting_month) },
                  { key: "meeting_date", label: "Ngày gặp", render: (row) => formatDate(row.meeting_date) },
                  { key: "mentee", label: "Mentee", render: (row) => displayText(row.mentee?.full_name ?? row.mentee?.email_primary) },
                  { key: "recap_url", label: "Link recap", render: (row) => <ExternalLinkButton href={row.recap_url} label="Xem recap" /> },
                  { key: "recap_note", label: "Ghi chú", render: (row) => displayText(row.recap_note) },
                  { key: "issue_flag", label: "Issue", render: (row) => issueLabel(row.issue_flag) },
                  { key: "status", label: "Trạng thái", render: (row) => recapStatusLabel(row.status) },
                  { key: "edit", label: "Sửa", render: (row) => (allowRecapEdit ? actionLink(`/recaps/${row.id}/edit`, "Sửa") : "-") }
                ]}
              />
            ) : (
              <EmptyState message="Chưa có hoạt động được ghi nhận." />
            )}
          </Card>
        ) : null}
        {hasMentorSide || hasMenteeSide ? (
          <Card>
            <h2 className="mb-3 text-base font-semibold text-vam-ink">Hoạt động sự kiện</h2>
            <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {activityKpi("Tổng sự kiện ghi nhận", eventActivityRows.length)}
              {activityKpi("Tham dự", eventActivityRows.filter((row) => isEventAttendedStatus(row.attendance_status)).length)}
              {activityKpi("Vắng", eventActivityRows.filter((row) => isEventAbsenceStatus(row.attendance_status)).length)}
            </div>
            {eventActivityRows.length > 0 ? (
              <SimpleTable
                rows={eventActivityRows}
                columns={[
                  { key: "event", label: "Sự kiện", render: (row) => eventName(row) },
                  { key: "event_date", label: "Ngày", render: (row) => eventDate(row) },
                  { key: "role_at_event", label: "Vai trò", render: (row) => displayText(row.role_at_event) },
                  { key: "attendance_status", label: "Trạng thái tham dự", render: (row) => attendanceStatusLabel(row.attendance_status) },
                  { key: "recap_url", label: "Link recap", render: (row) => <ExternalLinkButton href={row.recap_url} label="Xem recap" /> },
                  { key: "admin_notes", label: "Ghi chú", render: (row) => displayText(row.admin_notes ?? row.excuse_reason) }
                ]}
              />
            ) : (
              <EmptyState message="Chưa có hoạt động được ghi nhận." />
            )}
          </Card>
        ) : null}
      </div>
      <div className="mt-4">
        <Link href="/people" className="text-sm font-medium text-vam-green">Quay lại People</Link>
      </div>
    </>
  );
}
