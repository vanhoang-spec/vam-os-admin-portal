import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { HANDBOOKS, HANDBOOK_PENDING_MESSAGE, type HandbookRole } from "@/lib/handbook";

/**
 * Phản hồi của /tai-lieu/handbook-*.pdf. Cùng nếp với file hướng dẫn Vòng 2
 * (app/chon-mentee/huong-dan-vong-2.pdf/route.ts): không đặt trong public/ (thư mục bị cấm có chủ ý —
 * xem __tests__/image-optimizer-attack-surface.test.ts), route dựng sẵn lúc build nên production không
 * đọc đĩa. File chưa có (ready = false) thì trả 404 "đang cập nhật" thay vì làm build đỏ.
 */
export async function handbookPdfResponse(role: HandbookRole): Promise<Response> {
  const h = HANDBOOKS[role];
  if (!h.ready) {
    return new Response(HANDBOOK_PENDING_MESSAGE, {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
  const bytes = await readFile(join(process.cwd(), h.source));
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${h.filename}"`
    }
  });
}
