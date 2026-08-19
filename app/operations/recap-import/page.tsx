import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, ErrorBox, KpiCard, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import { canOperateAnyScope, getAdminScopeContext } from "@/lib/program-scope";
import { getRecapImportView } from "@/lib/recap-import";
import { RecapImportClient } from "./recap-import-client";

/**
 * Page: /operations/recap-import
 *
 * What the Chrome collector brought back from the group, waiting for somebody
 * to say yes.
 *
 * Nothing on this screen has become a recap yet. The parser reads posts written
 * by students in whatever shape they felt like, so the last step is a person
 * looking at a list — bulk-approving the ones it got right, and deciding the
 * handful it could not.
 */
export const dynamic = "force-dynamic";

function param(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function RecapImportPage({
  searchParams
}: {
  searchParams?: { batch_id?: string | string[] };
}) {
  const adminUser = await getCurrentAdminUser();
  if (!adminUser?.id) redirect("/login");
  if (!canEditRecaps(adminUser)) redirect("/operations");

  const scopeContext = await getAdminScopeContext();
  const allowDecide = canOperateAnyScope(scopeContext);

  const view = await getRecapImportView({ batchId: param(searchParams?.batch_id).trim() || null });

  const matched = view.items.filter((item) => item.status === "matched").length;
  const needsReview = view.items.filter((item) => item.status === "needs_review").length;
  const imported = view.items.filter((item) => item.status === "imported").length;
  const truncated = view.items.filter((item) => item.content_truncated).length;

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Thu recap từ group Facebook"
        description="Các bài mentee đăng trong group, do tiện ích VAM Recap Collector mang về. Chưa bài nào thành recap — bấm duyệt thì mới ghi vào hệ thống, kèm đúng đường dẫn bài gốc."
      />

      {view.error ? <ErrorBox message={view.error} /> : null}

      {!allowDecide ? (
        <ErrorBox message="Bạn xem được danh sách này nhưng chưa có quyền vận hành mùa nào, nên chưa duyệt được. Liên hệ super admin để được cấp quyền." />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Khớp tự động" value={matched} helper="Đã tìm ra mentee theo MSSV" />
        <KpiCard label="Cần người quyết" value={needsReview} helper="Thiếu MSSV hoặc chưa có cặp ghép" />
        <KpiCard label="Đã tạo recap" value={imported} helper="Trong lượt thu này" />
        <KpiCard label="Nghi bị cắt ngắn" value={truncated} helper="Nên mở bài gốc đọc lại" />
      </div>

      {view.batches.length === 0 ? (
        <Card>
          <div className="grid gap-3 text-sm text-slate-600">
            <p className="font-medium text-slate-800">Chưa có lượt thu nào.</p>
            <p>
              Cài tiện ích <strong>VAM Recap Collector</strong> lên Chrome, mở group Facebook của
              chương trình, chọn xem bài theo thứ tự mới nhất, rồi bấm “Quét bài trong kỳ” và “Gửi
              vào VAM OS”. Hướng dẫn từng bước nằm trong tài liệu dành cho BTC.
            </p>
            <p>
              Quét trùng khoảng thời gian không sao cả: bài nào đã thu rồi thì hệ thống tự bỏ qua,
              nên nếu lỡ kỳ trước thì cứ quét rộng ra để lấy lại phần đã sót.
            </p>
          </div>
        </Card>
      ) : (
        <RecapImportClient
          batches={view.batches}
          selectedBatchId={view.batch?.id ?? null}
          items={view.items}
          menteeOptions={view.menteeOptions}
          allowDecide={allowDecide}
        />
      )}

      <Card>
        <div className="flex flex-wrap gap-4 text-sm">
          <Link className="text-emerald-700 underline" href="/operations/monthly">
            Xem recap theo tháng
          </Link>
          <Link className="text-emerald-700 underline" href="/operations">
            Về bảng vận hành
          </Link>
        </div>
      </Card>
    </div>
  );
}
