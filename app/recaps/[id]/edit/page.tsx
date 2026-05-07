import Link from "next/link";
import { Card, DetailGrid, EmptyState, ErrorBox, ExternalLinkButton, PageHeader, SimpleTable } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import { getActivityCorrectionLogs, getMentoringRecapById, getPeople, keyById } from "@/lib/data";
import { canOperateAnyScope, getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { displayText, formatDate } from "@/lib/utils";
import { RecapCorrectionForm } from "./correction-form";

export default async function EditRecapPage({ params }: { params: { id: string } }) {
  const adminUser = await getCurrentAdminUser();
  if (!canEditRecaps(adminUser)) {
    return (
      <>
        <PageHeader title="Không có quyền truy cập" description="Chỉ admin hoặc super_admin được sử dụng correction workflow." />
        <ErrorBox message="Bạn có thể xem dữ liệu ở chế độ read-only, nhưng không có quyền sửa mentoring recap." />
      </>
    );
  }
  const scopeContext = await getAdminScopeContext();
  if (!canOperateAnyScope(scopeContext)) {
    return (
      <>
        <PageHeader title="KhĂ´ng cĂ³ quyá»n truy cáº­p" description="Chá»‰ ngÆ°á»i cĂ³ operations/full_access trong scope má»›i Ä‘Æ°á»£c sá»­a recap." />
        <ErrorBox message="Báº¡n khĂ´ng cĂ³ quyá»n operations trong báº¥t ká»³ program/season nĂ o." />
      </>
    );
  }
  const scope = await getScopeFilter(scopeContext);

  const [recap, people, logs] = await Promise.all([
    getMentoringRecapById(params.id, scope),
    getPeople(scope),
    getActivityCorrectionLogs("mentoring_recaps", params.id)
  ]);
  const error = recap.error || people.error || logs.error;
  const peopleById = keyById(people.data);
  const mentee = recap.data?.mentee_person_id ? peopleById.get(recap.data.mentee_person_id) : undefined;
  const mentor = recap.data?.mentor_person_id ? peopleById.get(recap.data.mentor_person_id) : undefined;
  const profilePersonId = recap.data?.mentee_person_id ?? recap.data?.mentor_person_id ?? null;
  const correctedByDefault = adminUser?.full_name ? `${adminUser.full_name} <${adminUser.email}>` : adminUser?.email ?? "admin";

  if (!recap.data) {
    return (
      <>
        <PageHeader title="Không tìm thấy recap" />
        <ErrorBox message={error} />
        <EmptyState message="Không tìm thấy mentoring recap cần chỉnh sửa." />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Sửa mentoring recap" description="Workflow correction nội bộ cho dữ liệu recap. Mọi thay đổi được ghi vào audit log." />
      <ErrorBox message={error} />

      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Tóm tắt recap</h2>
          <DetailGrid
            rows={[
              ["mentee", displayText(mentee?.full_name ?? mentee?.email_primary)],
              ["mentor", displayText(mentor?.full_name ?? mentor?.email_primary)],
              ["current meeting_date", formatDate(recap.data.meeting_date)],
              ["current meeting_month", recap.data.meeting_month],
              ["current status", recap.data.status],
              ["current issue_flag", recap.data.issue_flag === true ? "true" : "false"],
              ["current admin_notes", recap.data.admin_notes]
            ]}
          />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-vam-line bg-slate-50 px-3 py-2">
              <div className="text-xs font-medium uppercase text-slate-500">recap_url</div>
              <div className="mt-1">
                <ExternalLinkButton href={recap.data.recap_url} label="Mở recap" />
              </div>
            </div>
            <div className="rounded-md border border-vam-line bg-slate-50 px-3 py-2">
              <div className="text-xs font-medium uppercase text-slate-500">profile</div>
              <div className="mt-1">
                {profilePersonId ? (
                  <Link href={`/people/${profilePersonId}`} className="text-sm font-medium text-vam-green">
                    Xem profile liên quan
                  </Link>
                ) : (
                  "-"
                )}
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Correction form</h2>
          <RecapCorrectionForm recap={recap.data} personId={profilePersonId} correctedByDefault={correctedByDefault} />
        </Card>
      </div>

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold text-vam-ink">Correction log gần đây</h2>
        <SimpleTable
          rows={logs.data}
          columns={[
            { key: "created_at", label: "created_at", render: (row) => formatDate(row.created_at) },
            { key: "correction_type", label: "correction_type" },
            { key: "field_name", label: "field_name" },
            { key: "old_value", label: "old_value", render: (row) => displayText(row.old_value) },
            { key: "new_value", label: "new_value", render: (row) => displayText(row.new_value) },
            { key: "reason", label: "reason", render: (row) => displayText(row.reason) },
            { key: "corrected_by", label: "corrected_by", render: (row) => displayText(row.corrected_by) }
          ]}
        />
      </section>
    </>
  );
}
