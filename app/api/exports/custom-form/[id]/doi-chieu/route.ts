import { NextResponse } from "next/server";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { privateExportHeaders } from "@/lib/application-export-access";
import { CSV_UTF8_BOM, toCsv } from "@/lib/csv-export";
import { MATCHED_BY_LABELS, ROSTER_CHECK_ROLE_LABELS } from "@/lib/form-roster-check-core";
import { checkFormRoster, parseRosterRole } from "@/lib/form-roster-check";
import { canManageCustomForms } from "@/lib/permissions";
import { canBrowseParticipants } from "@/lib/read-access";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Tải CSV đối chiếu form với danh sách mentee/mentor chính thức (Support team 25/10/2026): một dòng
 * mỗi người, cột “Nhóm” để lọc “Chưa nộp” khi nhắc. File có họ tên, email, SĐT của cả danh sách:
 * cổng là quyền vận hành form VÀ quyền xem thành viên — checkFormRoster tự kiểm lại cả hai.
 */
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdminUser();
  if (!admin) return new NextResponse("Unauthorized", { status: 401 });
  if (!canManageCustomForms(admin.role) || !canBrowseParticipants(admin.role)) return new NextResponse("Forbidden", { status: 403 });
  const { id } = await props.params;
  const url = new URL(request.url);
  const role = parseRosterRole(url.searchParams.get("doi_tuong"));
  const check = await checkFormRoster(id, { role, season: url.searchParams.get("season") ?? undefined });
  if (!check.ok) {
    const status = check.message.startsWith("Không tìm thấy") ? 404 : check.message.startsWith("Bạn không có quyền") ? 403 : 500;
    return new NextResponse(check.message, { status });
  }
  const { form, seasonCode, result } = check.data;
  const rows: unknown[][] = [
    ["Nhóm", "Họ và tên", "Email", "Số điện thoại", "Khớp theo", "Số lần nộp", "Gửi lần cuối", "Ghi chú"],
    ...result.notSubmitted.map((p) => ["Chưa nộp", p.name, p.emails[0] ?? "", p.phones[0] ?? "", "", 0, "", ""]),
    ...result.submitted.map((e) => [
      "Đã nộp",
      e.person.name,
      e.person.emails[0] ?? "",
      e.person.phones[0] ?? "",
      MATCHED_BY_LABELS[e.matchedBy],
      e.submissions.length,
      formatDateTime(e.submissions[0]?.createdAt),
      ""
    ]),
    ...result.outsiders.map((o) => [
      "Ngoài danh sách",
      o.submission.name,
      o.submission.emails.join(", "),
      o.submission.phones.join(", "),
      "",
      1,
      formatDateTime(o.submission.createdAt),
      o.note
    ])
  ];
  return new NextResponse(CSV_UTF8_BOM + toCsv(rows), {
    status: 200,
    headers: privateExportHeaders(
      "text/csv; charset=utf-8",
      `doi-chieu-${form.publicCode}-${ROSTER_CHECK_ROLE_LABELS[role].toLowerCase()}-${seasonCode}.csv`
    )
  });
}
