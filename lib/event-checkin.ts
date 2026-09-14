import "server-only";

import { randomBytes } from "node:crypto";
import {
  classifyScannedInput,
  generateCheckinCode,
  generateShortCode,
  readCheckinCode
} from "@/lib/event-checkin-code";
import {
  buildCheckinSteps,
  checkinStepsOf,
  collectBadges,
  needsCheckInReminder,
  type ScanBadge
} from "@/lib/event-checkin-steps";
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
  | {
      ok: true;
      repeat: boolean;
      fullName: string;
      station: string;
      /** "Quét lần 2 · Check out" — đúng chữ trên máy quét. */
      stationLabel: string;
      badges: ScanBadge[];
      /** Quét một lần khác mà người này chưa qua lần Check in nào của sự kiện. */
      missingCheckIn: boolean;
    }
  | {
      ok: false;
      reason: "unreadable" | "not_found" | "wrong_event" | "cancelled" | "stale_step" | "error";
      message: string;
    };

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

  // Lần quét phải là một lần ĐANG CÓ trong thiết lập của sự kiện. Máy quét chỉ cho
  // chọn trong danh sách, nhưng danh sách trên máy là bản đọc lúc mở trang: BTC sửa
  // thiết lập giữa buổi thì máy đang mở vẫn gửi lần quét cũ. Ghi nó vào là tạo ra
  // một trạm không ai thiết lập, đếm lệch khỏi mọi con số trên trang.
  const { data: eventRow, error: eventError } = await client
    .from("events")
    .select("id, checkin_steps")
    .eq("id", input.eventId)
    .maybeSingle();

  if (eventError) {
    log("recordScan:event", eventError);
    return { ok: false, reason: "error", message: VI_ERROR };
  }
  if (!eventRow) {
    return { ok: false, reason: "not_found", message: "Không tìm thấy sự kiện." };
  }

  const steps = buildCheckinSteps(checkinStepsOf(eventRow as { checkin_steps?: unknown }));
  const requested = String(input.station ?? "").trim();
  // Không gửi lần quét nào (gọi từ một chỗ khác máy quét) thì là lần quét đầu tiên.
  const step = requested ? steps.find((candidate) => candidate.station === requested) : steps[0];
  if (!step) {
    return {
      ok: false,
      reason: "stale_step",
      message:
        "Lần quét đang chọn không còn trong thiết lập của sự kiện. Tải lại trang máy quét rồi chọn lại lần quét."
    };
  }
  const station = step.station;

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

  // Mọi lần quét đều tính là đã tham dự — chủ dự án chốt 14/09/2026: được quét ở
  // bất kỳ điểm nào trong sự kiện là đã có mặt, nên sự kiện chỉ có Check out vẫn
  // đếm đúng người tham dự.
  //
  // Chỉ ghi khi CHƯA check-in: người Check in lúc 8 giờ rồi Check out lúc 11 giờ
  // thì giờ check-in vẫn là 8 giờ. Ghi đè là mất đúng mốc dùng để xét có mặt từ
  // đầu buổi.
  //
  // Chạy cả khi quét lại: lần quét trước có thể đã ghi được lượt quét mà chưa ghi
  // được trạng thái tham dự. Người đã check-in thì điều kiện lọc làm lệnh này
  // không chạm dòng nào.
  const { error: markError } = await client
    .from("event_registrations")
    .update({
      attendance_status: "checked_in",
      checked_in_at: new Date().toISOString(),
      checkin_source: "admin_manual"
    })
    .eq("id", registrationId)
    .neq("attendance_status", "checked_in");
  if (markError) log("recordScan:mark", markError);

  const { data: scans, error: scansError } = await client
    .from("event_scans")
    .select("station, scanned_at")
    .eq("registration_id", registrationId);

  const history = ((scans ?? []) as Array<{ station: string; scanned_at: string }>).map((scan) => ({
    station: scan.station,
    scannedAt: scan.scanned_at
  }));

  return {
    ok: true,
    repeat,
    fullName,
    station,
    stationLabel: step.label,
    badges: collectBadges(history, steps),
    // Không đọc được lịch sử thì không nhắc: nhắc sai "chưa Check in" với người đã
    // qua cửa là giữ họ lại vô cớ giữa một hàng người.
    missingCheckIn: scansError
      ? false
      : needsCheckInReminder(
          steps,
          station,
          history.map((scan) => scan.station)
        )
  };
}

