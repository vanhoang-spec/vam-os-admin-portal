import Link from "next/link";
import { FilterableTable } from "@/components/filterable-table";
import { ErrorBox, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canAccessAdminUser } from "@/lib/permissions";
import { getApplications, getSeasons, keyById } from "@/lib/data";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import type { Application, Season } from "@/lib/types";
import { displayCode, displayText, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PILOT_SEASON_CODE = "UEHM-S12";
const PILOT_BATCH_CODE = "UEHM-S12-B1";

type Row = Application & {
  short_application_id: string;
  full_name_display: string;
  email_primary_display: string;
  phone_primary_display: string;
  role_applied_display: string;
  status_display: string;
  submitted_at_display: string;
  source_display: string;
  consent_data_storage_display: string;
};

function statusLabel(status: string | null | undefined) {
  const value = String(status ?? "").trim().toLowerCase();
  if (!value) return "Chưa xác định";
  if (value === "submitted") return "Đã nộp";
  if (value === "under_data_check") return "Đang kiểm dữ liệu";
  if (value === "ready_for_screening") return "Sẵn sàng screening";
  if (value === "screening_assigned") return "Đã giao reviewer";
  if (value === "screening_completed") return "Reviewer đã chấm";
  if (value === "screening_passed") return "Đậu screening";
  if (value === "invited_to_meeting") return "Mời meeting";
  if (value === "invited_to_orientation") return "Mời orientation";
  if (value === "invited_to_interview") return "Mời phỏng vấn";
  if (value === "interview_scheduled") return "Lên lịch phỏng vấn";
  if (value === "interview_completed") return "Đã phỏng vấn";
  if (value === "interview_passed") return "Đậu phỏng vấn";
  if (value === "approved_as_mentor") return "Đã duyệt làm mentor";
  if (value === "approved_as_mentee") return "Đã duyệt làm mentee";
  if (value === "waitlisted") return "Danh sách chờ";
  if (value === "rejected_or_not_fit") return "Không phù hợp";
  if (value === "withdrawn") return "Rút đơn";
  return value;
}

export default async function AdminApplicationsPage() {
  const adminUser = await getCurrentAdminUser();
  if (!canAccessAdminUser(adminUser?.role)) {
    return (
      <>
        <PageHeader
          title="Không có quyền truy cập"
          description="Chỉ core_team, admin hoặc super_admin được xem danh sách đơn ứng tuyển pilot."
        />
        <ErrorBox message="Bạn không có quyền sử dụng trang này." />
      </>
    );
  }

  const scopeContext = await getAdminScopeContext();
  const scope = await getScopeFilter(scopeContext);
  const [applicationsResult, seasonsResult] = await Promise.all([getApplications(scope), getSeasons(scope)]);
  const seasonsByCode = new Map<string, Season>(
    seasonsResult.data.filter((s) => s.code).map((s) => [s.code as string, s])
  );
  const pilotSeason = seasonsByCode.get(PILOT_SEASON_CODE);
  const pilotSeasonId = pilotSeason?.id ?? null;

  const seasonsById = keyById(seasonsResult.data);

  // Pilot scope: filter to S12 + (intake_batch_id matching S12-B1 if known)
  // We don't know the intake_batch_id ahead of time, so filter by season + by
  // having `source = 'vam_os_form'`. Admin can clear filters in UI.
  const pilotApplications = applicationsResult.data.filter((app) => {
    const isPilotSeason = pilotSeasonId ? app.season_id === pilotSeasonId : true;
    return isPilotSeason;
  });

  const rows: Row[] = pilotApplications.map((app) => {
    const season = app.season_id ? seasonsById.get(app.season_id) : undefined;
    const seasonCode = season?.code ?? null;
    const phonePrimary = (app as Record<string, unknown>).phone_primary as string | null | undefined;
    const fullName = (app as Record<string, unknown>).full_name as string | null | undefined;
    const emailPrimary = (app as Record<string, unknown>).email_primary as string | null | undefined;
    const status = (app as Record<string, unknown>).status as string | null | undefined;
    const source = (app as Record<string, unknown>).source as string | null | undefined;
    const consentDataStorage = (app as Record<string, unknown>).consent_data_storage as
      | boolean
      | null
      | undefined;

    return {
      ...app,
      season_code: seasonCode,
      short_application_id: app.id.slice(0, 8),
      full_name_display: displayText(fullName),
      email_primary_display: displayText(emailPrimary),
      phone_primary_display: displayText(phonePrimary),
      role_applied_display: displayText(app.role_applied),
      status_display: statusLabel(status),
      submitted_at_display: formatDate(app.submitted_at),
      source_display: displayText(source ?? "legacy"),
      consent_data_storage_display: consentDataStorage === true ? "Có" : consentDataStorage === false ? "Không" : "—"
    } as Row;
  });

  const error = applicationsResult.error || seasonsResult.error;
  const seasonOptions = Array.from(new Set(seasonsResult.data.map((s) => s.code).filter(Boolean) as string[])).sort();

  return (
    <>
      <PageHeader
        title={`Đơn ứng tuyển pilot — ${displayCode(PILOT_BATCH_CODE)}`}
        description="Danh sách đơn nộp qua native form VAM OS (chỉ đọc). Mọi action review/approve sẽ ở các trang khác."
      />
      <ErrorBox message={error} />

      {!pilotSeason ? (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Mùa <code>{PILOT_SEASON_CODE}</code> chưa được seed. Hãy chạy migration{" "}
          <code>038_s12_intake_foundation.sql</code> trên Supabase trước khi tiếp tục.
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap gap-2 text-xs text-slate-600">
        <span className="rounded-md border border-vam-line bg-slate-50 px-2 py-1">
          Tổng đơn (S12): <strong>{rows.length}</strong>
        </span>
        <span className="rounded-md border border-vam-line bg-slate-50 px-2 py-1">
          Mentor: <strong>{rows.filter((r) => r.role_applied === "mentor").length}</strong>
        </span>
        <span className="rounded-md border border-vam-line bg-slate-50 px-2 py-1">
          Mentee: <strong>{rows.filter((r) => r.role_applied === "mentee").length}</strong>
        </span>
        <Link
          href="/applications"
          className="ml-auto inline-flex items-center rounded-md border border-vam-line px-2.5 py-1 font-medium text-vam-green hover:bg-vam-mint"
        >
          → Xem danh sách applications cũ (legacy)
        </Link>
      </div>

      <FilterableTable
        rows={rows}
        searchPlaceholder="Tìm theo tên, email hoặc mã đơn"
        searchKeys={["full_name_display", "email_primary_display", "id"]}
        filters={[
          {
            key: "role_applied",
            label: "Vai trò ứng tuyển",
            valueKey: "role_applied",
            options: [
              { label: "Mentor", value: "mentor" },
              { label: "Mentee", value: "mentee" }
            ]
          },
          { key: "status", label: "Trạng thái", valueKey: "status_display" },
          { key: "season_code", label: "Mùa", valueKey: "season_code", options: seasonOptions.map((c) => ({ label: c, value: c })) },
          {
            key: "source",
            label: "Nguồn đơn",
            valueKey: "source_display",
            options: [
              { label: "VAM OS form (pilot)", value: "vam_os_form" },
              { label: "Legacy/khác", value: "legacy" }
            ]
          }
        ]}
        sortOptions={[
          { label: "Ngày nộp mới nhất", key: "submitted_at", direction: "desc", type: "text" },
          { label: "Tên ứng viên A-Z", key: "full_name_display", direction: "asc", type: "text" },
          { label: "Trạng thái A-Z", key: "status_display", direction: "asc", type: "text" }
        ]}
        columns={[
          { key: "short_application_id", label: "Mã đơn" },
          { key: "full_name_display", label: "Họ tên" },
          { key: "email_primary_display", label: "Email", nowrap: true },
          { key: "phone_primary_display", label: "SĐT" },
          { key: "role_applied_display", label: "Vai trò" },
          { key: "status_display", label: "Trạng thái", badge: true },
          { key: "submitted_at_display", label: "Ngày nộp" },
          { key: "source_display", label: "Nguồn" },
          { key: "consent_data_storage_display", label: "Đồng ý lưu DL", badge: true },
          {
            key: "detail",
            label: "Chi tiết",
            internalHrefKey: "id",
            internalHrefPrefix: "/applications/",
            internalLabel: "Xem"
          }
        ]}
      />
    </>
  );
}
