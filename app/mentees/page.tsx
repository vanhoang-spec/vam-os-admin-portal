import Link from "next/link";
import { FilterableTable } from "@/components/filterable-table";
import { ErrorBox, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import { getIntakeBatches, getMatches, getMenteeProfiles, getMentorProfiles, getPeople, getSeasons, keyById } from "@/lib/data";
import { canOperateAnyScope, getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { Match, MenteeProfile, MentorProfile, Person } from "@/lib/types";
import { displayCode, displayOptional, displayText } from "@/lib/utils";

type Row = MenteeProfile & {
  person?: Person;
  mentor?: Person;
  mentorProfile?: MentorProfile;
  mentor_name?: string | null;
  mentor_email?: string | null;
  mentor_code?: string | null;
  mentor_company?: string | null;
  mentor_bio_url?: string | null;
  mentor_person_id?: string | null;
  match_id?: string | null;
  match_status?: string | null;
  match_type?: string | null;
  match_confidence?: number | null;
  has_mentor: string;
  /** Phase 043: batch code for filter, "Chưa gán" for legacy S11 rows */
  intake_batch_code: string;
  /** Phase 043: season code for filter, "Chưa gán" for legacy S11 rows */
  intake_season_code: string;
};

function statusRank(match: Match) {
  const status = String(match.status ?? "").trim().toLowerCase();
  if (status === "active") return 0;
  if (status === "completed") return 1;
  if (status === "dropped") return 3;
  return 2;
}

export default async function MenteesPage() {
  const scopeContext = await getAdminScopeContext();
  const scope = await getScopeFilter(scopeContext);
  const [mentees, people, mentors, matches, intakeBatches, seasons, adminUser] = await Promise.all([
    getMenteeProfiles(scope),
    getPeople(scope),
    getMentorProfiles(scope),
    getMatches(scope),
    getIntakeBatches(scope),
    getSeasons(scope),
    getCurrentAdminUser()
  ]);
  const allowCreate = canEditRecaps(adminUser) && canOperateAnyScope(scopeContext);
  const peopleById = keyById(people.data);
  const intakeBatchById = new Map(intakeBatches.data.map((b) => [b.id, b]));
  const seasonById = new Map(seasons.data.map((s) => [s.id, s]));
  const mentorProfilesByPersonId = new Map(mentors.data.filter((profile) => profile.person_id).map((profile) => [profile.person_id, profile]));
  const matchesByMentee = new Map<string, Match[]>();
  for (const match of matches.data) {
    if (!match.mentee_person_id) continue;
    const menteeMatches = matchesByMentee.get(match.mentee_person_id) ?? [];
    menteeMatches.push(match);
    matchesByMentee.set(match.mentee_person_id, menteeMatches);
  }
  const rows = mentees.data.map((mentee) => {
    const person = mentee.person_id ? peopleById.get(mentee.person_id) : undefined;
    const menteeMatches = mentee.person_id ? matchesByMentee.get(mentee.person_id) ?? [] : [];
    const selectedMatch = [...menteeMatches].sort((a, b) => {
      const rankDiff = statusRank(a) - statusRank(b);
      if (rankDiff !== 0) return rankDiff;
      return Number(b.match_confidence ?? 0) - Number(a.match_confidence ?? 0);
    })[0];
    const mentor = selectedMatch?.mentor_person_id ? peopleById.get(selectedMatch.mentor_person_id) : undefined;
    const mentorProfile = selectedMatch?.mentor_person_id ? mentorProfilesByPersonId.get(selectedMatch.mentor_person_id) : undefined;
    // Phase 043: resolve intake batch → season for filter columns
    const batch = mentee.intake_batch_id ? intakeBatchById.get(mentee.intake_batch_id) : undefined;
    const batchSeason = batch?.season_id ? seasonById.get(batch.season_id) : undefined;
    return {
      ...mentee,
      full_name: person?.full_name,
      email_primary: person?.email_primary,
      mentee_code_display: displayCode(mentee.mentee_code),
      school_code_display: displayCode(mentee.school_code),
      school_raw_display: displayText(mentee.school_raw),
      major_display: displayText(mentee.major),
      class_cohort_display: displayText(mentee.class_cohort),
      mssv_display: displayText(mentee.mssv),
      mentor,
      mentorProfile,
      mentor_name: mentor?.full_name,
      mentor_email: mentor?.email_primary,
      mentor_code: mentorProfile?.mentor_code,
      mentor_company: mentorProfile?.company_current,
      mentor_code_display: displayCode(mentorProfile?.mentor_code),
      mentor_company_display: displayText(mentorProfile?.company_current),
      mentor_bio_url: mentorProfile?.bio_url,
      mentor_person_id: selectedMatch?.mentor_person_id,
      match_id: selectedMatch?.id,
      match_status: selectedMatch?.status,
      match_type: selectedMatch?.match_type,
      match_confidence: selectedMatch?.match_confidence,
      match_status_display: displayText(selectedMatch?.status),
      match_type_display: displayText(selectedMatch?.match_type),
      match_confidence_display: displayOptional(selectedMatch?.match_confidence),
      has_mentor: selectedMatch?.mentor_person_id ? "Có mentor" : "Chưa có mentor",
      has_mentor_filter: selectedMatch?.mentor_person_id ? "yes" : "no",
      intake_batch_code: batch?.code ?? "Chưa gán",
      intake_season_code: batchSeason?.code ?? "Chưa gán"
    };
  });
  return (
    <>
      <PageHeader title="Mentees" description="Hồ sơ mentee và thông tin học tập." />
      {allowCreate ? (
        <div className="mb-4 flex flex-wrap gap-2">
          <Link href="/mentees/create" className="inline-flex w-fit rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-green/90">
            Tạo mentee mới
          </Link>
        </div>
      ) : null}
      <ErrorBox message={mentees.error || people.error || mentors.error || matches.error || intakeBatches.error || seasons.error} />
      <FilterableTable
        rows={rows}
        searchPlaceholder="Tìm theo tên, email, mentee_code, MSSV, ngành hoặc mentor"
        searchKeys={["full_name", "email_primary", "mentee_code", "mssv", "major", "mentor_name", "mentor_email"]}
        filters={[
          { key: "school_code", label: "Mã trường", valueKey: "school_code" },
          {
            key: "has_mentor",
            label: "Mentor",
            valueKey: "has_mentor_filter",
            options: [
              { label: "Có mentor", value: "yes" },
              { label: "Chưa có mentor", value: "no" }
            ]
          },
          { key: "match_status", label: "Trạng thái match", valueKey: "match_status" },
          { key: "major", label: "Ngành", valueKey: "major" },
          { key: "intake_season", label: "Mùa intake", valueKey: "intake_season_code" },
          { key: "intake_batch", label: "Batch intake", valueKey: "intake_batch_code" }
        ]}
        sortOptions={[
          { label: "Mã trường A-Z", key: "school_code", direction: "asc", type: "text", emptyLast: true, secondaryKey: "full_name" },
          { label: "Mã trường Z-A", key: "school_code", direction: "desc", type: "text", emptyLast: true, secondaryKey: "full_name" },
          { label: "Tên mentee A-Z", key: "full_name", direction: "asc", type: "text" },
          { label: "Độ tin cậy giảm dần", key: "match_confidence", direction: "desc", type: "number" }
        ]}
        getHref={{ prefix: "/people/", key: "person_id" }}
        columns={[
          { key: "full_name", label: "Họ tên" },
          { key: "email_primary", label: "Email" },
          { key: "mentee_code", label: "Mã mentee", displayKey: "mentee_code_display" },
          { key: "school_code", label: "Mã trường", displayKey: "school_code_display" },
          { key: "school_raw", label: "Trường", displayKey: "school_raw_display" },
          { key: "major", label: "Ngành học", displayKey: "major_display" },
          { key: "class_cohort", label: "Khóa / Lớp", displayKey: "class_cohort_display" },
          { key: "mssv", label: "MSSV", displayKey: "mssv_display" },
          { key: "mentor_name", label: "Mentor hiện tại" },
          { key: "mentor_email", label: "Email mentor" },
          { key: "mentor_code", label: "Mã mentor", displayKey: "mentor_code_display" },
          { key: "mentor_company", label: "Công ty mentor", displayKey: "mentor_company_display" },
          { key: "match_status", label: "Trạng thái match", displayKey: "match_status_display" },
          { key: "match_type", label: "Loại match", displayKey: "match_type_display" },
          { key: "match_confidence", label: "Độ tin cậy match", displayKey: "match_confidence_display" },
          { key: "match_link", label: "Xem match", internalHrefKey: "match_id", internalHrefPrefix: "/matches/", internalLabel: "Xem match" },
          { key: "mentor_link", label: "Xem mentor", internalHrefKey: "mentor_person_id", internalHrefPrefix: "/people/", internalLabel: "Xem mentor" },
          { key: "mentor_profile", label: "Profile mentor", externalHrefKey: "mentor_bio_url", externalLabel: "Xem profile" }
        ]}
      />
    </>
  );
}
