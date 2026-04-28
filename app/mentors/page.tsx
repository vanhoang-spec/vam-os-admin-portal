import { FilterableTable } from "@/components/filterable-table";
import { ErrorBox, PageHeader } from "@/components/ui";
import { getMatches, getMentorProfiles, getPeople, keyById } from "@/lib/data";
import { Match, MentorProfile, Person } from "@/lib/types";
import { displayOptional, displayText } from "@/lib/utils";

type Row = MentorProfile & {
  person?: Person;
  assigned_mentee_count: number;
  active_match_count: number;
  completed_or_dropped_match_count: number;
  has_assigned_mentees: string;
};

function matchStatus(match: Match) {
  return String(match.status ?? "").trim().toLowerCase();
}

export default async function MentorsPage() {
  const [mentors, people, matches] = await Promise.all([getMentorProfiles(), getPeople(), getMatches()]);
  const peopleById = keyById(people.data);
  const matchesByMentor = new Map<string, Match[]>();
  for (const match of matches.data) {
    if (!match.mentor_person_id) continue;
    const mentorMatches = matchesByMentor.get(match.mentor_person_id) ?? [];
    mentorMatches.push(match);
    matchesByMentor.set(match.mentor_person_id, mentorMatches);
  }
  const rows = mentors.data.map((mentor) => {
    const person = mentor.person_id ? peopleById.get(mentor.person_id) : undefined;
    const mentorMatches = mentor.person_id ? matchesByMentor.get(mentor.person_id) ?? [] : [];
    const activeMatches = mentorMatches.filter((match) => matchStatus(match) === "active");
    const assignedMenteeCount = new Set(activeMatches.map((match) => match.mentee_person_id).filter(Boolean)).size;
    const completedOrDroppedMatchCount = mentorMatches.filter((match) => {
      const status = matchStatus(match);
      return status === "completed" || status === "dropped";
    }).length;
    return {
      ...mentor,
      full_name: person?.full_name,
      email_primary: person?.email_primary,
      company_current_display: displayText(mentor.company_current),
      title_current_display: displayText(mentor.title_current),
      years_experience_min_display: displayOptional(mentor.years_experience_min),
      years_experience_text_display: displayText(mentor.years_experience_text),
      assigned_mentee_count: assignedMenteeCount,
      active_match_count: activeMatches.length,
      completed_or_dropped_match_count: completedOrDroppedMatchCount,
      has_assigned_mentees: assignedMenteeCount > 0 ? "Có mentee" : "Chưa có mentee",
      has_assigned_mentees_filter: assignedMenteeCount > 0 ? "yes" : "no"
    };
  });
  return (
    <>
      <PageHeader title="Mentors" description="Hồ sơ mentor đã được import vào VAM OS." />
      <ErrorBox message={mentors.error || people.error || matches.error} />
      <FilterableTable
        rows={rows}
        searchPlaceholder="Tìm theo tên, email, công ty hoặc chức danh"
        searchKeys={["full_name", "email_primary", "company_current", "title_current"]}
        filters={[
          {
            key: "has_assigned_mentees",
            label: "Mentee phụ trách",
            valueKey: "has_assigned_mentees_filter",
            options: [
              { label: "Has mentees", value: "yes" },
              { label: "No mentees", value: "no" }
            ]
          },
          { key: "company_current", label: "Công ty", valueKey: "company_current" }
        ]}
        sortOptions={[
          { label: "Số mentee giảm dần", key: "assigned_mentee_count", direction: "desc", type: "number" },
          { label: "Tên mentor A-Z", key: "full_name", direction: "asc", type: "text" },
          { label: "Công ty A-Z", key: "company_current", direction: "asc", type: "text" }
        ]}
        getHref={{ prefix: "/people/", key: "person_id" }}
        columns={[
          { key: "full_name", label: "full_name" },
          { key: "email_primary", label: "email_primary" },
          { key: "mentor_code", label: "mentor_code" },
          { key: "assigned_mentee_count", label: "Số mentee" },
          { key: "active_match_count", label: "Match active" },
          { key: "completed_or_dropped_match_count", label: "Completed/dropped" },
          { key: "company_current", label: "Công ty", displayKey: "company_current_display" },
          { key: "title_current", label: "Chức danh", displayKey: "title_current_display" },
          { key: "years_experience_min", label: "years_experience_min", displayKey: "years_experience_min_display" },
          { key: "years_experience_text", label: "years_experience_text", displayKey: "years_experience_text_display" },
          { key: "profile", label: "Profile", externalHrefKey: "bio_url", externalLabel: "Xem profile" }
        ]}
      />
    </>
  );
}
