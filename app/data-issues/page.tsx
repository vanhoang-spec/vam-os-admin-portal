import Link from "next/link";
import { Card, EmptyState, ErrorBox, KpiCard, PageHeader, SimpleTable } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import { getApplications, getMatches, getMenteeProfiles, getMentorProfiles, getPeople, keyById } from "@/lib/data";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import type { Application, Match, MenteeProfile, MentorProfile, Person } from "@/lib/types";
import { displayCode, displayText, formatDate } from "@/lib/utils";

function statusKey(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function isPlaceholder(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return !normalized || normalized === "-" || normalized === "0" || normalized === "nan" || normalized === "null" || normalized === "undefined";
}

function isMissingSchool(value: unknown) {
  return isPlaceholder(value) || statusKey(value) === "other";
}

function shortId(value: unknown) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, 8) : "-";
}

const ISSUE_CONFIG = {
  missing_phone: {
    label: "Người dùng thiếu số điện thoại",
    sectionId: "issue-missing-phone"
  },
  applications_missing_identity: {
    label: "Đơn ứng tuyển thiếu tên/email",
    sectionId: "issue-applications-missing-identity"
  },
  missing_school_code: {
    label: "Mentee cần rà soát trường học",
    sectionId: "issue-missing-school-code"
  },
  missing_mentor_bio_url: {
    label: "Mentor thiếu profile link",
    sectionId: "issue-missing-mentor-bio-url"
  },
  mentee_without_active_mentor: {
    label: "Mentee chưa có mentor đang hoạt động",
    sectionId: "issue-mentee-without-active-mentor"
  },
  active_match_missing_person: {
    label: "Match lỗi (đang hoạt động)",
    sectionId: "issue-active-match-missing-person"
  },
  duplicate_email: {
    label: "Email trùng",
    sectionId: "issue-duplicate-email"
  }
} as const;

type IssueKey = keyof typeof ISSUE_CONFIG;

function isIssueKey(value: unknown): value is IssueKey {
  return typeof value === "string" && value in ISSUE_CONFIG;
}

function shouldOpenIssue(selectedIssue: IssueKey | null, issueKey: IssueKey) {
  return !selectedIssue || selectedIssue === issueKey;
}

function IssueSection<T>({
  title,
  rows,
  columns,
  issueKey,
  selectedIssue
}: {
  title: string;
  rows: T[];
  columns: React.ComponentProps<typeof SimpleTable<T>>["columns"];
  issueKey: IssueKey;
  selectedIssue: IssueKey | null;
}) {
  const isSelected = selectedIssue === issueKey;
  return (
    <details
      id={ISSUE_CONFIG[issueKey].sectionId}
      open={shouldOpenIssue(selectedIssue, issueKey)}
      className={`scroll-mt-6 rounded-lg border bg-white p-4 shadow-soft ${isSelected ? "border-vam-green ring-2 ring-vam-mint" : "border-vam-line"}`}
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-vam-ink">{title}</h2>
        <span className="rounded-md border border-vam-line bg-slate-50 px-2 py-1 text-xs font-medium text-slate-600">{rows.length} vấn đề</span>
      </summary>
      <div className="mt-3">
        {rows.length ? <SimpleTable rows={rows} columns={columns} /> : <EmptyState message="Không có vấn đề cần rà soát." />}
      </div>
    </details>
  );
}

