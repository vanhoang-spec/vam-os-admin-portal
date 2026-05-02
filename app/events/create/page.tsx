import { Card, ErrorBox, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import { getSeasons } from "@/lib/data";
import { EventForm } from "../event-form";

export default async function CreateEventPage() {
  const adminUser = await getCurrentAdminUser();
  if (!canEditRecaps(adminUser)) {
    return (
      <>
        <PageHeader title="Không có quyền truy cập" description="Chỉ admin hoặc super_admin được tạo sự kiện." />
        <ErrorBox message="Bạn không có quyền tạo sự kiện." />
      </>
    );
  }

  const seasons = await getSeasons();

  return (
    <>
      <PageHeader title="Tạo sự kiện" description="Ghi nhận sự kiện/hoạt động mới (training, workshop, orientation, ...)." />
      {seasons.error ? <ErrorBox message={seasons.error} /> : null}

      <div className="grid gap-4 xl:grid-cols-[400px_1fr]">
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Hướng dẫn</h2>
          <div className="space-y-3 text-sm text-slate-600">
            <p>Mọi sự kiện cần được gắn với một <strong>Mùa (Season)</strong> cụ thể.</p>
            <p>
              <strong>Bắt buộc:</strong> Tên sự kiện, Loại, Mùa và Thời điểm bắt đầu.
            </p>
            <p>
              Sau khi tạo, bạn có thể chuyển sang trang <em>Quản lý tham gia</em> để thêm mentor/mentee và đánh dấu trạng thái tham gia.
            </p>
            <p className="text-xs text-slate-500">
              Lưu ý: chương trình (program) hiện được suy ra từ Mùa. Trường địa điểm/mô tả được gộp trong &quot;Ghi chú&quot;.
            </p>
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Biểu mẫu tạo sự kiện</h2>
          <EventForm mode="create" seasons={seasons.data || []} />
        </Card>
      </div>
    </>
  );
}
