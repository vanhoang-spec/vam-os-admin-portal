import { redirect } from "next/navigation";
import { ErrorBox, PageHeader } from "@/components/ui";
import { QuanTriBaoLoi } from "@/components/bao-loi/quan-tri-bao-loi";
import { chiTietBaoLoi, coQuyenXuLyBaoLoi, dsBaoLoi } from "@/lib/bao-loi";
import { chuanMaBaoLoi } from "@/lib/bao-loi-core";

/**
 * /admin/bao-loi — Quản trị → Báo lỗi (27/10/2026). Báo lỗi / góp ý cải thiện do ban tổ chức gửi từ nút
 * cam ở góc màn hình. Chỉ canManageBaoLoi (super_admin, admin). ?ticket=VAM00012 mở thẳng một báo lỗi.
 */
export const dynamic = "force-dynamic";

const TITLE = "Báo lỗi";
const DESCRIPTION =
  "Báo lỗi và góp ý cải thiện do ban tổ chức gửi từ nút “Báo lỗi” ở góc màn hình. Hỏi lại người gửi khi mô tả chưa rõ, trả lời khi đã xử lý — người gửi thấy trả lời ngay trên VAM OS.";

export default async function QuanTriBaoLoiPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!(await coQuyenXuLyBaoLoi())) redirect("/");
  const searchParams = await props.searchParams;
  const raw = Array.isArray(searchParams.ticket) ? searchParams.ticket[0] : searchParams.ticket;
  const ma = raw ? chuanMaBaoLoi(raw) ?? String(raw).slice(0, 20) : null;
  const [ds, chiTiet] = await Promise.all([dsBaoLoi(), ma ? chiTietBaoLoi(ma) : Promise.resolve(null)]);
  if (!ds.ok) {
    return (
      <div className="grid gap-4">
        <PageHeader title={TITLE} description={DESCRIPTION} />
        <ErrorBox message={ds.error} />
      </div>
    );
  }
  return (
    <div className="grid gap-4">
      <PageHeader title={TITLE} description={DESCRIPTION} />
      <QuanTriBaoLoi ds={ds.value} chon={chiTiet && chiTiet.ok ? chiTiet.value : null} maMo={ma} />
    </div>
  );
}
