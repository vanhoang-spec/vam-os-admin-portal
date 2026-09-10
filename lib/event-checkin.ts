import "server-only";

import { randomBytes } from "node:crypto";
import {
  ENTRANCE_STATION,
  classifyScannedInput,
  collectBadges,
  generateCheckinCode,
  generateShortCode,
  normalizeStation,
  readCheckinCode,
  type ScanBadge
} from "@/lib/event-checkin-code";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

/**
 * lib/event-checkin.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Đổi một mã QR lấy một lượt điểm danh.
 *
 * Luồng thật tại sự kiện: máy của event supporter quét mã trên điện thoại
 * người tham dự. Không ai gõ gì — khác hẳn luồng cũ, nơi người tham dự tự quét
 * mã dùng chung rồi phải gõ email của mình trong hàng người đang chờ.
 *
 * Bảng `event_scans` bật RLS và không có policy nào, nên chỉ service_role chạm
 * tới được; phân quyền thật nằm ở tầng ứng dụng, tại nơi gọi các hàm này.
 */

const VI_ERROR = "Không thực hiện được thao tác điểm danh.";

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string; details?: string };
  console.error("[event-checkin]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint,
    details: err?.details
  });
}

/** Nguồn ngẫu nhiên thật cho mã — `crypto`, không phải `Math.random`. */
function cryptoBytes(size: number): Uint8Array {
  return new Uint8Array(randomBytes(size));
}

/**
 * Bảo đảm một dòng đăng ký có mã điểm danh, và trả về mã đó.
 *
 * Idempotent: đã có mã thì trả lại chính nó. Cấp mã mới cho một người đã nhận
 * email kèm QR nghĩa là tấm vé trong hộp thư của họ ngừng hoạt động, và họ chỉ
 * biết điều đó khi đứng trước cửa.
 *
 * Va chạm mã được xử lý bằng cách thử lại: `event_registrations_checkin_code_uidx`
 * là ràng buộc duy nhất thật ở database, nên hai request song song không thể
 * cùng ghi một mã — một trong hai thua và thử lại.
 */
export type TicketCodes = { code: string; shortCode: string | null };

/**
 * Mã ngắn cho một đăng ký, duy nhất trong sự kiện của nó.
 *
 * Thử lại khi đụng ràng buộc duy nhất: 4 ký tự trên 31 ký tự là ~923 nghìn tổ
 * hợp, nên với vài trăm người mỗi buổi, va chạm hiếm nhưng có thật — và cách
 * duy nhất để biết là để database nói.
 *
 * Hết lượt thử thì trả null chứ không ném: mã ngắn là ĐƯỜNG LÙI, và không cấp
 * được đường lùi thì tấm vé vẫn dùng được bằng QR. Chặn cả việc đăng ký chỉ vì
 * không sinh nổi bốn ký tự là đổi một bất tiện lấy một hỏng hóc.
 */
async function ensureShortCode(
  client: NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>,
  registrationId: string,
  eventId: string
): Promise<string | null> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const shortCode = generateShortCode(cryptoBytes);
    const { error } = await client
      .from("event_registrations")
      .update({ short_code: shortCode })
      .eq("id", registrationId)
      .is("short_code", null);

    if (!error) {
      const { data } = await client
        .from("event_registrations")
        .select("short_code")
        .eq("id", registrationId)
        .maybeSingle();
      const saved = String((data as { short_code?: string } | null)?.short_code ?? "").trim();
      if (saved) return saved;
      continue;
    }

    if ((error as { code?: string }).code !== "23505") {
      log("ensureShortCode", error);
      return null;
    }
  }

  log("ensureShortCode", `hết lượt thử mã ngắn cho sự kiện ${eventId}`);
  return null;
}

