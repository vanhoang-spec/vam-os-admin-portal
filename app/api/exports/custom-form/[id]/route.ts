import { NextResponse } from "next/server";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { privateExportHeaders } from "@/lib/application-export-access";
import { answerText, responseColumns } from "@/lib/custom-form-core";
import { listCustomFormResponses } from "@/lib/custom-forms";
import { CSV_UTF8_BOM, toCsv } from "@/lib/csv-export";
import { canManageCustomForms } from "@/lib/permissions";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Tải CSV câu trả lời của một form tùy chỉnh (BTC 15/10/2026). File có họ tên, email, SĐT, có thể có
 * CCCD: cổng là canManageCustomForms (BTC chốt Support team tải được — họ là người làm form), và
 * listCustomFormResponses tự kiểm lại tài khoản active trước khi đọc.
 */
export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdminUser();
  if (!admin) return new NextResponse("Unauthorized", { status: 401 });
  if (!canManageCustomForms(admin.role)) return new NextResponse("Forbidden", { status: 403 });
  const { id } = await props.params;
  const result = await listCustomFormResponses(id);
  if (!result.ok) {
    const status = result.message.startsWith("Không tìm thấy") ? 404 : result.message.startsWith("Bạn không có quyền") ? 403 : 500;
    return new NextResponse(result.message, { status });
  }
  const { form, responses } = result.data;
  const columns = responseColumns(form.fields);
  const rows: unknown[][] = [
    ["Gửi lúc", ...columns.map((c) => c.label)],
    ...responses.map((r) => [formatDateTime(r.createdAt), ...columns.map((c) => answerText(r.answers[c.id]))])
  ];
  return new NextResponse(CSV_UTF8_BOM + toCsv(rows), {
    status: 200,
    headers: privateExportHeaders("text/csv; charset=utf-8", `form-${form.publicCode}.csv`)
  });
}
