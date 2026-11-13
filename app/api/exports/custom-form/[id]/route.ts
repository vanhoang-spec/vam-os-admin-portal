import { NextResponse } from "next/server";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { privateExportHeaders } from "@/lib/application-export-access";
import { answerText, responseColumns } from "@/lib/custom-form-core";
import { listCustomFormResponses } from "@/lib/custom-forms";
import { CSV_UTF8_BOM, toCsv } from "@/lib/csv-export";
import { isUuid } from "@/lib/participant-invite-core";
import { canManageCustomForms } from "@/lib/permissions";
import { formatDateTime } from "@/lib/utils";
import { plainTableXlsx } from "@/lib/xlsx-grouped-table";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Tải câu trả lời của một form tùy chỉnh, CSV (BTC 15/10/2026) hoặc Excel `?dinh_dang=xlsx` (VAM00032).
 *
 * File có họ tên, email, SĐT, có thể có CCCD: cổng là canManageCustomForms (BTC chốt Support team tải được — họ là
 * người làm form), và listCustomFormResponses tự kiểm lại tài khoản active trước khi đọc. Hai định dạng đi chung MỘT
 * cổng, MỘT nguồn dữ liệu (đọc phân trang tới hết) và MỘT danh sách cột: tách thành route riêng là thêm một chỗ để
 * quyền hoặc cột của Excel lệch khỏi CSV mà không ai thấy.
 *
 * Tham số sai dạng bị từ chối (400) chứ không lặng lẽ trả CSV: người bấm "Xuất Excel" nhận về một file khác loại sẽ
 * tưởng nút hỏng, còn đường dẫn gõ tay sai thì nên báo sai.
 */
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdminUser();
  if (!admin) return new NextResponse("Unauthorized", { status: 401 });
  if (!canManageCustomForms(admin.role)) return new NextResponse("Forbidden", { status: 403 });
  const { id } = await props.params;
  const format = new URL(request.url).searchParams.get("dinh_dang") ?? "csv";
  if (!isUuid(id) || (format !== "csv" && format !== "xlsx")) {
    return new NextResponse("Yêu cầu không hợp lệ.", { status: 400, headers: privateExportHeaders() });
  }
  const result = await listCustomFormResponses(id);
  if (!result.ok) {
    const status = result.message.startsWith("Không tìm thấy") ? 404 : result.message.startsWith("Bạn không có quyền") ? 403 : 500;
    return new NextResponse(result.message, { status });
  }
  const { form, responses } = result.data;
  const columns = responseColumns(form.fields);
  const header = ["Gửi lúc", ...columns.map((c) => c.label)];
  const body = responses.map((r) => [formatDateTime(r.createdAt), ...columns.map((c) => answerText(r.answers[c.id]))]);

  if (format === "xlsx") {
    const bytes = plainTableXlsx(header, body, { sheetName: "Câu trả lời", widths: [18, ...columns.map(() => 28)] });
    return new NextResponse(new Uint8Array(bytes), { status: 200, headers: privateExportHeaders(XLSX, `form-${form.publicCode}.xlsx`) });
  }
  return new NextResponse(CSV_UTF8_BOM + toCsv([header, ...body]), {
    status: 200,
    headers: privateExportHeaders("text/csv; charset=utf-8", `form-${form.publicCode}.csv`)
  });
}
