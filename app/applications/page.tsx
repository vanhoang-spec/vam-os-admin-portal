import { FilterableTable } from "@/components/filterable-table";
import { ErrorBox, PageHeader } from "@/components/ui";
import { getApplications, getPeople, getSeasons, keyById } from "@/lib/data";
import { Application, Person, Season } from "@/lib/types";
import { displayCode, displayConsent, displayText, formatDate } from "@/lib/utils";

type Row = Application & {
  person?: Person;
  season?: Season;
  full_name?: string | null;
  email_primary?: string | null;
  season_code?: string | null;
  short_application_id: string;
  short_person_id: string;
  sbd_display: string;
  full_name_display: string;
  email_primary_display: string;
  season_code_display: string;
  role_applied_display: string;
  final_status_display: string;
  submitted_at_display: string;
  acquisition_channel_display: string;
  consent_pdpa_display: string;
  consent_pdpa_filter: string;
};

function consentFilter(value: unknown) {
  const label = displayConsent(value);
  if (label === "Có") return "yes";
  if (label === "Không") return "no";
  return "unknown";
}

export default async function ApplicationsPage() {
  const [applications, people, seasons] = await Promise.all([getApplications(), getPeople(), getSeasons()]);
  const peopleById = keyById(people.data);
  const seasonsById = keyById(seasons.data);
  const rows: Row[] = applications.data.map((application) => {
    const person = application.person_id ? peopleById.get(application.person_id) : undefined;
    const season = application.season_id ? seasonsById.get(application.season_id) : undefined;
    const seasonCode = season?.code ?? season?.name ?? null;
    return {
      ...application,
      person,
      season,
      full_name: person?.full_name,
      email_primary: person?.email_primary,
      season_code: seasonCode,
      short_application_id: application.id.slice(0, 8),
      short_person_id: application.person_id ? application.person_id.slice(0, 8) : "-",
      sbd_display: displayText(application.sbd),
      full_name_display: displayText(person?.full_name),
      email_primary_display: displayText(person?.email_primary),
      season_code_display: displayCode(seasonCode),
      role_applied_display: displayText(application.role_applied),
      final_status_display: displayText(application.final_status),
      submitted_at_display: formatDate(application.submitted_at),
      acquisition_channel_display: displayText(application.acquisition_channel),
      consent_pdpa_display: displayConsent(application.consent_pdpa),
      consent_pdpa_filter: consentFilter(application.consent_pdpa)
    };
  });

  return (
    <>
      <PageHeader title="Applications" description="Đơn ứng tuyển mentor/mentee và trạng thái xử lý." />
      <ErrorBox message={applications.error || people.error || seasons.error} />
      <FilterableTable
        rows={rows}
        searchPlaceholder="Tìm theo tên, email, SBD hoặc mã đơn"
        searchKeys={["full_name", "email_primary", "sbd", "id", "person_id"]}
        filters={[
          { key: "final_status", label: "Trạng thái", valueKey: "final_status" },
          { key: "role_applied", label: "Vai trò ứng tuyển", valueKey: "role_applied" },
          { key: "season_code", label: "Mùa", valueKey: "season_code" },
          {
            key: "consent_pdpa",
            label: "Đồng ý PDPA",
            valueKey: "consent_pdpa_filter",
            options: [
              { label: "Có", value: "yes" },
              { label: "Không", value: "no" },
              { label: "Chưa rõ", value: "unknown" }
            ]
          }
        ]}
        sortOptions={[
          { label: "Ngày nộp mới nhất", key: "submitted_at", direction: "desc", type: "text" },
          { label: "Tên ứng viên A-Z", key: "full_name", direction: "asc", type: "text" },
          { label: "Trạng thái A-Z", key: "final_status", direction: "asc", type: "text" }
        ]}
        columns={[
          { key: "sbd", label: "SBD", displayKey: "sbd_display" },
          { key: "short_application_id", label: "Mã đơn" },
          { key: "full_name", label: "Họ tên", displayKey: "full_name_display" },
          { key: "email_primary", label: "Email", displayKey: "email_primary_display" },
          { key: "short_person_id", label: "Mã person" },
          { key: "season_code", label: "Mùa", displayKey: "season_code_display" },
          { key: "role_applied", label: "Vai trò", displayKey: "role_applied_display" },
          { key: "final_status", label: "Trạng thái", displayKey: "final_status_display" },
          { key: "submitted_at", label: "Ngày nộp", displayKey: "submitted_at_display" },
          { key: "acquisition_channel", label: "Nguồn biết đến", displayKey: "acquisition_channel_display" },
          { key: "consent_pdpa", label: "PDPA", displayKey: "consent_pdpa_display" },
          { key: "detail", label: "Chi tiết", internalHrefKey: "id", internalHrefPrefix: "/applications/", internalLabel: "Xem chi tiết" }
        ]}
      />
    </>
  );
}
