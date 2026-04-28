import { FilterableTable } from "@/components/filterable-table";
import { ErrorBox, PageHeader } from "@/components/ui";
import { getMatches, getMenteeProfiles, getMentorProfiles, getPeople, keyById } from "@/lib/data";
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
};

function statusRank(match: Match) {
  const status = String(match.status ?? "").trim().toLowerCase();
  if (status === "active") return 0;
  if (status === "completed") return 1;
  if (status === "dropped") return 3;
  return 2;
}

export default async function MenteesPage() {
  const [mentees, people, mentors, matches] = await Promise.all([getMenteeProfiles(), getPeople(), getMentorProfiles(), getMatches()]);
  const peopleById = keyById(people.data);
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
      has_mentor_filter: selectedMatch?.mentor_person_id ? "yes" : "no"
    };
  });
  return (
    <>
      <PageHeader title="Mentees" description="Hồ sơ mentee và thông tin học tập." />
      <ErrorBox message={mentees.error || people.error || mentors.error || matches.error} />
      <FilterableTable
        rows={rows}
        searchPlaceholder="Tìm theo tên, email, mentee_code, MSSV, ngành hoặc mentor"
        searchKeys={["full_name", "email_primary", "mentee_code", "mssv", "major", "mentor_name", "mentor_email"]}
        filters={[
          { key: "school_code", label: "school_code", valueKey: "school_code" },
          {
            key: "has_mentor",
            label: "Mentor",
            valueKey: "has_mentor_filter",
            options: [
              { label: "Has mentor", value: "yes" },
              { label: "No mentor", value: "no" }
            ]
          },
          { key: "match_status", label: "Trạng thái match", valueKey: "match_status" },
          { key: "major", label: "Ngành", valueKey: "major" }
        ]}
        sortOptions={[
          { label: "school_code A-Z", key: "school_code", direction: "asc", type: "text" },
          { label: "Tên mentee A-Z", key: "full_name", direction: "asc", type: "text" },
          { label: "Độ tin cậy giảm dần", key: "match_confidence", direction: "desc", type: "number" }
        ]}
        getHref={{ prefix: "/people/", key: "person_id" }}
        columns={[
          { key: "full_name", label: "full_name" },
          { key: "email_primary", label: "email_primary" },
          { key: "mentee_code", label: "mentee_code", displayKey: "mentee_code_display" },
          { key: "school_code", label: "school_code", displayKey: "school_code_display" },
          { key: "school_raw", label: "school_raw", displayKey: "school_raw_display" },
          { key: "major", label: "major", displayKey: "major_display" },
          { key: "class_cohort", label: "class_cohort", displayKey: "class_cohort_display" },
          { key: "mssv", label: "mssv", displayKey: "mssv_display" },
          { key: "mentor_name", label: "Mentor hiện tại" },
          { key: "mentor_email", label: "Email mentor" },
          { key: "mentor_code", label: "mentor_code", displayKey: "mentor_code_display" },
          { key: "mentor_company", label: "Công ty mentor", displayKey: "mentor_company_display" },
          { key: "match_status", label: "Trạng thái match", displayKey: "match_status_display" },
          { key: "match_type", label: "match_type", displayKey: "match_type_display" },
          { key: "match_confidence", label: "match_confidence", displayKey: "match_confidence_display" },
          { key: "match_link", label: "Xem match", internalHrefKey: "match_id", internalHrefPrefix: "/matches/", internalLabel: "Xem match" },
          { key: "mentor_link", label: "Xem mentor", internalHrefKey: "mentor_person_id", internalHrefPrefix: "/people/", internalLabel: "Xem mentor" },
          { key: "mentor_profile", label: "Profile mentor", externalHrefKey: "mentor_bio_url", externalLabel: "Xem profile" }
        ]}
      />
    </>
  );
}
