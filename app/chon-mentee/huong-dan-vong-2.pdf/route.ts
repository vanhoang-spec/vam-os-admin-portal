import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ROUND2_GUIDE_PDF_SOURCE } from "@/lib/matching-round2-link-core";

/**
 * File PDF hướng dẫn mentor chọn mentee ở Vòng 2, gắn link trong thư mời (BTC 14/10/2026).
 *
 * Không đặt trong public/: thư mục đó bị cấm có chủ ý — mọi file trong đó thành nguồn ảnh cùng gốc
 * mà bộ tối ưu ảnh của Next đọc được (__tests__/image-optimizer-attack-surface.test.ts, mục 3).
 * Route này trả đúng một file cố định trong kho mã, kiểu application/pdf, và được dựng sẵn lúc
 * build (force-static): production không đọc đĩa, build đọc không được file thì build đỏ.
 *
 * Nằm dưới /chon-mentee/ — đường công khai sẵn có của trang chọn — nên mentor mở được không cần
 * đăng nhập. Nội dung chỉ có dữ liệu mẫu.
 */
export const dynamic = "force-static";

export async function GET() {
  const bytes = await readFile(join(process.cwd(), ROUND2_GUIDE_PDF_SOURCE));
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="huong-dan-chon-mentee-vong-2.pdf"'
    }
  });
}
