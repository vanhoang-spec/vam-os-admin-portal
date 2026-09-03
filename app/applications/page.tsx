import { FilterableTable } from "@/components/filterable-table";
import { ErrorBox, PageHeader } from "@/components/ui";
import { getApplications, getIntakeBatches, getPeople, getSeasons, keyById } from "@/lib/data";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { Application, Person, Season } from "@/lib/types";
import { applicationStatusLabel } from "@/lib/ui-labels";
import { displayCode, displayConsent, displayText, formatDate } from "@/lib/utils";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canBrowseApplications } from "@/lib/read-access";
import { redirect } from "next/navigation";
import Link from "next/link";
import { canDecide } from "@/lib/permissions";


// ── Row type ──────────────────────────────────────────────────────────────────

type Row = Application & {
  person?: Person;
  season?: Season;
  // Coalesced identity — application-level fields (S12) take precedence over person-level (S11)
  full_name?: string | null;
  email_primary?: string | null;
  season_code?: string | null;
  // Unified status — application.status (S12) ?? application.final_status (S11)
  status_unified: string | null;
  short_application_id: string;
  short_person_id: string;
  sbd_display: string;
  full_name_display: string;
  email_primary_display: string;
  season_code_display: string;
  role_applied_display: string;
  status_display: string;
  submitted_at_display: string;
  acquisition_channel_display: string;
  consent_display: string;
  consent_filter: string;
  source_display: string;
  /** Batch code for filter (resolved from intake_batch_id) */
  intake_batch_code: string;
};

function consentFilter(value: unknown) {
  const label = displayConsent(value);
  if (label === "Có") return "yes";
  if (label === "Không") return "no";
  return "unknown";
}

export default async function ApplicationsPage() {
  const adminUser = await getCurrentAdminUser();
  if (!adminUser || !canBrowseApplications(adminUser.role)) redirect(adminUser?.role === "reviewer" ? "/reviews" : "/");
  const scope = await getScopeFilter(await getAdminScopeContext());
  const [applications, people, seasons, intakeBatchesRes] = await Promise.all([
    getApplications(scope),
    getPeople(scope),
    getSeasons(scope),
    getIntakeBatches(scope)
  ]);
  const peopleById = keyById(people.data);
  const seasonsById = keyById(seasons.data);
  const batchById = new Map(intakeBatchesRes.data.map((b) => [b.id, b]));

  const rows: Row[] = applications.data.map((application) => {
    const person = application.person_id ? peopleById.get(application.person_id) : undefined;
    const season = application.season_id ? seasonsById.get(application.season_id) : undefined;
    const seasonCode = season?.code ?? season?.name ?? null;

    // Identity: application-level (S12 native form) takes precedence over person-level (S11 legacy)
    const fullName = application.full_name ?? person?.full_name ?? null;
    const emailPrimary = application.email_primary ?? person?.email_primary ?? null;

    // Status: new pipeline status (S12) takes precedence over legacy final_status (S11)
    const statusUnified = application.status ?? application.final_status ?? null;

    // Consent: new consent_data_storage (S12) takes precedence over legacy consent_pdpa (S11)
    const consentUnified = application.consent_data_storage ?? application.consent_pdpa;

    // Batch code: resolved from intake_batch_id for filter
    const batch = application.intake_batch_id ? batchById.get(application.intake_batch_id) : undefined;
    const intakeBatchCode = batch?.code ?? batch?.name ?? (application.intake_batch_id ? "Batch không rõ" : "Chưa gán");

    return {
      ...application,
      person,
      season,
      full_name: fullName,
      email_primary: emailPrimary,
      season_code: seasonCode,
      status_unified: statusUnified,
      short_application_id: application.id.slice(0, 8),
      short_person_id: application.person_id ? application.person_id.slice(0, 8) : "-",
      sbd_display: displayText(application.sbd),
      full_name_display: displayText(fullName),
      email_primary_display: displayText(emailPrimary),
      season_code_display: displayCode(seasonCode),
      role_applied_display: displayText(application.role_applied),
      status_display: applicationStatusLabel(statusUnified),
      submitted_at_display: formatDate(application.submitted_at),
      acquisition_channel_display: displayText(application.acquisition_channel),
      consent_display: displayConsent(consentUnified),
      consent_filter: consentFilter(consentUnified),
      source_display: displayText(application.source),
      intake_batch_code: intakeBatchCode
    };
  });

  return (
    <>
      <PageHeader title="Ứng tuyển" description="Đơn ứng tuyển mentor/mentee và trạng thái xử lý." />
      {canDecide(adminUser.role) && <div className="mb-4"><Link href="/applications/bulk-decision" className="inline-flex rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white">Bulk Final Decision</Link></div>}
      <ErrorBox message={applications.error || people.error || seasons.error || intakeBatchesRes.error} />
      <FilterableTable
        rows={rows}
        searchPlaceholder="Tìm theo tên, email, SBD hoặc mã đơn"
        searchKeys={["full_name", "email_primary", "sbd", "id", "person_id"]}
        filters={[
          { key: "status_unified", label: "Trạng thái", valueKey: "status_unified" },
          { key: "role_applied", label: "Vai trò ứng tuyển", valueKey: "role_applied" },
          { key: "season_code", label: "Mùa", valueKey: "season_code" },
          { key: "intake_batch", label: "Đợt tuyển", valueKey: "intake_batch_code" },
          {
            key: "consent",
            label: "Đồng ý lưu trữ",
            valueKey: "consent_filter",
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
          { label: "Trạng thái A-Z", key: "status_unified", direction: "asc", type: "text" }
        ]}
        columns={[
          { key: "sbd", label: "SBD", displayKey: "sbd_display" },
          { key: "short_application_id", label: "Mã đơn" },
          { key: "full_name", label: "Họ tên", displayKey: "full_name_display", secondaryKey: "short_person_id", secondaryLabel: "Mã person" },
          { key: "email_primary", label: "Email", displayKey: "email_primary_display", nowrap: true },
          { key: "role_applied", label: "Vai trò", displayKey: "role_applied_display" },
          { key: "status_unified", label: "Trạng thái", displayKey: "status_display", badge: true },
          { key: "source", label: "Nguồn", displayKey: "source_display" },
          { key: "submitted_at", label: "Ngày nộp", displayKey: "submitted_at_display" },
          { key: "consent_display", label: "Đồng ý lưu trữ", displayKey: "consent_display", badge: true },
          { key: "detail", label: "Chi tiết", internalHrefKey: "id", internalHrefPrefix: "/applications/", internalLabel: "Xem chi tiết" }
        ]}
      />
    </>
  );
}
