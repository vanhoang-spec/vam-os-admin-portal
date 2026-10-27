import { TicketCuaToi, TrangGuiBaoLoi } from "@/components/bao-loi/ticket-cua-toi";
import { baoLoiCuaToi } from "@/lib/bao-loi";
import { chuanMaBaoLoi } from "@/lib/bao-loi-core";

/**
 * /bao-loi — trang của người gửi báo lỗi / góp ý (27/10/2026). Không tham số: form gửi mới (link gửi
 * qua Zalo cho ban tổ chức). ?ticket=VAM00012: báo lỗi của CHÍNH người đang đăng nhập + luồng hỏi lại,
 * trả lời bổ sung. Mọi tài khoản ban tổ chức đang active dùng được (AppShell đã đòi đăng nhập).
 */
export const dynamic = "force-dynamic";

export default async function BaoLoiPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const searchParams = await props.searchParams;
  const raw = Array.isArray(searchParams.ticket) ? searchParams.ticket[0] : searchParams.ticket;
  if (raw) {
    const ma = chuanMaBaoLoi(raw) ?? String(raw).slice(0, 20);
    const x = chuanMaBaoLoi(raw) ? await baoLoiCuaToi(raw) : null;
    return <TicketCuaToi key={ma} ma={ma} x={x} />;
  }
  return <TrangGuiBaoLoi />;
}
