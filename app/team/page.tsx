import Link from "next/link";
import { Card, EmptyState, ErrorBox, KpiCard, PageHeader, SimpleTable } from "@/components/ui";
import {
  getMenteeProfiles,
  getMentorProfiles,
  getOperationalTeamAssignments,
  getPeople,
  getSeasons,
  keyById
} from "@/lib/data";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import type { MenteeProfile, MentorProfile, OperationalTeamAssignment, Person, Season } from "@/lib/types";
import { displayCode, displayText } from "@/lib/utils";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canBrowseTeam } from "@/lib/read-access";
import { redirect } from "next/navigation";

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function sourceRoleGroupLabel(value: unknown) {
  const n = normalize(value);
  if (n === "coreteam" || n === "core_team") return "Core team";
  if (n === "support_team") return "Support team";
  if (!n) return "Chưa phân loại";
  return displayText(value);
}

function functionalTeamLabel(value: unknown) {
  const n = normalize(value);
  if (n === "project_coordination") return "Điều phối dự án";
  if (n === "communication_media") return "Truyền thông / Nội dung";
  if (n === "event") return "Sự kiện / Đào tạo";
  if (n === "design") return "Thiết kế";
  if (n === "data" || n === "data_operations") return "Dữ liệu / Vận hành";
  if (n === "matching") return "Matching";
  if (n === "recap_followup") return "Theo dõi Recap";
  if (n === "mentor_coordination") return "Điều phối mentor";
  if (n === "mentee_coordination") return "Điều phối mentee";
  if (n === "program_lead") return "Trưởng chương trình";
  if (n === "communications") return "Truyền thông";
  if (n === "other") return "Khác";
  if (n === "unknown" || !n) return "Chưa phân loại";
  return displayText(value);
}

function operationalRoleLabel(value: unknown) {
  const n = normalize(value);
  if (n === "core_team") return "Core team";
  if (n === "project_coordination_support") return "Điều phối dự án";
  if (n === "communication_support") return "Truyền thông / Nội dung";
  if (n === "event_support") return "Sự kiện / Đào tạo";
  if (n === "design_support") return "Thiết kế";
  if (n === "support_team_member") return "Thành viên support team";
  if (n === "program_lead") return "Trưởng chương trình";
  if (n === "matching") return "Matching";
  if (n === "recap_followup") return "Theo dõi Recap";
  if (n === "mentor_coordination") return "Điều phối mentor";
  if (n === "mentee_coordination") return "Điều phối mentee";
  if (n === "communications") return "Truyền thông";
  if (n === "other") return "Khác";
  if (!n) return "-";
  return displayText(value);
}

function statusLabel(value: unknown) {
  const n = normalize(value);
  if (n === "active") return "Đang hoạt động";
  if (n === "inactive") return "Không hoạt động";
  if (n === "paused") return "Tạm dừng";
  if (n === "ended") return "Đã kết thúc";
  if (!n) return "Chưa rõ";
  return displayText(value);
}

function isCoreTeam(row: OperationalTeamAssignment) {
  const n = normalize(row.source_role_group);
  return n === "coreteam" || n === "core_team";
}

function isSupportTeam(row: OperationalTeamAssignment) {
  return normalize(row.source_role_group) === "support_team";
}

