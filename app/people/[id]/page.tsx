import Link from "next/link";
import { Card, DetailGrid, EmptyState, ErrorBox, ExternalLinkButton, InternalLinkButton, PageHeader, SimpleTable, TruncatedText } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import { recapStatusLabel } from "@/lib/ui-labels";
import { createCrmNoteFormAction, getCrmNotesByPerson, getPersonSeasonMemberships, type CrmNote, type PersonSeasonMembership } from "@/lib/lifecycle-crm";
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
  getSeasons,
  keyById
} from "@/lib/data";
import { isEventAbsenceStatus, isEventAttendedStatus } from "@/lib/events";
import { canOperateAnyScope, canOperateSeason, getAdminScopeContext, getScopeFilter, resolveCanonicalScope } from "@/lib/program-scope";
import { MembershipLifecycleControls } from "./membership-lifecycle-controls";
import type { Event, EventParticipation, FunctionArea, Industry, Match, MenteeProfile, MentorProfile, MentoringRecap, OperationalTeamAssignment, Person, Program, Season } from "@/lib/types";
import { displayAdminNote, displayCode, displayOptional, displayText, formatDate, text } from "@/lib/utils";
import { SubmitButton } from "@/components/submit-button";
import { canBrowsePeople } from "@/lib/read-access";
import { redirect } from "next/navigation";

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
type SeasonMembershipRow = PersonSeasonMembership & {
  season?: Season;
  program?: Program;
};

type CrmNoteRow = CrmNote & {
  season?: Season;
  program?: Program;
  match?: Match;
};

function actionLink(href: string, label: string) {
  if (label.startsWith("Xem")) return <InternalLinkButton href={href} label={label} />;
  return (
    <Link href={href} className="inline-flex rounded-md border border-vam-line px-2.5 py-1 text-xs font-medium text-vam-green hover:bg-vam-mint">
      {label}
    </Link>
  );
}