export async function ensureCheckinCode(
  registrationId: string
): Promise<{ code: string | null; shortCode: string | null; error: string | null }> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { code: null, shortCode: null, error: VI_ERROR };

  const { data, error } = await client
    .from("event_registrations")
    .select("id, event_id, checkin_code, short_code")
    .eq("id", registrationId)
    .maybeSingle();

  if (error) {
    log("ensureCheckinCode:read", error);
    return { code: null, shortCode: null, error: VI_ERROR };
  }
  if (!data) return { code: null, shortCode: null, error: "Không tìm thấy đăng ký." };

  const row = data as { event_id?: string; checkin_code?: string; short_code?: string };
  const eventId = String(row.event_id ?? "");
  // Mã ngắn cấp một lần rồi thôi, y như mã đầy đủ: cấp lại một mã cho người đã
  // nhận email nghĩa là tấm vé trong hộp thư của họ ngừng hoạt động.
  const shortCode =
    String(row.short_code ?? "").trim() ||
    (eventId ? await ensureShortCode(client, registrationId, eventId) : null);

  const existing = String(row.checkin_code ?? "").trim();
  if (existing) return { code: existing, shortCode, error: null };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateCheckinCode(cryptoBytes);
    const { error: writeError } = await client
      .from("event_registrations")
      .update({ checkin_code: code })
      .eq("id", registrationId)
      // Chỉ ghi khi vẫn còn trống: một request song song vừa cấp mã thì lệnh
      // này không ghi đè lên mã đã gửi đi.
      .is("checkin_code", null);

    if (!writeError) {
      const { data: after } = await client
        .from("event_registrations")
        .select("checkin_code")
        .eq("id", registrationId)
        .maybeSingle();
      const saved = String((after as { checkin_code?: string } | null)?.checkin_code ?? "").trim();
      if (saved) return { code: saved, shortCode, error: null };
      continue;
    }

    // 23505 = trùng khoá duy nhất. Bất kỳ lỗi nào khác là lỗi thật.
    if ((writeError as { code?: string }).code !== "23505") {
      log("ensureCheckinCode:write", writeError);
      return { code: null, shortCode, error: VI_ERROR };
    }
  }

  log("ensureCheckinCode", "hết lượt thử sinh mã không trùng");
  return { code: null, shortCode, error: VI_ERROR };
}

export type TicketData = {
  code: string;
  registrationId: string;
  eventId: string;
  fullName: string;
  registrationStatus: string;
  attendanceStatus: string;
  badges: ScanBadge[];
};

/**
 * Tấm vé của một người, tra theo mã.
 *
 * Trang `/ve/<mã>` là công khai — ai cầm mã đều mở được, và đó đúng là ý định:
 * mã nằm trong hộp thư của chính chủ, và tấm vé phải mở được trên điện thoại
 * đang khoá tài khoản.
 *
 * Vì công khai nên nó CHỈ trả về những gì cần để nhận ra tấm vé: họ tên, trạng
 * thái, các huy hiệu. Không email, không số điện thoại, không mã số sinh viên
 * — chúng không giúp gì cho việc quét, và một mã lọt ra ngoài không được kéo
 * theo hồ sơ của ai.
 */
export async function getTicketByCode(
  code: string
): Promise<{ ticket: TicketData | null; error: string | null }> {
  const normalized = readCheckinCode(code);
  if (!normalized) return { ticket: null, error: null };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ticket: null, error: VI_ERROR };

  const { data, error } = await client
    .from("event_registrations")
    .select("id, event_id, full_name, registration_status, attendance_status, checkin_code")
    .eq("checkin_code", normalized)
    .maybeSingle();

  if (error) {
    log("getTicketByCode", error);
    return { ticket: null, error: VI_ERROR };
  }
  if (!data) return { ticket: null, error: null };

  const row = data as Record<string, unknown>;
  const { data: scans } = await client
    .from("event_scans")
    .select("station, scanned_at")
    .eq("registration_id", String(row.id));

  return {
    ticket: {
      code: normalized,
      registrationId: String(row.id),
      eventId: String(row.event_id),
      fullName: String(row.full_name ?? "").trim(),
      registrationStatus: String(row.registration_status ?? ""),
      attendanceStatus: String(row.attendance_status ?? ""),
      badges: collectBadges(
        ((scans ?? []) as Array<{ station: string; scanned_at: string }>).map((scan) => ({
          station: scan.station,
          scannedAt: scan.scanned_at
        }))
      )
    },
    error: null
  };
}

export type ScanOutcome =
  | { ok: true; repeat: boolean; fullName: string; station: string; badges: ScanBadge[] }
  | { ok: false; reason: "unreadable" | "not_found" | "wrong_event" | "cancelled" | "error"; message: string };

/**
 * Ghi nhận một lần quét.
 *
 * ---------------------------------------------------------------------------
 * BỐN CÂU TỪ CHỐI, MỖI CÂU MỘT LÝ DO KHÁC NHAU
 * ---------------------------------------------------------------------------
 * Người đứng quét đang có một hàng người trước mặt. "Không được" là câu vô
 * dụng nhất có thể trả lời họ: mã lạ, vé của buổi khác, và đăng ký đã huỷ cần
 * ba cách xử lý hoàn toàn khác nhau.
 *
 * Quét lại chính mã đó ở cùng trạm KHÔNG phải lỗi. Máy không đọc được lần đầu,
 * hàng người dồn lại, người quét bấm hai lần — tất cả đều thường xuyên. Lần
 * thứ hai trả về `repeat: true` kèm tên, để người quét biết "đúng người này,
 * đã vào rồi" thay vì thấy một thông báo đỏ.
 */
