import { NextResponse } from "next/server";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import { CSV_UTF8_BOM } from "@/lib/csv-export";
import { listEventScans } from "@/lib/event-checkin";
import { buildCheckinSteps, checkinStepsOf } from "@/lib/event-checkin-steps";
import {
  buildEventRegistrationCsv,
  exportFileName,
  type ExportScan,
  type ExportSession
} from "@/lib/event-export";
import { isValidUuid } from "@/lib/events";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * Tải danh sách đăng ký của một sự kiện về dạng CSV.
 *
 * ---------------------------------------------------------------------------
 * THAM SỐ
 * ---------------------------------------------------------------------------
 *   event_id   uuid   Buổi cần xuất. Bắt buộc.
 *   series     "1"    Xuất cả chuỗi mà buổi này thuộc về, thay vì một buổi.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO GÁC BẰNG `canEditRecaps` CHỨ KHÔNG PHẢI QUYỀN ĐỌC
 * ---------------------------------------------------------------------------
 * File này mang họ tên, email, số điện thoại và MSSV của hàng trăm người, rời
 * khỏi hệ thống thành một file nằm trong thư mục Downloads của ai đó. Nó không
 * còn được ghi vết truy cập, không thu hồi được, và không hết hạn.
 *
 * Nên cổng ở đây bằng đúng cổng của việc VẬN HÀNH sự kiện — người chịu trách
 * nhiệm về buổi đó — chứ không bằng cổng đọc trang chi tiết. Người xem được số
 * liệu tổng hợp không nghiễm nhiên được cầm danh bạ.
 */
export async function GET(request: Request) {
  const adminUser = await getCurrentAdminUser();
  if (!adminUser?.id) {
    return NextResponse.json({ error: "Bạn chưa đăng nhập." }, { status: 401 });
  }
  if (!canEditRecaps(adminUser)) {
    return NextResponse.json(
      { error: "Bạn không có quyền tải danh sách đăng ký." },
      { status: 403 }
    );
  }

  const url = new URL(request.url);
  const eventId = String(url.searchParams.get("event_id") ?? "").trim();
  if (!isValidUuid(eventId)) {
    return NextResponse.json({ error: "Thiếu event_id hợp lệ." }, { status: 400 });
  }
  const wholeSeries = url.searchParams.get("series") === "1";

  const client = getSupabaseServiceRoleClient();
  if (!client) {
    return NextResponse.json({ error: "Chưa cấu hình được Supabase." }, { status: 500 });
  }

  const { data: anchor, error: anchorError } = await client
    .from("events")
    .select("id, event_name, season_id, series_id, series_index, starts_at")
    .eq("id", eventId)
    .maybeSingle();

  if (anchorError || !anchor) {
    return NextResponse.json({ error: "Không tìm thấy sự kiện." }, { status: 404 });
  }

  const event = anchor as Record<string, unknown>;

  // Cổng thứ hai: đúng quyền, nhưng phải đúng MÙA. Một quản trị viên của mùa
  // khác vẫn không cầm được danh sách của mùa này.
  if (!(await canOperateSeason(await getAdminScopeContext(), String(event.season_id ?? "") || null))) {
    return NextResponse.json(
      { error: "Bạn không có quyền vận hành trong mùa của sự kiện này." },
      { status: 403 }
    );
  }

  const seriesId = String(event.series_id ?? "").trim();
  const exportSeries = wholeSeries && Boolean(seriesId);

  // Các buổi cần lấy: một buổi, hoặc cả chuỗi. Mỗi buổi mang các lần quét của
  // riêng nó, để cột lịch sử quét nói đúng chữ trên máy quét của buổi đó.
  const sessionQuery = client.from("events").select("id, series_index, starts_at, checkin_steps");
  const { data: sessionRows, error: sessionError } = exportSeries
    ? await sessionQuery.eq("series_id", seriesId).order("series_index", { ascending: true })
    : await sessionQuery.eq("id", eventId);

  if (sessionError) {
    return NextResponse.json({ error: "Không đọc được danh sách buổi." }, { status: 500 });
  }

  const sessions = new Map<string, ExportSession>();
  for (const row of ((sessionRows ?? []) as Array<Record<string, unknown>>)) {
    sessions.set(String(row.id), {
      id: String(row.id),
      seriesIndex: typeof row.series_index === "number" ? row.series_index : null,
      startsAt: row.starts_at ? String(row.starts_at) : null,
      steps: buildCheckinSteps(checkinStepsOf(row))
    });
  }

  const ids = Array.from(sessions.keys());
  if (!ids.length) ids.push(eventId);

  const { data: registrations, error: registrationError } = await client
    .from("event_registrations")
    .select("*")
    .in("event_id", ids)
    // Buổi trước, rồi tới thứ tự đăng ký: mở file ra là đọc được ngay theo
    // buổi, không phải tự sắp lại trong Excel.
    .order("event_id", { ascending: true })
    .order("registered_at", { ascending: true });

  if (registrationError) {
    return NextResponse.json({ error: "Không đọc được danh sách đăng ký." }, { status: 500 });
  }

  // Đọc lịch sử quét hỏng thì dừng hẳn, không xuất một cột trống: cột trống đọc
  // như "không ai được quét", mà file này là thứ dùng để xét cộng điểm rèn luyện.
  const scanResult = await listEventScans(ids);
  if (scanResult.error) {
    return NextResponse.json({ error: "Không đọc được lịch sử quét." }, { status: 500 });
  }

  const scans = new Map<string, ExportScan[]>();
  for (const scan of scanResult.scans) {
    const list = scans.get(scan.registrationId) ?? [];
    list.push({ station: scan.station, scannedAt: scan.scannedAt });
    scans.set(scan.registrationId, list);
  }

  const csv = buildEventRegistrationCsv(
    (registrations ?? []) as Array<Record<string, unknown>>,
    sessions,
    scans
  );
  const filename = exportFileName(event.event_name, event.starts_at);

  return new NextResponse(CSV_UTF8_BOM + csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // File chứa dữ liệu cá nhân: không để proxy hay trình duyệt giữ lại một
      // bản cho lượt truy cập sau.
      "Cache-Control": "no-store"
    }
  });
}
