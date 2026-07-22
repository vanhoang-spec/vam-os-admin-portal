import Link from "next/link";
import { FilterableTable } from "@/components/filterable-table";
import { ErrorBox, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import { getIntakeBatches, getMatches, getMentorProfiles, getPeople, getSeasons, keyById } from "@/lib/data";
import { canOperateAnyScope, getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { Match, MentorProfile, Person } from "@/lib/types";
import { displayOptional, displayText } from "@/lib/utils";

type Row = MentorProfile & {
  person?: Person;
  assigned_mentee_count: number;
  active_match_count: number;
  completed_or_dropped_match_count: number;
  industry_display: string;
  function_area_display: string;
  mentor_status: string;
  mentor_status_filter: string;
  mentee_count_filter: string;
  years_in_vam_display: string;
  years_in_vam_source: string;
  has_assigned_mentees: string;
  /** Phase 043: batch code for filter, "Chưa gán" for legacy S11 rows */
  intake_batch_code: string;
  /** Phase 043: season code for filter, "Chưa gán" for legacy S11 rows */
  intake_season_code: string;
};

function matchStatus(match: Match) {
  return String(match.status ?? "").trim().toLowerCase();
}

function menteeCountFilter(count: number) {
  if (count === 0) return "0";
  if (count === 1) return "1";
  if (count === 2) return "2";
  return "3_plus";
}

function vamSeniorityDisplay(mentor: MentorProfile, mentorMatches: Match[]) {
  const explicitYears = Number(mentor.years_in_vam);
  if (Number.isFinite(explicitYears) && explicitYears >= 0) {
    return { value: String(explicitYears), source: "Dữ liệu chính thức" };
  }
  const seasons = new Set(mentorMatches.map((match) => match.season_id).filter(Boolean));
  if (seasons.size > 0) return { value: String(seasons.size), source: "Ước tính từ mùa match" };
  return { value: "-", source: "Chưa có dữ liệu" };
}

export default async function MentorsPage() {
  const scopeContext = await getAdminScopeContext();
  const scope = await getScopeFilter(scopeContext);
  const [mentors, people, matches, intakeBatches, seasons, adminUser] = await Promise.all([
    getMentorProfiles(scope),
    getPeople(scope),
    getMatches(scope),
    getIntakeBatches(scope),
    getSeasons(scope),
    getCurrentAdminUser()
  ]);
  const allowCreate = canEditRecaps(adminUser) && canOperateAnyScope(scopeContext);
  const peopleById = keyById(people.data);
  const intakeBatchById = new Map(intakeBatches.data.map((b) => [b.id, b]));
  const seasonById = new Map(seasons.data.map((s) => [s.id, s]));
  const matchesByMentor = new Map<string, Match[]>();
  for (const match of matches.data) {
    if (!match.mentor_person_id) continue;
    const mentorMatches = matchesByMentor.get(match.mentor_person_id) ?? [];
    mentorMatches.push(match);
    matchesByMentor.set(match.mentor_person_id, mentorMatches);
  }
  const rows: Row[] = mentors.data.map((mentor) => {
    const person = mentor.person_id ? peopleById.get(mentor.person_id) : undefined;
    const mentorMatches = mentor.person_id ? matchesByMentor.get(mentor.person_id) ?? [] : [];
    const activeMatches = mentorMatches.filter((match) => matchStatus(match) === "active");
    const assignedMenteeCount = new Set(activeMatches.map((match) => match.mentee_person_id).filter(Boolean)).size;
    const isActiveMentor = activeMatches.length > 0;
    const completedOrDroppedMatchCount = mentorMatches.filter((match) => {
      const status = matchStatus(match);
      return status === "completed" || status === "dropped";
    }).length;
    const vamSeniority = vamSeniorityDisplay(mentor, mentorMatches);
    // Phase 043: resolve intake batch → season for filter columns
    const batch = mentor.intake_batch_id ? intakeBatchById.get(mentor.intake_batch_id) : undefined;
    const batchSeason = batch?.season_id ? seasonById.get(batch.season_id) : undefined;
    return {
      ...mentor,
      full_name: person?.full_name,
      email_primary: person?.email_primary,
      company_current_display: displayText(mentor.company_current),
      title_current_display: displayText(mentor.title_current),
      industry_display: displayText(mentor.industry, "Chưa rõ"),
      function_area_display: displayText(mentor.function_area, "Chưa rõ"),
      years_experience_min_display: displayOptional(mentor.years_experience_min),
      years_experience_text_display: displayText(mentor.years_experience_text),
      years_in_vam_display: vamSeniority.value,
      years_in_vam_source: vamSeniority.source,
      assigned_mentee_count: assignedMenteeCount,
      active_match_count: activeMatches.length,
      completed_or_dropped_match_count: completedOrDroppedMatchCount,
      mentor_status: isActiveMentor ? "Đang hoạt động" : "Chưa hoạt động",
      mentor_status_filter: isActiveMentor ? "active" : "inactive",
      mentee_count_filter: menteeCountFilter(assignedMenteeCount),
      has_assigned_mentees: assignedMenteeCount > 0 ? "Có mentee" : "Chưa có mentee",
      has_assigned_mentees_filter: assignedMenteeCount > 0 ? "yes" : "no",
      intake_batch_code: batch?.code ?? "Chưa gán",
      intake_season_code: batchSeason?.code ?? "Chưa gán"
    };
  });
  return (
    <>
      <PageHeader title="Mentor" description="Hồ sơ mentor đã được import vào VAM OS." />
      {allowCreate ? (
        <div className="mb-4 flex flex-wrap gap-2">
          <Link href="/mentors/create" className="inline-flex w-fit rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-green/90">
            Tạo mentor mới
          </Link>
        </div>
      ) : null}
      <ErrorBox message={mentors.error || people.error || matches.error || intakeBatches.error || seasons.error} />
      <FilterableTable
        rows={rows}
        searchPlaceholder="Tìm theo tên, email, công ty, chức danh, ngành hoặc chức năng"
        searchKeys={["full_name", "email_primary", "company_current", "title_current", "industry", "function_area"]}
        filters={[
          { key: "industry", label: "Ngành", valueKey: "industry_display" },
          { key: "function_area", label: "Chức năng", valueKey: "function_area_display" },
          {
            key: "mentor_status",
            label: "Trạng thái mentor",
            valueKey: "mentor_status_filter",
            options: [
              { label: "Đang hoạt động", value: "active" },
              { label: "Chưa hoạt động", value: "inactive" }
            ]
          },
          {
            key: "mentee_count",
            label: "Số mentee",
            valueKey: "mentee_count_filter",
            options: [
              { label: "0 mentee", value: "0" },
              { label: "1 mentee", value: "1" },
              { label: "2 mentee", value: "2" },
              { label: "3+ mentee", value: "3_plus" }
            ]
          },
          {
            key: "has_assigned_mentees",
            label: "Mentee phụ trách",
            valueKey: "has_assigned_mentees_filter",
            options: [
              { label: "Có mentee", value: "yes" },
              { label: "Chưa có mentee", value: "no" }
            ]
          },
          { key: "company_current", label: "Công ty", valueKey: "company_current" },
          { key: "intake_season", label: "Mùa intake", valueKey: "intake_season_code" },
          { key: "intake_batch", label: "Đợt tuyển", valueKey: "intake_batch_code" }
        ]}
        sortOptions={[
          { label: "Số mentee giảm dần", key: "assigned_mentee_count", direction: "desc", type: "number" },
          { label: "Số năm mentor VAM giảm dần", key: "years_in_vam_display", direction: "desc", type: "number", secondaryKey: "full_name" },
          { label: "Tên mentor A-Z", key: "full_name", direction: "asc", type: "text" },
          { label: "Ngành A-Z", key: "industry_display", direction: "asc", type: "text", emptyLast: true },
          { label: "Chức năng A-Z", key: "function_area_display", direction: "asc", type: "text", emptyLast: true },
          { label: "Công ty A-Z", key: "company_current", direction: "asc", type: "text" }
        ]}
        getHref={{ prefix: "/people/", key: "person_id" }}
        columns={[
          { key: "full_name", label: "Họ tên" },
          { key: "email_primary", label: "Email" },
          { key: "mentor_code", label: "Mã mentor" },
          { key: "assigned_mentee_count", label: "Số mentee" },
          { key: "active_match_count", label: "Match đang hoạt động" },
          { key: "completed_or_dropped_match_count", label: "Hoàn tất/dừng" },
          { key: "mentor_status", label: "Trạng thái" },
          { key: "industry", label: "Ngành", displayKey: "industry_display" },
          { key: "function_area", label: "Chức năng", displayKey: "function_area_display" },
          { key: "years_in_vam_display", label: "Số năm mentor VAM", secondaryKey: "years_in_vam_source", secondaryLabel: "Nguồn" },
          { key: "company_current", label: "Công ty", displayKey: "company_current_display" },
          { key: "title_current", label: "Chức danh", displayKey: "title_current_display" },
          { key: "years_experience_min", label: "Số năm kinh nghiệm", displayKey: "years_experience_min_display" },
          { key: "years_experience_text", label: "Kinh nghiệm mô tả", displayKey: "years_experience_text_display" },
          { key: "profile", label: "Hồ sơ", externalHrefKey: "bio_url", externalLabel: "Xem hồ sơ" }
        ]}
      />
    </>
  );
}