export async function recordScan(input: {
  eventId: string;
  scanned: string;
  station?: string | null;
  adminUserId: string | null;
}): Promise<ScanOutcome> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, reason: "error", message: VI_ERROR };

  // Hai loại mã, hai PHẠM VI TRA khác nhau — và đó là cả điểm của việc phân
  // loại trước thay vì thử lần lượt:
  //
  //   * mã đầy đủ tra trên toàn hệ thống, vì máy quét đọc được nó trước khi
  //     biết nó thuộc sự kiện nào;
  //   * mã ngắn CHỈ tra trong đúng sự kiện đang mở. Bốn ký tự là đoán được,
  //     nên tra nó trên toàn hệ thống là mở đúng cái cửa nó không được mở.
  const scanned = classifyScannedInput(input.scanned);
  if (scanned.kind === "unreadable") {
    return {
      ok: false,
      reason: "unreadable",
      message: "Mã này không phải vé của chương trình. Kiểm lại xem có quét nhầm mã khác không."
    };
  }

  const stationInput = normalizeStation(input.station ?? ENTRANCE_STATION);
  if (!stationInput.ok) return { ok: false, reason: "error", message: stationInput.message };
  const station = stationInput.station;

  const lookup = client
    .from("event_registrations")
    .select("id, event_id, full_name, registration_status");

  const { data, error } =
    scanned.kind === "full"
      ? await lookup.eq("checkin_code", scanned.code).maybeSingle()
      : await lookup.eq("event_id", input.eventId).eq("short_code", scanned.code).maybeSingle();

  if (error) {
    log("recordScan:lookup", error);
    return { ok: false, reason: "error", message: VI_ERROR };
  }
  if (!data) {
    return { ok: false, reason: "not_found", message: "Không tìm thấy vé ứng với mã này." };
  }

  const row = data as Record<string, unknown>;
  const fullName = String(row.full_name ?? "").trim() || "(chưa có tên)";

  if (String(row.event_id) !== input.eventId) {
    // Nói rõ là vé của buổi khác chứ không nói "không tìm thấy": với sự kiện
    // lặp lại, quét nhầm vé của buổi tuần trước là chuyện sẽ xảy ra.
    return {
      ok: false,
      reason: "wrong_event",
      message: `Vé của ${fullName} thuộc một sự kiện khác, không phải buổi này.`
    };
  }

  if (String(row.registration_status) === "cancelled") {
    return {
      ok: false,
      reason: "cancelled",
      message: `${fullName} đã huỷ đăng ký buổi này.`
    };
  }

  const registrationId = String(row.id);
  const { error: insertError } = await client.from("event_scans").insert({
    event_id: input.eventId,
    registration_id: registrationId,
    station,
    scanned_by: input.adminUserId
  });

  // 23505 = đã quét ở trạm này rồi. Không phải lỗi — xem chú thích ở đầu hàm.
  const repeat = Boolean(insertError) && (insertError as { code?: string }).code === "23505";
  if (insertError && !repeat) {
    log("recordScan:insert", insertError);
    return { ok: false, reason: "error", message: VI_ERROR };
  }

  // Chỉ cửa vào mới là "đã tham dự". Quét ở booth không bao giờ biến một người
  // vắng mặt thành có mặt.
  if (station === ENTRANCE_STATION && !repeat) {
    const { error: markError } = await client
      .from("event_registrations")
      .update({
        attendance_status: "checked_in",
        checked_in_at: new Date().toISOString(),
        checkin_source: "admin_manual"
      })
      .eq("id", registrationId);
    if (markError) log("recordScan:mark", markError);
  }

  const { data: scans } = await client
    .from("event_scans")
    .select("station, scanned_at")
    .eq("registration_id", registrationId);

  return {
    ok: true,
    repeat,
    fullName,
    station,
    badges: collectBadges(
      ((scans ?? []) as Array<{ station: string; scanned_at: string }>).map((scan) => ({
        station: scan.station,
        scannedAt: scan.scanned_at
      }))
    )
  };
}

/** Số lượt quét theo từng trạm của một sự kiện, cho bảng điều khiển. */
export async function countScansByStation(
  eventId: string
): Promise<{ counts: Array<{ station: string; total: number }>; error: string | null }> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { counts: [], error: VI_ERROR };

  const { data, error } = await client
    .from("event_scans")
    .select("station")
    .eq("event_id", eventId);

  if (error) {
    log("countScansByStation", error);
    return { counts: [], error: VI_ERROR };
  }

  const totals = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ station: string }>) {
    const station = String(row.station ?? "").trim();
    if (!station) continue;
    totals.set(station, (totals.get(station) ?? 0) + 1);
  }

  return {
    counts: Array.from(totals.entries())
      .map(([station, total]) => ({ station, total }))
      // Cửa vào luôn đứng đầu: nó là con số người ta hỏi trước tiên.
      .sort((a, b) =>
        a.station === ENTRANCE_STATION ? -1 : b.station === ENTRANCE_STATION ? 1 : b.total - a.total
      ),
    error: null
  };
}
