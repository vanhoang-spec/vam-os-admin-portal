import { FilterableTable } from "@/components/filterable-table";
import { ErrorBox, PageHeader } from "@/components/ui";
import { getMatches, getPeople, getSeasons, keyById } from "@/lib/data";
import { Match, Person, Season } from "@/lib/types";

type Row = Match & { mentor?: Person; mentee?: Person; season?: Season };

export default async function MatchesPage() {
  const [matches, people, seasons] = await Promise.all([getMatches(), getPeople(), getSeasons()]);
  const peopleById = keyById(people.data);
  const seasonsById = keyById(seasons.data);
  const rows = matches.data.map((match) => {
    const mentor = match.mentor_person_id ? peopleById.get(match.mentor_person_id) : undefined;
    const mentee = match.mentee_person_id ? peopleById.get(match.mentee_person_id) : undefined;
    const season = match.season_id ? seasonsById.get(match.season_id) : undefined;
    return {
      ...match,
      mentor_name: mentor?.full_name,
      mentee_name: mentee?.full_name,
      season_code: season?.code
    };
  });
  return (
    <>
      <PageHeader title="Matches" description="Danh sách ghép cặp mentor - mentee, mặc định hiển thị active." />
      <ErrorBox message={matches.error || people.error || seasons.error} />
      <FilterableTable
        rows={rows}
        searchPlaceholder="Tìm theo tên mentor hoặc mentee"
        searchKeys={["mentor_name", "mentee_name"]}
        filters={[
          { key: "status", label: "status", valueKey: "status", defaultValue: "active" },
          { key: "match_type", label: "match_type", valueKey: "match_type" }
        ]}
        getHref={{ prefix: "/matches/", key: "id" }}
        columns={[
          { key: "season_code", label: "season_code" },
          { key: "status", label: "status" },
          { key: "match_type", label: "match_type" },
          { key: "mentor_name", label: "mentor_name" },
          { key: "mentee_name", label: "mentee_name" },
          { key: "match_source_raw", label: "match_source_raw" },
          { key: "match_confidence", label: "match_confidence" }
        ]}
      />
    </>
  );
}
