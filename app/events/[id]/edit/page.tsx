import Link from "next/link";
import { Card, EmptyState, ErrorBox, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import { getIntakeBatches, getSeasons } from "@/lib/data";
import { getEventDetailData, isValidUuid } from "@/lib/events";
import { EventForm } from "../../event-form";
import { CancelEventButton } from "./cancel-event-button";

export default async function EditEventPage({ params }: { params: { id: string } }) {
  const adminUser = await getCurrentAdminUser();
  if (!canEditRecaps(adminUser)) {
    return (
      <>
        <PageHeader title="Không có quyền truy cập" description="Chỉ admin hoặc super_admin được sửa sự kiện." />
        <ErrorBox message="Bạn không có quyền sửa sự kiện." />
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

  const [detail, seasons, intakeBatches] = await Promise.all([
    getEventDetailData(params.id),
    getSeasons(),
    getIntakeBatches()
  ]);

  if (!detail.event) {
    return (
      <>
        <PageHeader title="Không tìm thấy sự kiện" />
        {detail.error ? <ErrorBox message={detail.error} /> : null}
        <EmptyState message="Không tìm thấy sự kiện cần chỉnh sửa." />
      </>
    );
  }

  const seasonsList = seasons.data || detail.seasons;

  const isCancelled = detail.event.status === "cancelled";

  return (
    <>
      <PageHeader title="Sửa sự kiện" description="Cập nhật thông tin sự kiện. Mọi thay đổi sẽ được ghi vào audit log." />
      {detail.error ? <ErrorBox message={detail.error} /> : null}
      {seasons.error ? <ErrorBox message={seasons.error} /> : null}
      {intakeBatches.error ? <ErrorBox message={intakeBatches.error} /> : null}

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Biểu mẫu chỉnh sửa</h2>
          <EventForm
            mode="edit"
            event={detail.event}
            seasons={seasonsList}
            intakeBatches={intakeBatches.data || []}
          />
        </Card>

        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Liên kết nhanh</h2>
          <div className="space-y-3 text-sm text-slate-600">
            <Link href={`/events/${detail.event.id}/attendance`} className="block rounded-md border border-vam-line bg-slate-50 px-3 py-2 font-medium text-vam-green hover:bg-vam-mint">
              Quản lý tham gia
            </Link>
            <Link href="/events" className="block rounded-md border border-vam-line bg-white px-3 py-2 font-medium text-slate-700 hover:bg-slate-50">
              Quay lại danh sách sự kiện
            </Link>
            <p className="text-xs text-slate-500">
              ID: <span className="font-mono">{detail.event.id}</span>
            </p>

            {/* Phase 045A: cancel button (active events only) */}
            {!isCancelled && (
              <div className="border-t border-vam-line pt-3">
                <p className="mb-2 text-xs text-slate-500">
                  Hủy sự kiện sẽ đánh dấu là cancelled và ẩn khỏi danh sách mặc định. Dữ liệu tham gia không bị xóa.
                </p>
                <CancelEventButton eventId={detail.event.id} />
              </div>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