function single(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

type CoreRow = OperationalTeamAssignment & {
  full_name: string | null;
  email_primary: string | null;
  title_current: string | null;
  company_current: string | null;
};

type SupportRow = OperationalTeamAssignment & {
  full_name: string | null;
  email_primary: string | null;
  school: string | null;
  major: string | null;
  mentee_code: string | null;
};

export default async function TeamViewPage(props: { searchParams?: Promise<{ q?: string | string[]; group?: string | string[]; functional?: string | string[]; status?: string | string[] }> }) {
  const adminUser = await getCurrentAdminUser();
  if (!adminUser || !canBrowseTeam(adminUser.role)) redirect("/");
  const searchParams = await props.searchParams;

  const scopeContext = await getAdminScopeContext();
  const scope = await getScopeFilter(scopeContext);
  const [assignments, people, mentors, mentees, seasons] = await Promise.all([
    getOperationalTeamAssignments(scope),
    getPeople(scope),
    getMentorProfiles(scope),
    getMenteeProfiles(scope),
    getSeasons(scope)
  ]);

  const errors = [assignments.error, people.error, mentors.error, mentees.error, seasons.error].filter(Boolean);

  const peopleById = keyById(people.data);
  const mentorByPersonId = new Map<string, MentorProfile>();
  for (const profile of mentors.data) {
    if (profile.person_id) mentorByPersonId.set(profile.person_id, profile);
  }
  const menteeByPersonId = new Map<string, MenteeProfile>();
  for (const profile of mentees.data) {
    if (profile.person_id) menteeByPersonId.set(profile.person_id, profile);
  }
  const seasonsById = new Map<string, Season>(seasons.data.map((season) => [season.id, season]));

  const q = single(searchParams?.q).trim().toLowerCase();
  const groupFilter = single(searchParams?.group).trim();
  const functionalFilter = single(searchParams?.functional).trim();
  const statusFilter = single(searchParams?.status).trim();

  const scopedPersonIds = new Set(people.data.map((person) => person.id));
  const visibleAssignments = scope ? assignments.data.filter((row) => scopedPersonIds.has(row.person_id)) : assignments.data;

  const filtered = visibleAssignments.filter((row) => {
    if (groupFilter) {
      if (groupFilter === "coreteam" && !isCoreTeam(row)) return false;
      if (groupFilter === "support_team" && !isSupportTeam(row)) return false;
    }
    if (functionalFilter && normalize(row.functional_team) !== functionalFilter) return false;
    if (statusFilter && normalize(row.status) !== statusFilter) return false;
    if (q) {
      const person = peopleById.get(row.person_id);
      const text = [
        person?.full_name,
        person?.email_primary,
        row.team_name,
        row.assigned_scope,
        row.role_note,
        row.notes,
        operationalRoleLabel(row.operational_role),
        functionalTeamLabel(row.functional_team)
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!text.includes(q)) return false;
    }
    return true;
  });

  const coreRows: CoreRow[] = filtered.filter(isCoreTeam).map((row) => {
    const person = peopleById.get(row.person_id);
    const mentor = mentorByPersonId.get(row.person_id);
    return {
      ...row,
      full_name: person?.full_name ?? null,
      email_primary: person?.email_primary ?? null,
      title_current: mentor?.title_current ?? null,
      company_current: mentor?.company_current ?? null
    };
  });

  const supportRows: SupportRow[] = filtered.filter(isSupportTeam).map((row) => {
    const person = peopleById.get(row.person_id);
    const mentee = menteeByPersonId.get(row.person_id);
    return {
      ...row,
      full_name: person?.full_name ?? null,
      email_primary: person?.email_primary ?? null,
      school: mentee?.school_code ?? mentee?.school_raw ?? null,
      major: mentee?.major ?? null,
      mentee_code: mentee?.mentee_code ?? null
    };
  });

  const otherRows = filtered.filter((row) => !isCoreTeam(row) && !isSupportTeam(row));

  const sortByName = <T extends { full_name?: string | null; person_id: string }>(rows: T[]) =>
    rows.slice().sort((a, b) => String(a.full_name ?? "").localeCompare(String(b.full_name ?? ""), "vi"));

  const coreSorted = sortByName(coreRows);
  const supportSorted = sortByName(supportRows);
  const otherSorted = otherRows
    .map((row) => {
      const person = peopleById.get(row.person_id);
      return { ...row, full_name: person?.full_name ?? null, email_primary: person?.email_primary ?? null };
    })
    .sort((a, b) => String(a.full_name ?? "").localeCompare(String(b.full_name ?? ""), "vi"));

  const seasonScopeOptions = Array.from(new Set(seasons.data.map((s) => s.code).filter(Boolean) as string[])).sort();

  const functionalOptions: Array<{ value: string; label: string }> = [
    "project_coordination",
    "communication_media",
    "event",
    "design",
    "data_operations",
    "matching",
    "recap_followup",
    "mentor_coordination",
    "mentee_coordination",
    "program_lead",
    "communications",
    "other",
    "unknown"
  ].map((value) => ({ value, label: functionalTeamLabel(value) }));

  const statusOptions: Array<{ value: string; label: string }> = ["active", "paused", "inactive", "ended"].map(
    (value) => ({ value, label: statusLabel(value) })
  );

  const totalActive = filtered.filter((row) => normalize(row.status) === "active").length;

  return (
    <>
      <PageHeader
        title="Phân công & Trách nhiệm"
        description="Tổng hợp Core team và Support team theo dữ liệu operational_team_assignments hiện hành (read-only)."
      />
      {errors.length ? <ErrorBox message="Một phần dữ liệu chưa tải được. Một số dòng có thể thiếu thông tin liên kết." /> : null}
      {errors.map((error) => (
        <ErrorBox key={error as string} message={error as string} />
      ))}

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Tổng phân công" value={filtered.length} />
        <KpiCard label="Đang hoạt động" value={totalActive} />
        <KpiCard label="Core team" value={coreSorted.length} />
        <KpiCard label="Support team" value={supportSorted.length} />
      </div>

      <Card className="mb-4">
        <form className="grid gap-3 sm:grid-cols-[1fr_180px_220px_180px_auto] sm:items-end">
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Tìm kiếm (tên / email / team / ghi chú)</span>
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Gõ tên người, email, team..."
              className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Nhóm</span>
            <select
              name="group"
              defaultValue={groupFilter}
              className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
            >
              <option value="">-- Tất cả --</option>
              <option value="coreteam">Core team</option>
              <option value="support_team">Support team</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Khu vực phụ trách</span>
            <select
              name="functional"
              defaultValue={functionalFilter}
              className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
            >
              <option value="">-- Tất cả --</option>
              {functionalOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Trạng thái</span>
            <select
              name="status"
              defaultValue={statusFilter}
              className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
            >
              <option value="">-- Tất cả --</option>
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="inline-flex w-fit rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-green/90">
              Lọc
            </button>
            <Link href="/team" className="inline-flex w-fit items-center justify-center rounded-md border border-vam-line bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Xoá lọc
            </Link>
          </div>
        </form>
        {seasonScopeOptions.length ? (
          <p className="mt-3 text-xs text-slate-500">
            Mùa hiện có trong dữ liệu: {seasonScopeOptions.join(", ")} — assigned_scope tự do dạng text, lọc bằng ô tìm kiếm.
          </p>
        ) : null}
      </Card>

      <section className="mb-6">
        <h2 className="mb-3 text-lg font-semibold text-vam-ink">Core team</h2>
        {coreSorted.length === 0 ? (
          <EmptyState message="Không có thành viên core team phù hợp với bộ lọc." />
        ) : (
          <SimpleTable
            rows={coreSorted}
            columns={[
              {
                key: "full_name",
                label: "Họ tên",
                render: (row) => (
                  <div>
                    <div className="font-medium text-vam-ink">{displayText(row.full_name)}</div>
                    <div className="mt-1 text-xs text-slate-500">{displayText(row.email_primary)}</div>
                  </div>
                )
              },
              {
                key: "title",
                label: "Chức danh hiện tại",
                render: (row) => (
                  <div>
                    <div className="text-sm">{displayText(row.title_current)}</div>
                    <div className="mt-1 text-xs text-slate-500">{displayText(row.company_current)}</div>
                  </div>
                )
              },
              {
                key: "responsibility",
                label: "Khu vực / Vai trò",
                render: (row) => (
                  <div>
                    <div className="text-sm">{functionalTeamLabel(row.functional_team)}</div>
                    <div className="mt-1 text-xs text-slate-500">{operationalRoleLabel(row.operational_role)}</div>
                  </div>
                )
              },
              {
                key: "team_name",
                label: "Team / Phạm vi",
                render: (row) => (
                  <div>
                    <div className="text-sm">{displayText(row.team_name)}</div>
                    <div className="mt-1 text-xs text-slate-500">{displayText(row.assigned_scope)}</div>
                  </div>
                )
              },
              { key: "status", label: "Trạng thái", render: (row) => statusLabel(row.status) },
              {
                key: "notes",
                label: "Ghi chú",
                render: (row) => (
                  <div className="max-w-xs whitespace-pre-wrap text-xs text-slate-600">
                    {displayText(row.role_note ?? row.notes)}
                  </div>
                )
              },
              {
                key: "profile",
                label: "Hồ sơ",
                render: (row) => (
                  <Link href={`/people/${row.person_id}`} className="inline-flex rounded-md border border-vam-line px-2.5 py-1 text-xs font-medium text-vam-green hover:bg-vam-mint">
                    Xem hồ sơ
                  </Link>
                )
              }
            ]}
          />
        )}
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-lg font-semibold text-vam-ink">Support team</h2>
        {supportSorted.length === 0 ? (
          <EmptyState message="Không có thành viên support team phù hợp với bộ lọc." />
        ) : (
          <SimpleTable
            rows={supportSorted}
            columns={[
              {
                key: "full_name",
                label: "Họ tên",
                render: (row) => (
                  <div>
                    <div className="font-medium text-vam-ink">{displayText(row.full_name)}</div>
                    <div className="mt-1 text-xs text-slate-500">{displayText(row.email_primary)}</div>
                  </div>
                )
              },
              {
                key: "school",
                label: "Trường / Ngành",
                render: (row) => (
                  <div>
                    <div className="text-sm">{displayText(row.school)}</div>
                    <div className="mt-1 text-xs text-slate-500">{displayText(row.major)}</div>
                    <div className="mt-1 text-xs text-slate-400">{displayCode(row.mentee_code)}</div>
                  </div>
                )
              },
              {
                key: "responsibility",
                label: "Khu vực / Vai trò",
                render: (row) => (
                  <div>
                    <div className="text-sm">{functionalTeamLabel(row.functional_team)}</div>
                    <div className="mt-1 text-xs text-slate-500">{operationalRoleLabel(row.operational_role)}</div>
                  </div>
                )
              },
              {
                key: "team_name",
                label: "Team / Phạm vi",
                render: (row) => (
                  <div>
                    <div className="text-sm">{displayText(row.team_name)}</div>
                    <div className="mt-1 text-xs text-slate-500">{displayText(row.assigned_scope)}</div>
                  </div>
                )
              },
              { key: "status", label: "Trạng thái", render: (row) => statusLabel(row.status) },
              {
                key: "notes",
                label: "Ghi chú",
                render: (row) => (
                  <div className="max-w-xs whitespace-pre-wrap text-xs text-slate-600">
                    {displayText(row.role_note ?? row.notes)}
                  </div>
                )
              },
              {
                key: "profile",
                label: "Hồ sơ",
                render: (row) => (
                  <Link href={`/people/${row.person_id}`} className="inline-flex rounded-md border border-vam-line px-2.5 py-1 text-xs font-medium text-vam-green hover:bg-vam-mint">
                    Xem hồ sơ
                  </Link>
                )
              }
            ]}
          />
        )}
      </section>

      {otherSorted.length ? (
        <section className="mb-6">
          <h2 className="mb-3 text-lg font-semibold text-vam-ink">Phân công khác / chưa phân loại nhóm</h2>
          <p className="mb-2 text-xs text-slate-500">
            Các dòng dưới đây có source_role_group không phải coreteam/support_team. Cần rà soát và cập nhật.
          </p>
          <SimpleTable
            rows={otherSorted}
            columns={[
              {
                key: "full_name",
                label: "Họ tên",
                render: (row) => (
                  <div>
                    <div className="font-medium text-vam-ink">{displayText(row.full_name)}</div>
                    <div className="mt-1 text-xs text-slate-500">{displayText(row.email_primary)}</div>
                  </div>
                )
              },
              { key: "source_role_group", label: "Nhóm gốc", render: (row) => sourceRoleGroupLabel(row.source_role_group) },
              { key: "operational_role", label: "Vai trò", render: (row) => operationalRoleLabel(row.operational_role) },
              { key: "functional_team", label: "Khu vực", render: (row) => functionalTeamLabel(row.functional_team) },
              { key: "team_name", label: "Team / Phạm vi", render: (row) => `${displayText(row.team_name)} · ${displayText(row.assigned_scope)}` },
              { key: "status", label: "Trạng thái", render: (row) => statusLabel(row.status) },
              {
                key: "profile",
                label: "Hồ sơ",
                render: (row) => (
                  <Link href={`/people/${row.person_id}`} className="inline-flex rounded-md border border-vam-line px-2.5 py-1 text-xs font-medium text-vam-green hover:bg-vam-mint">
                    Xem hồ sơ
                  </Link>
                )
              }
            ]}
          />
        </section>
      ) : null}
    </>
  );
}
