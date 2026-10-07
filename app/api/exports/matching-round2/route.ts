import { NextResponse } from "next/server";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { privateExportHeaders } from "@/lib/application-export-access";
import { CSV_UTF8_BOM, toCsv } from "@/lib/csv-export";
import { getRound2Data } from "@/lib/matching-round2";
import { byGroupThenName, type Round2Row } from "@/lib/matching-round2-core";
import { industryGroupLabel } from "@/lib/matching-round2-groups-core";
import { canAssignReview } from "@/lib/permissions";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Xuất CSV báo cáo Vòng 2: ?list=nhom | mentor | mentee | da-ghep.
 *
 * File mang họ tên và email của người thật, nên cổng hẹp hơn cổng xem trang: Support
 * team xem được báo cáo nhưng không tải file; người tải phải có quyền vận hành mùa.
 */
const LISTS = ["nhom", "mentor", "mentee", "da-ghep"] as const;
type List = (typeof LISTS)[number];

function detail(row: Round2Row | null | undefined, label: string): string {
  return row?.person.details.find(([l]) => l === label)?.[1] ?? "";
}

export async function GET(request: Request) {
  const admin = await getCurrentAdminUser();
  if (!admin) return new NextResponse("Unauthorized", { status: 401 });
  if (!canAssignReview(admin.role)) return new NextResponse("Forbidden", { status: 403 });
  const list = new URL(request.url).searchParams.get("list") as List | null;
  if (!list || !LISTS.includes(list)) return new NextResponse(`list phải là một trong: ${LISTS.join(", ")}`, { status: 400 });

  const result = await getRound2Data();
  if (!result.ok) return new NextResponse(result.message, { status: 500 });
  if (!result.data.canManage) return new NextResponse("Forbidden", { status: 403 });
  const { board, seasonCode } = result.data;

  let rows: unknown[][];
  if (list === "nhom") {
    rows = [
      ["Nhóm", "Mentor", "Mentor còn chỗ", "Tổng chỗ còn", "Mentee", "Ghép vòng 1", "Ghép vòng 2", "Ghép khác", "Chưa có mentor", "Đối soát"],
      ...[...board.groups, board.unclassified].map((g) => [
        g.label,
        g.mentors,
        g.mentorsWithSlots,
        g.slots,
        g.mentees,
        g.matchedR1,
        g.matchedR2,
        g.matchedOther,
        g.mentees - g.matchedR1 - g.matchedR2 - g.matchedOther,
        g.reconciled ? "Khớp" : "Lệch"
      ])
    ];
  } else if (list === "mentor") {
    rows = [
      ["Nhóm", "Mentor", "Email", "Chức danh", "Đăng ký", "Đang có", "Còn"],
      ...board.rows
        .filter((r) => r.person.role === "mentor" && r.receivesList)
        .sort(byGroupThenName)
        .map((r) => [industryGroupLabel(r.group), r.person.name, r.person.email ?? "", detail(r, "Chức danh"), r.capacity, r.activeMatches.length, r.slots])
    ];
  } else if (list === "mentee") {
    rows = [
      ["Nhóm", "Mentee", "Email", "Chức năng mục tiêu", "Ngành mục tiêu", "Ngành học", "Năm học"],
      ...board.rows
        .filter((r) => r.person.role === "mentee" && r.menteeState === "visible" && r.group !== null)
        .sort(byGroupThenName)
        .map((r) => [
          industryGroupLabel(r.group),
          r.person.name,
          r.person.email ?? "",
          detail(r, "Chức năng mục tiêu"),
          detail(r, "Ngành mục tiêu"),
          detail(r, "Ngành học"),
          detail(r, "Năm học")
        ])
    ];
  } else {
    rows = [
      ["Nhóm", "Mentor", "Email mentor", "Mentee", "Email mentee", "Thời điểm chọn"],
      ...board.round2Matches.map(({ match, mentor, mentee }) => [
        industryGroupLabel(mentee?.group ?? mentor?.group),
        mentor?.person.name ?? "",
        mentor?.person.email ?? "",
        mentee?.person.name ?? "",
        mentee?.person.email ?? "",
        formatDateTime(match.createdAt)
      ])
    ];
  }
  const filename = `ghep-cap-vong-2_${list}_${seasonCode}.csv`;
  return new NextResponse(CSV_UTF8_BOM + toCsv(rows), { headers: privateExportHeaders("text/csv; charset=utf-8", filename) });
}
