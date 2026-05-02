import Link from "next/link";
import { Card, EmptyState, ErrorBox, KpiCard, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import { getEventDetailData, isValidUuid } from "@/lib/events";
import { displayText, formatDate } from "@/lib/utils";
import { AddParticipantForm, ParticipationRow } from "./attendance-forms";

export default async function EventAttendancePage({ params }: { params: { id: string } }) {
  const adminUser = await getCurrentAdminUser();
  if (!canEditRecaps(adminUser)) {
    return (
      <>
        <PageHeader title="Không có quyền truy cập" description="Chỉ admin hoặc super_admin được quản lý tham gia sự kiện." />
        <ErrorBox message="Bạn không có quyền sử dụng chức năng này." />
      </>
    );
  }

  if (!isValidUuid(params.id)) {
    return (
      <>
        <PageHeader title="ID sự kiện không hợp lệ" description="Đường dẫn không chứa UUID sự kiện hợp lệ." />
        <ErrorBox message="ID sự kiện không hợp lệ. Vui lòng quay lại danh sách sự kiện và mở lại từ liên kết chính thức." />
        <Link href="/events" className="inline-flex w-fit items-center justify-center rounded-md border border-vam-line bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          ← Danh sách sự kiện
        </Link>
      </>
    );
  }

  const detail = await getEventDetailData(params.id);

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
  const seasonCode = detail.event.season_id ? seasonsById.get(detail.event.season_id)?.code ?? null : null;
  const existingPersonIds = new Set(detail.participations.map((row) => row.person_id).filter((id): id is string => Boolean(id)));

  const attendedCount = detail.participations.filter((row) => String(row.attendance_status ?? "").trim() === "attended").length;
  const absentCount = detail.participations.filter((row) => String(row.attendance_status ?? "").trim() === "registered_absent").length;
  const sortedRows = [...detail.participations].sort((a, b) => {
    const left = (peopleById.get(String(a.person_id ?? ""))?.full_name ?? "").toLowerCase();
    const right = (peopleById.get(String(b.person_id ?? ""))?.full_name ?? "").toLowerCase();
    return left.localeCompare(right, "vi");
  });

  return (
    <>
      <PageHeader title="Quản lý tham gia" description={`Sự kiện: ${displayText(detail.event.event_name)} (${displayText(seasonCode)})`} />
      {detail.error ? <ErrorBox message={detail.error} /> : null}

      <div className="mb-4 flex flex-wrap gap-3">
        <Link href="/events" className="inline-flex w-fit items-center justify-center rounded-md border border-vam-line bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          ← Danh sách sự kiện
        </Link>
        <Link href={`/events/${detail.event.id}/edit`} className="inline-flex w-fit items-center justify-center rounded-md border border-vam-line bg-white px-3 py-2 text-sm font-medium text-vam-green hover:bg-vam-mint">
          Sửa sự kiện
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Tổng người tham gia" value={detail.participations.length} />
        <KpiCard label="Đã tham gia" value={attendedCount} />
        <KpiCard label="Đăng ký nhưng không tham gia" value={absentCount} />
        <KpiCard label="Thời điểm" value={formatDate(detail.event.starts_at)} />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[420px_1fr]">
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Thêm người tham gia</h2>
          <AddParticipantForm
            eventId={detail.event.id}
            people={detail.people}
            mentorProfiles={detail.mentorProfiles}
            menteeProfiles={detail.menteeProfiles}
            existingPersonIds={existingPersonIds}
          />
        </Card>

        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Danh sách người tham gia</h2>
          {sortedRows.length === 0 ? (
            <EmptyState message="Chưa có người nào được thêm vào sự kiện." />
          ) : (
            <div className="overflow-hidden rounded-lg border border-vam-line bg-white">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-vam-line text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Người tham gia</th>
                      <th className="px-4 py-3">Vai trò / Trạng thái / Ghi chú</th>
                      <th className="px-4 py-3">Thông tin cập nhật</th>
                      <th className="px-4 py-3">Hành động</th>
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