function normalizeStatus(status: unknown) {
  return String(status ?? "").trim().toLowerCase();
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

function membershipRoleLabel(value: unknown) {
  const normalized = normalizeStatus(value);
  if (normalized === "mentee") return "Mentee";
  if (normalized === "mentor") return "Mentor";
  if (normalized === "supporter") return "Supporter";
  if (normalized === "reviewer") return "Reviewer";
  if (normalized === "interviewer") return "Interviewer";
  if (normalized === "coreteam") return "Coreteam";
  if (normalized === "advisor") return "Advisor";
  if (normalized === "alumni_mentee") return "Alumni mentee";
  if (normalized === "guest") return "Khách mời";
  return displayText(value);
}

function membershipStatusLabel(value: unknown) {
  const normalized = normalizeStatus(value);
  if (normalized === "invited") return "Được mời";
  if (normalized === "active") return "Đang tham gia";
  if (normalized === "paused") return "Tạm nghỉ";
  if (normalized === "withdrawn") return "Đã rút";
  if (normalized === "completed") return "Hoàn thành";
  if (normalized === "graduated") return "Tốt nghiệp";
  if (normalized === "opted_out") return "Không tiếp tục";
  if (normalized === "cancelled") return "Đã hủy";
  return displayText(value);
}

function crmNoteTypeLabel(value: unknown) {
  const normalized = normalizeStatus(value);
  if (normalized === "contact_outbound") return "Liên hệ đi";
  if (normalized === "contact_inbound") return "Liên hệ đến";
  if (normalized === "re_engagement") return "Tái kết nối";
  if (normalized === "feedback_from_mentor") return "Feedback từ mentor";
  if (normalized === "feedback_from_mentee") return "Feedback từ mentee";
  if (normalized === "feedback_about_mentor") return "Feedback về mentor";
  if (normalized === "feedback_about_mentee") return "Feedback về mentee";
  if (normalized === "program_feedback") return "Feedback chương trình";
  if (normalized === "pause_intent") return "Ý định tạm nghỉ";
  if (normalized === "withdrawal_intent") return "Ý định dừng tham gia";
  if (normalized === "return_intent") return "Ý định quay lại";
  if (normalized === "application_intent") return "Ý định ứng tuyển";
  if (normalized === "observation") return "Quan sát";
  if (normalized === "escalation") return "Can escalate";
  if (normalized === "resolution") return "Kết quả xử lý";
  if (normalized === "handover") return "Bàn giao";
  if (normalized.startsWith("system_")) return "Hệ thống";
  return displayText(value);
}

function visibilityLabel(value: unknown) {
  const normalized = normalizeStatus(value);
  if (normalized === "private") return "Riêng tư";
  if (normalized === "ops_only") return "Ops only";
  if (normalized === "team") return "Team";
  if (normalized === "system") return "Hệ thống";
  return displayText(value);
}

function selectClassName() {
  return "w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink";
}

function inputClassName() {
  return "w-full rounded-md border border-vam-line px-3 py-2 text-sm text-vam-ink";
}

function isMissingOptionalTableError(error: string | null, tableName: string) {
  return Boolean(
    error &&
      error.includes(tableName) &&
      (error.includes("Could not find the table") || error.includes("schema cache"))
  );
}

export default async function PersonDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const adminUser = await getCurrentAdminUser();
  if (!adminUser || !canBrowsePeople(adminUser.role)) redirect("/");

  const scopeContext = await getAdminScopeContext();
  const scope = await getScopeFilter(scopeContext);
  const canOperateUehmS12 = await canOperateSeason(scopeContext, "UEHM-S12");
  const [
    person,
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
    functionLinks,
    seasonMemberships,
    crmNotes
  ] = await Promise.all([
    getPerson(params.id, scope),
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
    getPrograms(scope),
    getIndustries(),
    getFunctionAreas(),
    getMentorProgramParticipations(),
    getMentorIndustryLinks(),
    getMentorFunctionAreaLinks(),
    getPersonSeasonMemberships(params.id, scope),
    getCrmNotesByPerson(params.id, scopeContext, scope)
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
  const matchesById = keyById(matches.data);
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
  const seasonMembershipRows: SeasonMembershipRow[] = seasonMemberships.data.map((membership) => ({
    ...membership,
    season: membership.season_id ? seasonsById.get(membership.season_id) : undefined,
    program: membership.program_id ? programsById.get(membership.program_id) : undefined
  }));
  const crmNoteRows: CrmNoteRow[] = crmNotes.data.map((note) => ({
    ...note,
    season: note.season_id ? seasonsById.get(note.season_id) : undefined,
    program: note.program_id ? programsById.get(note.program_id) : undefined,
    match: note.match_id ? matchesById.get(note.match_id) : undefined
  }));
  const currentMeetingMonth = currentMonth();
  const relatedMatches = Array.from(new Map([...mentorMatches, ...menteeMatches].map((match) => [match.id, match])).values());
  const activeMatchCount = relatedMatches.filter((match) => normalizeStatus(match.status) === "active").length;
  const menteeCount = new Set(mentorMatches.map((match) => match.mentee_person_id).filter(Boolean)).size;
  const mentorCount = new Set(menteeMatches.map((match) => match.mentor_person_id).filter(Boolean)).size;
  const isMentor = Boolean(mentorProfile) || mentorMatches.length > 0 || seasonMembershipRows.some((row) => normalizeStatus(row.role) === "mentor");
  const isMentee = Boolean(menteeProfile) || menteeMatches.length > 0 || seasonMembershipRows.some((row) => normalizeStatus(row.role) === "mentee");
  const hasMentorSide = Boolean(mentorProfile) || mentorMatches.length > 0;
  const hasMenteeSide = Boolean(menteeProfile) || menteeMatches.length > 0;
  const canCreateCrmNote =
    scopeContext.isSuperAdmin ||
    scopeContext.programScopes.some((programScope) => programScope.scopeLevel === "full_access" || programScope.scopeLevel === "operations" || programScope.scopeLevel === "review");
  const applicationsTableMissing = isMissingOptionalTableError(applications.error, "applications");
  const operationalAssignmentsTableMissing = isMissingOptionalTableError(operationalAssignments.error, "operational_team_assignments");
  const error =
    person.error ||
    people.error ||
    mentors.error ||
    mentees.error ||
    (applicationsTableMissing ? null : applications.error) ||
    matches.error ||
    seasons.error ||
    menteeRecaps.error ||
    mentorRecaps.error ||
    eventParticipations.error ||
    events.error ||
    (operationalAssignmentsTableMissing ? null : operationalAssignments.error) ||
    seasonMemberships.error ||
    crmNotes.error;

  if (!person.data) {
    // A scope/lookup failure is not the same as a genuine miss: do not claim the
    // person is absent when we could not verify access in the first place.
    const personLookupFailed = Boolean(person.error);
    return (
      <>
        <PageHeader title={personLookupFailed ? "Không tải được hồ sơ" : "Không tìm thấy hồ sơ"} />
        <ErrorBox message={error} />
        <EmptyState
          message={
            personLookupFailed
              ? "Không xác minh được quyền truy cập hồ sơ này do lỗi hệ thống. Vui lòng thử lại."
              : "Không tìm thấy person_id này trong bảng people."
          }
        />
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
        <h2 className="mb-3 text-base font-semibold text-vam-ink">Trạng thái tham gia</h2>
        <MembershipLifecycleControls personId={params.id} enabled={canOperateAnyScope(scopeContext)} canOperateUehmS12={canOperateUehmS12}
          memberships={seasonMembershipRows.map((row) => ({ id: row.id, role: row.role, status: row.status, intakeBatchCode: row.intake_batch_code, programLabel: String(row.program?.name ?? row.program?.code ?? row.program_id), seasonLabel: String(row.season?.name ?? row.season?.code ?? row.season_id), authorizationScopeLevel: resolveCanonicalScope(scopeContext, row.program?.id, row.program?.code, row.season?.id, row.season?.code), programCode: row.program?.code, seasonCode: row.season?.code, programId: row.program_id, seasonId: row.season_id }))}
          programs={programs.data.map((row) => ({ id: row.id, label: String(row.name ?? row.code ?? row.id), code: row.code ?? undefined, isActive: row.is_active }))}
          seasons={seasons.data.map((row) => ({ id: row.id, label: String(row.name ?? row.code ?? row.id), code: row.code ?? undefined, programId: row.program_id ?? undefined }))} />
        <p className="mt-3 text-xs text-slate-500">Mỗi thao tác thành công ghi person_season_membership_log và admin_audit_log; trạng thái Lịch sử VAM trên trang được làm mới sau thao tác.</p>
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

      <Card className="mb-4">
        <h2 className="mb-3 text-base font-semibold text-vam-ink">Lịch sử VAM</h2>
        {seasonMembershipRows.length > 0 ? (
          <SimpleTable
            rows={seasonMembershipRows}
            columns={[
              { key: "program", label: "Chương trình", render: (row) => displayText(row.program?.name ?? row.program?.code) },
              { key: "season", label: "Mùa", render: (row) => displayCode(row.season?.code ?? row.season?.name) },
              { key: "role", label: "Vai trò", render: (row) => membershipRoleLabel(row.role) },
              { key: "status", label: "Trạng thái", render: (row) => membershipStatusLabel(row.status) },
              { key: "source", label: "Nguồn", render: (row) => displayText(row.source) },
              { key: "start_date", label: "Bắt đầu", render: (row) => formatDate(row.start_date) },
              { key: "end_date", label: "Kết thúc", render: (row) => formatDate(row.end_date) },
              { key: "notes", label: "Ghi chú", render: (row) => displayText(row.notes) }
            ]}
          />
        ) : (
          <EmptyState message="Chưa có lịch sử thành viên theo mùa." />
        )}
      </Card>

      <Card className="mb-4">
        <h2 className="mb-3 text-base font-semibold text-vam-ink">Ghi chú CRM</h2>
        {canCreateCrmNote ? (
          <form action={createCrmNoteFormAction} className="mb-4 grid gap-3 rounded-md border border-vam-line bg-slate-50 p-3">
            <input type="hidden" name="person_id" value={params.id} />
            <input type="hidden" name="owner_admin_user_id" value={adminUser?.id ?? ""} />
            <div className="grid gap-3 md:grid-cols-4">
              <label className="text-xs font-medium text-slate-600">
                Loại ghi chú
                <select name="note_type" defaultValue="contact_outbound" className={selectClassName()}>
                  <option value="contact_outbound">Liên hệ đi</option>
                  <option value="contact_inbound">Liên hệ đến</option>
                  <option value="re_engagement">Tái kết nối</option>
                  <option value="program_feedback">Feedback chương trình</option>
                  <option value="pause_intent">Ý định tạm nghỉ</option>
                  <option value="return_intent">Ý định quay lại</option>
                  <option value="withdrawal_intent">Ý định dừng tham gia</option>
                  <option value="application_intent">Ý định ứng tuyển</option>
                  <option value="observation">Quan sát</option>
                  <option value="handover">Bàn giao</option>
                </select>
              </label>
              <label className="text-xs font-medium text-slate-600">
                Hiển thị
                <select name="visibility" defaultValue="team" className={selectClassName()}>
                  <option value="team">Team</option>
                  <option value="ops_only">Ops only</option>
                  <option value="private">Riêng tư</option>
                </select>
              </label>
              <label className="text-xs font-medium text-slate-600">
                Kênh
                <select name="channel" defaultValue="" className={selectClassName()}>
                  <option value="">-</option>
                  <option value="zalo">Zalo</option>
                  <option value="phone">Điện thoại</option>
                  <option value="email">Email</option>
                  <option value="in_person">Gặp trực tiếp</option>
                  <option value="video_call">Video call</option>
                  <option value="form">Form</option>
                  <option value="event">Sự kiện</option>
                  <option value="other">Khác</option>
                </select>
              </label>
              <label className="text-xs font-medium text-slate-600">
                Ưu tiên
                <select name="priority" defaultValue="normal" className={selectClassName()}>
                  <option value="low">Thấp</option>
                  <option value="normal">Bình thường</option>
                  <option value="high">Cao</option>
                  <option value="urgent">Khẩn cấp</option>
                </select>
              </label>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <label className="text-xs font-medium text-slate-600">
                Program
                <select name="program_id" defaultValue="" className={selectClassName()}>
                  <option value="">-</option>
                  {programs.data.map((program) => (
                    <option key={program.id} value={program.id}>{program.name ?? program.code}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-slate-600">
                Season
                <select name="season_id" defaultValue="" className={selectClassName()}>
                  <option value="">-</option>
                  {seasons.data.map((season) => (
                    <option key={season.id} value={season.id}>{season.code ?? season.name}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-slate-600">
                Match
                <select name="match_id" defaultValue="" className={selectClassName()}>
                  <option value="">-</option>
                  {relatedMatches.map((match) => (
                    <option key={match.id} value={match.id}>{displayCode(seasonsById.get(match.season_id ?? "")?.code)} - {displayText(match.status)}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-slate-600">
                Sentiment
                <select name="sentiment" defaultValue="" className={selectClassName()}>
                  <option value="">-</option>
                  <option value="positive">Positive</option>
                  <option value="neutral">Neutral</option>
                  <option value="concern">Concern</option>
                  <option value="critical">Critical</option>
                </select>
              </label>
            </div>
            <label className="text-xs font-medium text-slate-600">
              Nội dung
              <textarea name="content" required rows={3} className={inputClassName()} />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-xs font-medium text-slate-600">
                Next action
                <input name="next_action_text" className={inputClassName()} />
              </label>
              <label className="text-xs font-medium text-slate-600">
                Hạn next action
                <input name="next_action_due_date" type="date" className={inputClassName()} />
              </label>
            </div>
            <SubmitButton aria-label="Thêm ghi chú CRM" pendingText="Đang lưu..." className="inline-flex w-fit rounded-md bg-vam-green px-3 py-1.5 text-xs font-medium text-white hover:bg-vam-green/90">
              Thêm ghi chú CRM
            </SubmitButton>
          </form>
        ) : null}
        {crmNoteRows.length > 0 ? (
          <SimpleTable
            rows={crmNoteRows}
            columns={[
              { key: "created_at", label: "Ngày", render: (row) => formatDate(row.created_at) },
              { key: "note_type", label: "Loại", render: (row) => crmNoteTypeLabel(row.note_type) },
              { key: "visibility", label: "Hiển thị", render: (row) => visibilityLabel(row.visibility) },
              { key: "scope", label: "Phạm vi", render: (row) => displayText(row.season?.code ?? row.program?.name ?? row.program?.code) },
              { key: "channel", label: "Kênh", render: (row) => displayText(row.channel) },
              { key: "priority", label: "Ưu tiên", render: (row) => displayText(row.priority) },
              { key: "content", label: "Nội dung", render: (row) => <TruncatedText value={row.content} truncate /> },
              { key: "next_action", label: "Next action", render: (row) => displayText(row.next_action_text) },
              { key: "due", label: "Hạn", render: (row) => formatDate(row.next_action_due_date) }
            ]}
          />
        ) : (
          <EmptyState message="Chưa có ghi chú CRM trong phạm vi bạn có thể xem." />
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Thông tin person</h2>
          <DetailGrid
            rows={[
              ["Họ và tên", person.data.full_name],
              ["Email", person.data.email_primary],
              ["Điện thoại", person.data.phone_primary],
              ["Giới tính", person.data.gender],
              ["Nguồn dữ liệu", person.data.source_sheets],
              ["Cờ chất lượng dữ liệu", person.data.data_quality_flags]
            ]}
          />
        </Card>
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Vai trò theo mùa</h2>
          {seasonMembershipRows.length > 0 ? (
            <SimpleTable
              rows={seasonMembershipRows}
              columns={[
                { key: "season", label: "Mùa", render: (row) => displayCode(row.season?.code ?? row.season?.name) },
                { key: "role", label: "Vai trò", render: (row) => membershipRoleLabel(row.role) },
                { key: "status", label: "Trạng thái", render: (row) => membershipStatusLabel(row.status) }
              ]}
            />
          ) : (
            <EmptyState message="Chưa có vai trò theo mùa." />
          )}
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
                  ["Mã mentor", mentorProfile.mentor_code],
                  ["Công ty hiện tại", mentorProfile.company_current],
                  ["Chức danh hiện tại", mentorProfile.title_current],
                  ["Số năm kinh nghiệm", mentorProfile.years_experience_min],
                  ["Mô tả kinh nghiệm", mentorProfile.years_experience_text],
                  ["Mối quan tâm", mentorProfile.interests_text],
                  ["Ghi chú admin", displayAdminNote(mentorProfile.admin_notes)]
                ]}
              />
              <div className="rounded-md border border-vam-line bg-slate-50 px-3 py-2">
                <div className="text-xs font-medium uppercase text-slate-500">Hồ sơ mentor</div>
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
                ["Mã mentee", menteeProfile.mentee_code],
                ["Mã trường", displayCode(menteeProfile.school_code)],
                ["Trường theo dữ liệu gốc", displayText(menteeProfile.school_raw)],
                ["Ngành học", displayText(menteeProfile.major)],
                ["Lớp / khóa", displayText(menteeProfile.class_cohort)],
                ["MSSV", displayText(menteeProfile.mssv)],
                ["GPA hệ 4", displayOptional(menteeProfile.gpa_4)]
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
          {applicationsTableMissing ? (
            <EmptyState message="Chưa có dữ liệu ứng tuyển trong schema staging hiện tại." />
          ) : personApplications.length > 0 ? (
            <SimpleTable
              rows={personApplications.map((application) => ({ ...application, season_code: application.season_id ? seasonsById.get(application.season_id)?.code : "-" }))}
              columns={[
                { key: "season_code", label: "Mùa" },
                { key: "role_applied", label: "Vai trò ứng tuyển" },
                { key: "final_status", label: "Trạng thái cuối" },
                { key: "submitted_at", label: "Ngày nộp", render: (row) => formatDate(row.submitted_at) },
                { key: "acquisition_channel", label: "Kênh biết đến" },
                { key: "application_link", label: "Chi tiết", internalHrefKey: "id", internalHrefPrefix: "/applications/", internalLabel: "Xem chi tiết" }
              ]}
            />
          ) : (
            <EmptyState message="Chưa có hồ sơ ứng tuyển được ghi nhận." />
          )}
        </Card>
        {hasMentorSide ? (
          <Card>
            <h2 className="mb-3 text-base font-semibold text-vam-ink">Mentees đang được mentor này phụ trách</h2>
            {menteesForMentor.length > 0 ? (
              <SimpleTable
                rows={menteesForMentor}
                columns={[
                  { key: "mentee_name", label: "Tên mentee", render: (row) => displayText(row.mentee?.full_name) },
                  { key: "mentee_email", label: "Email mentee", render: (row) => <TruncatedText value={row.mentee?.email_primary} truncate /> },
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
                  { key: "mentor_email", label: "Email mentor", render: (row) => <TruncatedText value={row.mentor?.email_primary} truncate /> },
                  { key: "mentor_code", label: "Mã mentor", render: (row) => displayCode(row.mentorProfile?.mentor_code) },
                  { key: "company_current", label: "Công ty hiện tại", render: (row) => displayText(row.mentorProfile?.company_current) },
                  { key: "title_current", label: "Chức danh hiện tại", render: (row) => displayText(row.mentorProfile?.title_current) },
                  { key: "season_code", label: "Mùa", render: (row) => displayCode(row.season?.code ?? row.season?.name) },
                  { key: "status", label: "Trạng thái", render: (row) => displayText(row.status) },
                  { key: "match_type", label: "Loại match", render: (row) => displayText(row.match_type) },
                  { key: "match_confidence", label: "Độ tin cậy", render: (row) => displayOptional(row.match_confidence) },
                  {
                    key: "mentor_profile",
                    label: "Hồ sơ mentor",
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
                  { key: "issue_flag", label: "Theo dõi", render: (row) => issueLabel(row.issue_flag) },
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
                  { key: "issue_flag", label: "Theo dõi", render: (row) => issueLabel(row.issue_flag) },
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
