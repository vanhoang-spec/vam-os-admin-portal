import { NextResponse } from "next/server";
import { privateExportHeaders } from "@/lib/application-export-access";
import { exportParticipantProfiles, parseParticipantRole } from "@/lib/participant-export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Xuất Excel toàn bộ hồ sơ Mentor (`?role=mentor`) hoặc Mentee (`?role=mentee`) của mùa đang chọn (VAM00025).
 *
 * GET là đủ: chỉ có vai trò và mã mùa, không có danh sách chọn. Nút trên /mentors, /mentees gửi kèm đúng mã mùa trang
 * đang hiện, nên file và màn hình cùng một mùa. Quyền kiểm Ở MÁY CHỦ trong exportParticipantProfiles, trước mọi phép đọc;
 * vai trò lạ bị từ chối (400) chứ không đoán.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const role = parseParticipantRole(searchParams.get("role"));
  if (!role) return new NextResponse("Thiếu hoặc sai vai trò cần xuất (mentor / mentee).", { status: 400, headers: privateExportHeaders() });

  let result;
  try {
    result = await exportParticipantProfiles(role, searchParams.get("season"));
  } catch (error) {
    console.error("Export participant profiles failed", { role, message: error instanceof Error ? error.message : String(error) });
    return new NextResponse("Không tạo được file. Vui lòng thử lại.", { status: 500, headers: privateExportHeaders() });
  }
  if (!result.ok) return new NextResponse(result.message, { status: result.status, headers: privateExportHeaders() });
  return new NextResponse(new Uint8Array(result.bytes), { headers: privateExportHeaders(XLSX, result.filename) });
}
