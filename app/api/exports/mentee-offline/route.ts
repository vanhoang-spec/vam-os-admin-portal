import { NextResponse } from "next/server";
import { privateExportHeaders } from "@/lib/application-export-access";
import { exportMenteeOffline } from "@/lib/mentee-offline-export";
import { parseExportFilters } from "@/lib/mentee-offline-export-filter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Xuất Excel hồ sơ + phiếu đánh giá của mentee phỏng vấn trực tiếp (VAM00023).
 *
 * POST, không phải GET: danh sách mentee được chọn có thể tới hàng trăm mã, dài hơn giới hạn của đường dẫn. Biểu mẫu trên
 * /interviews/mentee-offline/xuat-excel gửi thẳng tới đây và trình duyệt tải file về.
 *
 * Quyền kiểm Ở MÁY CHỦ, trong exportMenteeOffline: vai trò (canExportMenteeOffline) và quyền vận hành mùa; không có
 * quyền thì không đọc gì. Điều kiện lọc sai dạng bị từ chối (400) chứ không lặng lẽ bỏ qua, vì bỏ một điều kiện nghĩa là
 * xuất rộng hơn người dùng chọn.
 */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new NextResponse("Yêu cầu không hợp lệ.", { status: 400, headers: privateExportHeaders() });
  }
  const parsed = parseExportFilters((key) => {
    const value = form.get(key);
    return typeof value === "string" ? value : null;
  });
  if (!parsed.ok) return new NextResponse(parsed.message, { status: 400, headers: privateExportHeaders() });

  let result;
  try {
    result = await exportMenteeOffline(parsed.filters);
  } catch (error) {
    console.error("Export mentee-offline failed", error);
    return new NextResponse("Không tạo được file. Vui lòng thử lại.", { status: 500, headers: privateExportHeaders() });
  }
  if (!result.ok) return new NextResponse(result.message, { status: result.status, headers: privateExportHeaders() });
  return new NextResponse(new Uint8Array(result.bytes), { headers: privateExportHeaders(XLSX, result.filename) });
}