/** Số dòng xin mỗi lần đọc. Supabase mặc định trả tối đa 1.000 dòng một lần. */
const SCAN_PAGE_SIZE = 1000;

/** Chặn vòng đọc chạy mãi nếu máy chủ bỏ qua phân trang: 200 trang là 200.000 lượt quét. */
const SCAN_PAGE_LIMIT = 200;

export type EventScanRow = { registrationId: string; station: string; scannedAt: string };

/**
 * Mọi lượt quét của một hay nhiều buổi, đọc theo từng trang.
 *
 * Supabase cắt mỗi lần đọc ở 1.000 dòng và KHÔNG báo lỗi. Một buổi 300 người
 * quét bốn lần đã là 1.200 dòng: đọc một lần thì số đếm trên trang và cột lịch sử
 * quét trong file xuất lặng lẽ thiếu những người quét sau cùng.
 *
 * Trang sau bắt đầu từ chỗ trang trước THẬT SỰ dừng, không phải chỗ nó được xin
 * dừng: máy chủ đặt giới hạn thấp hơn 1.000 thì vẫn đọc đủ. Chỉ dừng khi gặp một
 * trang rỗng.
 */
export async function listEventScans(
  eventIds: string[]
): Promise<{ scans: EventScanRow[]; error: string | null }> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { scans: [], error: VI_ERROR };
  if (!eventIds.length) return { scans: [], error: null };

  const scans: EventScanRow[] = [];
  let offset = 0;

  for (let page = 0; page < SCAN_PAGE_LIMIT; page += 1) {
    const { data, error } = await client
      .from("event_scans")
      .select("id, registration_id, station, scanned_at")
      .in("event_id", eventIds)
      // Thứ tự cố định theo khoá chính: phân trang không có thứ tự thì hai trang
      // có thể trùng dòng hoặc bỏ sót dòng.
      .order("id", { ascending: true })
      .range(offset, offset + SCAN_PAGE_SIZE - 1);

    if (error) {
      log("listEventScans", error);
      return { scans: [], error: VI_ERROR };
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    if (!rows.length) return { scans, error: null };

    for (const row of rows) {
      scans.push({
        registrationId: String(row.registration_id ?? ""),
        station: String(row.station ?? ""),
        scannedAt: String(row.scanned_at ?? "")
      });
    }
    offset += rows.length;
  }

  // Trả lỗi chứ không trả phần đã đọc: một con số thiếu mà trông như đủ là thứ
  // tệ hơn không có con số nào.
  log("listEventScans", `vượt ${SCAN_PAGE_LIMIT} trang, dừng đọc`);
  return { scans: [], error: VI_ERROR };
}

/**
 * Số lượt quét theo từng trạm của một sự kiện.
 *
 * Thứ tự hiển thị không quyết định ở đây mà ở `summarizeStepCounts`, theo đúng
 * thứ tự các lần quét BTC đã đặt.
 */
export async function countScansByStation(
  eventId: string
): Promise<{ counts: Array<{ station: string; total: number }>; error: string | null }> {
  const { scans, error } = await listEventScans([eventId]);
  if (error) return { counts: [], error };

  const totals = new Map<string, number>();
  for (const scan of scans) {
    const station = scan.station.trim();
    if (!station) continue;
    totals.set(station, (totals.get(station) ?? 0) + 1);
  }

  return {
    counts: Array.from(totals.entries()).map(([station, total]) => ({ station, total })),
    error: null
  };
}
