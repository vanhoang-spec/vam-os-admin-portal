"use client";

/**
 * Nút cam "Báo lỗi" nằm trên thanh trên cùng, ngay cạnh nút Hướng dẫn sử dụng (VAM00013, chủ chương trình 04/11/2026).
 * Trước đó nút nổi ở góc dưới trái và che chỗ bấm của trang (vd nút sửa form ở /forms).
 *
 * Từ màn hình sm trở lên mới hiện; điện thoại vẫn ẩn như chủ chương trình đã chốt 03/11 (gửi báo lỗi qua /bao-loi).
 * Nút chỉ bắn sự kiện; hộp báo lỗi nằm ở NutBaoLoi cuối AppShell (xem lib/bao-loi-su-kien.ts vì sao không đặt hộp ở đây).
 * Ẩn ở chính trang /bao-loi, vì trang đó đã là form.
 */
import { usePathname } from "next/navigation";
import { MO_FORM_BAO_LOI } from "@/lib/bao-loi-su-kien";

export function NutBaoLoiTrenThanh() {
  const pathname = usePathname() ?? "/";
  if (pathname === "/bao-loi") return null;
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(MO_FORM_BAO_LOI))}
      aria-haspopup="dialog"
      title="Gặp trục trặc hoặc có góp ý? Báo cho ban xử lý"
      className="hidden h-9 items-center gap-1.5 rounded-full border border-orange-600 bg-orange-500 px-3 text-sm font-bold text-white hover:bg-orange-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-1 print:hidden sm:inline-flex"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M12 2 1 21h22L12 2Zm0 5.5 7.5 12.5h-15L12 7.5Zm-1 3.5v4h2v-4h-2Zm0 5.5V18h2v-1.5h-2Z" />
      </svg>
      Báo lỗi
    </button>
  );
}