export default async function DataIssuesPage({ searchParams }: { searchParams?: { issue?: string } }) {
  const selectedIssue = isIssueKey(searchParams?.issue) ? searchParams.issue : null;
  const scopeContext = await getAdminScopeContext();
  const scope = await getScopeFilter(scopeContext);
  const [people, applications, mentees, mentors, matches, adminUser] = await Promise.all([
    getPeople(scope),
    getApplications(scope),
    getMenteeProfiles(scope),
    getMentorProfiles(scope),
    getMatches(scope),
    getCurrentAdminUser()
  ]);
  const allowEdit = canEditRecaps(adminUser);
  const peopleById = keyById(people.data);
  const activeMatches = matches.data.filter((match) => statusKey(match.status) === "active");
  const activeMenteeIds = new Set(activeMatches.map((match) => match.mentee_person_id).filter(Boolean));

  const peopleMissingPhone = people.data
    .filter((person) => isPlaceholder(person.phone_primary))
    .map((person) => ({
      ...person,
      full_name_display: displayText(person.full_name),
      email_primary_display: displayText(person.email_primary),
      phone_primary_display: displayText(person.phone_primary),
      source_sheets_display: displayText(person.source_sheets)
    }));

  const applicationsMissingIdentity = applications.data
    .map((application) => {
      const person = application.person_id ? peopleById.get(application.person_id) : undefined;
      return {
        ...application,
        person,
        short_application_id: shortId(application.id),
        short_person_id: shortId(application.person_id),
        full_name_display: displayText(person?.full_name),
        email_primary_display: displayText(person?.email_primary),
        final_status_display: displayText(application.final_status),
        submitted_at_display: formatDate(application.submitted_at)
      };
    })
    .filter((row) => isPlaceholder(row.person?.full_name) || isPlaceholder(row.person?.email_primary));

  const menteesMissingSchool = mentees.data
    .filter((mentee) => isMissingSchool(mentee.school_code))
    .map((mentee) => {
      const person = mentee.person_id ? peopleById.get(mentee.person_id) : undefined;
      return {
        ...mentee,
        full_name_display: displayText(person?.full_name),
        email_primary_display: displayText(person?.email_primary),
        mentee_code_display: displayCode(mentee.mentee_code),
        school_code_display: displayCode(mentee.school_code),
        school_raw_display: displayText(mentee.school_raw),
        major_display: displayText(mentee.major)
      };
    });

  const mentorsMissingBio = mentors.data
    .filter((mentor) => isPlaceholder(mentor.bio_url))
    .map((mentor) => {
      const person = mentor.person_id ? peopleById.get(mentor.person_id) : undefined;
      return {
        ...mentor,
        full_name_display: displayText(person?.full_name),
        email_primary_display: displayText(person?.email_primary),
        mentor_code_display: displayCode(mentor.mentor_code),
        company_current_display: displayText(mentor.company_current),
        title_current_display: displayText(mentor.title_current)
      };
    });

  const menteesWithoutActiveMentor = mentees.data
    .filter((mentee) => !mentee.person_id || !activeMenteeIds.has(mentee.person_id))
    .map((mentee) => {
      const person = mentee.person_id ? peopleById.get(mentee.person_id) : undefined;
      return {
        ...mentee,
        full_name_display: displayText(person?.full_name),
        email_primary_display: displayText(person?.email_primary),
        mentee_code_display: displayCode(mentee.mentee_code),
        school_code_display: displayCode(mentee.school_code),
        major_display: displayText(mentee.major)
      };
    });

  const activeMatchMissingPerson = activeMatches
    .filter((match) => !match.mentor_person_id || !match.mentee_person_id)
    .map((match) => ({
      ...match,
      short_match_id: shortId(match.id),
      status_display: displayText(match.status),
      match_type_display: displayText(match.match_type),
      mentor_person_id_display: displayText(match.mentor_person_id),
      mentee_person_id_display: displayText(match.mentee_person_id)
    }));

  const emails = new Map<string, Person[]>();
  for (const person of people.data) {
    const email = String(person.email_primary ?? "").trim().toLowerCase();
    if (!email || isPlaceholder(email)) continue;
    emails.set(email, [...(emails.get(email) ?? []), person]);
  }
  const duplicateEmails = Array.from(emails.entries())
    .filter(([, rows]) => rows.length > 1)
    .map(([email, rows]) => ({
      email_primary: email,
      duplicate_count: rows.length,
      related_people: rows.map((person) => ({ id: person.id, name: displayText(person.full_name) }))
    }));

  const errors = [people.error, applications.error, mentees.error, mentors.error, matches.error].filter(Boolean);

  return (
    <>
      <PageHeader title="Rà soát dữ liệu" description="Các vấn đề dữ liệu cần rà soát từ dữ liệu Supabase hiện tại." />
      <div className="mb-4 rounded-lg border border-vam-line bg-white p-4 text-sm text-slate-600 shadow-soft">
        <p className="mb-3">
          Trang này giúp rà soát dữ liệu cần làm sạch. Ở MVP hiện tại, các vấn đề được tính động từ dữ liệu Supabase; chức năng sửa trực tiếp sẽ bổ sung ở giai đoạn sau.
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-vam-line pt-3">
          <p className="text-xs italic text-slate-500 max-w-2xl">
            * Trang này giúp rà soát dữ liệu cần làm sạch. Chức năng sửa trực tiếp sẽ bổ sung ở giai đoạn sau.
          </p>
          {allowEdit ? (
            <Link href="/recaps/create" className="inline-flex rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-green/90">
              Thêm recap thủ công
            </Link>
          ) : null}
        </div>
      </div>
      {selectedIssue ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-vam-green bg-vam-mint px-4 py-3 text-sm text-vam-ink">
          <span>
            Đang xem cảnh báo: <strong>{ISSUE_CONFIG[selectedIssue].label}</strong>
          </span>
          <Link href="/data-issues" className="font-medium text-vam-green">
            Xem tất cả cảnh báo
          </Link>
        </div>
      ) : null}
      {errors.map((error) => (
        <ErrorBox key={error} message={error} />
      ))}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Người dùng thiếu số điện thoại" value={peopleMissingPhone.length} />
        <KpiCard label="Đơn ứng tuyển thiếu tên/email" value={applicationsMissingIdentity.length} />
        <KpiCard label="Mentee cần rà soát trường học" value={menteesMissingSchool.length} />
        <KpiCard label="Mentor thiếu profile link" value={mentorsMissingBio.length} />
        <KpiCard label="Mentee chưa có mentor đang hoạt động" value={menteesWithoutActiveMentor.length} />
        <KpiCard label="Match lỗi (đang hoạt động)" value={activeMatchMissingPerson.length} />
        <KpiCard label="Email trùng" value={duplicateEmails.length} />
      </div>

      <div className="mt-6 grid gap-4">
        <IssueSection
          issueKey="missing_phone"
          selectedIssue={selectedIssue}
          title="A. Người dùng thiếu số điện thoại"
          rows={peopleMissingPhone}
          columns={[
            { key: "full_name", label: "Họ tên", displayKey: "full_name_display" },
            { key: "email_primary", label: "Email", displayKey: "email_primary_display" },
            { key: "phone_primary", label: "Số điện thoại", displayKey: "phone_primary_display" },
            { key: "source_sheets", label: "Nguồn dữ liệu", displayKey: "source_sheets_display" },
            { key: "person_link", label: "Hồ sơ", internalHrefKey: "id", internalHrefPrefix: "/people/", internalLabel: "Xem hồ sơ" }
          ]}
        />

        <IssueSection
          issueKey="applications_missing_identity"
          selectedIssue={selectedIssue}
          title="B. Đơn ứng tuyển thiếu tên/email"
          rows={applicationsMissingIdentity}
          columns={[
            { key: "sbd", label: "SBD" },
            { key: "short_application_id", label: "Mã đơn" },
            { key: "short_person_id", label: "Mã person" },
            { key: "full_name", label: "Họ tên", displayKey: "full_name_display" },
            { key: "email_primary", label: "Email", displayKey: "email_primary_display" },
            { key: "final_status", label: "Trạng thái", displayKey: "final_status_display" },
            { key: "submitted_at", label: "Ngày nộp", displayKey: "submitted_at_display" },
            { key: "application_link", label: "Đơn", internalHrefKey: "id", internalHrefPrefix: "/applications/", internalLabel: "Xem đơn" },
            { key: "person_link", label: "Hồ sơ", internalHrefKey: "person_id", internalHrefPrefix: "/people/", internalLabel: "Xem hồ sơ" }
          ]}
        />

        <IssueSection
          issueKey="missing_school_code"
          selectedIssue={selectedIssue}
          title="C. Mentees cần rà soát trường học"
          rows={menteesMissingSchool}
          columns={[
            { key: "full_name", label: "Họ tên", displayKey: "full_name_display" },
            { key: "email_primary", label: "Email", displayKey: "email_primary_display" },
            { key: "mentee_code", label: "Mã Mentee", displayKey: "mentee_code_display" },
            { key: "school_code", label: "Mã trường", displayKey: "school_code_display" },
            { key: "school_raw", label: "Tên trường (gốc)", displayKey: "school_raw_display" },
            { key: "major", label: "Ngành", displayKey: "major_display" },
            { key: "person_link", label: "Hồ sơ", internalHrefKey: "person_id", internalHrefPrefix: "/people/", internalLabel: "Xem hồ sơ" }
          ]}
        />

        <IssueSection
          issueKey="missing_mentor_bio_url"
          selectedIssue={selectedIssue}
          title="D. Mentors thiếu profile link"
          rows={mentorsMissingBio}
          columns={[
            { key: "full_name", label: "Họ tên", displayKey: "full_name_display" },
            { key: "email_primary", label: "Email", displayKey: "email_primary_display" },
            { key: "mentor_code", label: "Mã Mentor", displayKey: "mentor_code_display" },
            { key: "company_current", label: "Công ty", displayKey: "company_current_display" },
            { key: "title_current", label: "Chức vụ", displayKey: "title_current_display" },
            { key: "person_link", label: "Hồ sơ", internalHrefKey: "person_id", internalHrefPrefix: "/people/", internalLabel: "Xem hồ sơ" }
          ]}
        />

        <IssueSection
          issueKey="mentee_without_active_mentor"
          selectedIssue={selectedIssue}
          title="E. Mentees chưa có mentor đang hoạt động"
          rows={menteesWithoutActiveMentor}
          columns={[
            { key: "full_name", label: "Họ tên", displayKey: "full_name_display" },
            { key: "email_primary", label: "Email", displayKey: "email_primary_display" },
            { key: "mentee_code", label: "Mã Mentee", displayKey: "mentee_code_display" },
            { key: "school_code", label: "Mã trường", displayKey: "school_code_display" },
            { key: "major", label: "Ngành", displayKey: "major_display" },
            { key: "person_link", label: "Hồ sơ", internalHrefKey: "person_id", internalHrefPrefix: "/people/", internalLabel: "Xem hồ sơ" }
          ]}
        />

        <IssueSection
          issueKey="active_match_missing_person"
          selectedIssue={selectedIssue}
          title="F. Match đang hoạt động — thiếu mentor/mentee"
          rows={activeMatchMissingPerson}
          columns={[
            { key: "short_match_id", label: "Mã match" },
            { key: "status", label: "Trạng thái", displayKey: "status_display" },
            { key: "match_type", label: "Loại match", displayKey: "match_type_display" },
            { key: "mentor_person_id", label: "ID Mentor", displayKey: "mentor_person_id_display" },
            { key: "mentee_person_id", label: "ID Mentee", displayKey: "mentee_person_id_display" },
            { key: "match_link", label: "Match", internalHrefKey: "id", internalHrefPrefix: "/matches/", internalLabel: "Xem match" }
          ]}
        />

        <details
          id={ISSUE_CONFIG.duplicate_email.sectionId}
          open={shouldOpenIssue(selectedIssue, "duplicate_email")}
          className={`scroll-mt-6 rounded-lg border bg-white p-4 shadow-soft ${selectedIssue === "duplicate_email" ? "border-vam-green ring-2 ring-vam-mint" : "border-vam-line"}`}
        >
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-vam-ink">G. Email trùng</h2>
            <span className="rounded-md border border-vam-line bg-slate-50 px-2 py-1 text-xs font-medium text-slate-600">{duplicateEmails.length} vấn đề</span>
          </summary>
          {duplicateEmails.length ? (
            <div className="mt-3 overflow-hidden rounded-lg border border-vam-line bg-white">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-vam-line text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Email</th>
                      <th className="px-4 py-3">Số lần trùng</th>
                      <th className="px-4 py-3">Hồ sơ liên quan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-vam-line">
                    {duplicateEmails.map((row) => (
                      <tr key={row.email_primary}>
                        <td className="px-4 py-3 text-slate-700">{row.email_primary}</td>
                        <td className="px-4 py-3 text-slate-700">{row.duplicate_count}</td>
                        <td className="px-4 py-3 text-slate-700">
                          <div className="flex flex-wrap gap-2">
                            {row.related_people.map((person) => (
                              <Link key={person.id} href={`/people/${person.id}`} className="text-sm font-medium text-vam-green">
                                {person.name}
                              </Link>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="mt-3">
              <EmptyState message="Không có vấn đề cần rà soát." />
            </div>
          )}
        </details>
      </div>
    </>
  );
}
