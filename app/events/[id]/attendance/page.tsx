import Link from "next/link";
import { Card, EmptyState, ErrorBox, KpiCard, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import { getEventDetailData, isEventAbsenceStatus, isEventAttendedStatus, isValidUuid } from "@/lib/events";
import { canOperateAnyScope, getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { displayText, formatDate } from "@/lib/utils";
import { AddParticipantForm, BulkAddForm, ParticipationRow } from "./attendance-forms";

export default async function EventAttendancePage({ params }: { params: { id: string } }) {
  const scopeContext = await getAdminScopeContext();
  const scope = await getScopeFilter(scopeContext);
  const adminUser = await getCurrentAdminUser();
  if (!canEditRecaps(adminUser) || !canOperateAnyScope(scopeContext)) {
    return (
      <>
        <PageHeader
          title="Không có quyền truy cập"
          description="Chỉ admin hoặc super_admin được quản lý tham gia sự kiện."
        />
        <ErrorBox message="Bạn không có quyền sử dụng chức năng này." />
      </>
    );
  }

  if (!isValidUuid(params.id)) {
    return (
      <>
        <PageHeader
          title="ID sự kiện không hợp lệ"
          description="Đường dẫn không chứa UUID sự kiện hợp lệ."
        />
        <ErrorBox message="ID sự kiện không hợp lệ. Vui lòng quay lại danh sách sự kiện và mở lại từ liên kết chính thức." />
        <Link
          href="/events"
          className="inline-flex w-fit items-center justify-center rounded-md border border-vam-line bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ← Danh sách sự kiện
        </Link>
      </>
    );
  }

  const detail = await getEventDetailData(params.id, scope);

  if (!detail.event) {
    return (
      <>
        <PageHeader title="Không tìm thấy sự kiện" />
        {detail.error ? <ErrorBox message={detail.error} /> : null}
        <EmptyState message="Không tìm thấy sự kiện cần quản lý." />
      </>
    );
  }

  const peopleById = new Map(detail.people.map((person) => [person.id, person]));
  const seasonsById = new Map(detail.seasons.map((season) => [season.id, season]));
  const seasonCode = detail.event.season_id ? (seasonsById.get(detail.event.season_id)?.code ?? null) : null;
  const existingPersonIds = new Set(
    detail.participations.map((row) => row.person_id).filter((id): id is string => Boolean(id))
  );

  // KPI calculations
  const totalCount = detail.participations.length;
  const attendedCount = detail.participations.filter((row) => isEventAttendedStatus(row.attendance_status)).length;
  const absentCount = detail.participations.filter((row) => isEventAbsenceStatus(row.attendance_status)).length;
  const notUpdatedCount = detail.participations.filter((row) => {
    return !isEventAttendedStatus(row.attendance_status) && !isEventAbsenceStatus(row.attendance_status);
  }).length;
  const walkInCount = detail.participations.filter(
    (row) => row.walk_in === true || String(row.walk_in) === "true"
  ).length;

  const sortedRows = [...detail.participations].sort((a, b) => {
    const left = (peopleById.get(String(a.person_id ?? ""))?.full_name ?? "").toLowerCase();
    const right = (peopleById.get(String(b.person_id ?? ""))?.full_name ?? "").toLowerCase();
    return left.localeCompare(right, "vi");
  });

  const intakeBatchId = detail.event.intake_batch_id ?? null;

  return (
    <>
      <PageHeader
        title="Quản lý tham gia"
        description={`${displayText(detail.event.event_name)} · ${displayText(seasonCode)} · ${formatDate(detail.event.starts_at)}`}
      />
      {detail.error ? <ErrorBox message={detail.error} /> : null}

      <div className="mb-4 flex flex-wrap gap-3">
        <Link
          href="/events"
          className="inline-flex w-fit items-center justify-center rounded-md border border-vam-line bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ← Danh sách sự kiện
        </Link>
        <Link
          href={`/events/${detail.event.id}/edit`}
          className="inline-flex w-fit items-center justify-center rounded-md border border-vam-line bg-white px-3 py-2 text-sm font-medium text-vam-green hover:bg-vam-mint"
        >
          Sửa sự kiện
        </Link>
      </div>

      {/* KPI summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Tổng trong danh sách" value={totalCount} />
        <KpiCard label="Đã tham gia" value={attendedCount} />
        <KpiCard label="Vắng" value={absentCount} />
        <KpiCard label="Chưa cập nhật trạng thái" value={notUpdatedCount} />
        <KpiCard label="Walk-in" value={walkInCount} />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[420px_1fr]">
        {/* Left panel: add forms */}
        <div className="flex flex-col gap-4">
          <Card>
            <h2 className="mb-3 text-base font-semibold text-vam-ink">Thêm người tham gia</h2>
            <AddParticipantForm
              eventId={detail.event.id}
              people={detail.people}
              mentorProfiles={detail.mentorProfiles}
              menteeProfiles={detail.menteeProfiles}
              existingPersonIds={existingPersonIds}
              intakeBatchId={intakeBatchId}
            />
          </Card>

          {/* Bulk add — only shown when event is linked to a batch */}
          {intakeBatchId ? (
            <Card>
              <h2 className="mb-1 text-base font-semibold text-vam-ink">Thêm hàng loạt theo batch</h2>
              <p className="mb-3 text-xs text-slate-500">
                Thêm tất cả mentor hoặc mentee đã có hồ sơ trong batch này vào danh sách điểm danh.
              </p>
              <BulkAddForm eventId={detail.event.id} />
            </Card>
          ) : (
            <Card>
              <h2 className="mb-1 text-base font-semibold text-slate-400">Thêm hàng loạt theo batch</h2>
              <p className="text-xs text-slate-400">
                Sự kiện này chưa được gắn đợt tuyển.{" "}
                <Link href={`/events/${detail.event.id}/edit`} className="text-vam-green underline hover:no-underline">
                  Sửa sự kiện
                </Link>{" "}
                để bật tính năng này.
              </p>
            </Card>
          )}
        </div>

        {/* Right panel: participant table */}
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">
            Danh sách người tham gia{" "}
            <span className="text-sm font-normal text-slate-500">({totalCount})</span>
          </h2>
          {sortedRows.length === 0 ? (
            <EmptyState message="Chưa có người nào được thêm vào sự kiện." />
          ) : (
            <div className="overflow-hidden rounded-lg border border-vam-line bg-white">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-vam-line text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Người tham gia</th>
                      <th className="px-4 py-3">Nhanh / Cập nhật</th>
                      <th className="px-4 py-3">Thông tin</th>
                      <th className="px-4 py-3">Xoá</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-vam-line">
                    {sortedRows.map((row) => (
                      <ParticipationRow
                        key={row.id}
                        eventId={detail.event!.id}
                        row={row}
                        person={row.person_id ? peopleById.get(row.person_id) : undefined}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
