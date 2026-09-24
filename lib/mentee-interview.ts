import "server-only";

import {
  HOTLINE_ZALO,
  SUPPORT_NAME,
  SUPPORT_PHONE,
  type MenteeSessionDay,
  type SessionRow,
  bookingClosesAt,
  buildSessionDays,
  hasBookableSession,
  sessionFullLabel,
  totalRemaining
} from "@/lib/mentee-interview-core";
import { BOOKING_ELIGIBLE_STATUSES } from "@/lib/interview-schedule-core";
import { readAllPages } from "@/lib/paged-read";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { formatDate, formatTime } from "@/lib/utils";

/**
 * lib/mentee-interview.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Tầng máy chủ của trang đặt ca phỏng vấn mentee.
 *
 * Phép giữ chỗ KHÔNG nằm ở đây. Nó nằm trong vam101_book_mentee_session, vì
 * sức chứa một ca là một phép đếm dưới khoá hàng, và đọc-rồi-ghi ở tầng này sẽ
 * để hai người cuối cùng cùng lấy chỗ cuối. File này chỉ đọc để vẽ trang, và
 * dịch mã lỗi của hàm kia sang câu tiếng Việt.
 */

type Json = Record<string, any>;

const SAFE_ERROR = "Hệ thống đang bận, thử lại sau ít phút.";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function log(message: string, error?: unknown) {
  console.error(`[mentee-interview] ${message}`, error ?? "");
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value.trim());
}

function normIso(value: unknown): string {
  const at = new Date(String(value ?? ""));
  return Number.isNaN(at.getTime()) ? "" : at.toISOString();
}

function serviceClient() {
  try {
    return getSupabaseServiceRoleClient();
  } catch (error) {
    log("service client unavailable", error);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Đọc trang
// ─────────────────────────────────────────────────────────────────────────────

export type MenteeSessionPageData =
  | { ok: false; state: "invalid"; message: string }
  | {
      ok: true;
      state: "booked";
      candidateName: string;
      booking: { sessionLabel: string; venue: string | null };
      hotlineZalo: string;
      support: { name: string; phone: string };
    }
  | {
      ok: true;
      state: "ineligible";
      candidateName: string;
      message: string;
      hotlineZalo: string;
      support: { name: string; phone: string };
    }
  | {
      ok: true;
      state: "eligible";
      candidateName: string;
      days: MenteeSessionDay[];
      anyBookable: boolean;
      totalRemaining: number;
      deadlineLabel: string | null;
      hotlineZalo: string;
      support: { name: string; phone: string };
    };

const INVALID_LINK: MenteeSessionPageData = {
  ok: false,
  state: "invalid",
  message:
    "Không tìm thấy trang đặt ca. Đường dẫn có thể đã bị chép thiếu — bạn mở lại từ email của ban tổ chức."
};

const SUPPORT = { name: SUPPORT_NAME, phone: SUPPORT_PHONE };

export async function getMenteeSessionPageData(token: unknown): Promise<MenteeSessionPageData> {
  const client = serviceClient();
  if (!client) return { ok: false, state: "invalid", message: SAFE_ERROR };

  const cleanToken = clean(token);
  if (!cleanToken || !isValidUuid(cleanToken)) return INVALID_LINK;

  const { data: invite, error: inviteError } = await client
    .from("mentee_interview_invites")
    .select("id,application_id")
    .eq("token", cleanToken)
    .maybeSingle();
  if (inviteError) {
    log("invite lookup failed", inviteError);
    return { ok: false, state: "invalid", message: SAFE_ERROR };
  }
  if (!invite?.application_id) return INVALID_LINK;

  const { data: app, error: appError } = await client
    .from("applications")
    .select("id,status,full_name,role_applied,source,season_id")
    .eq("id", String(invite.application_id))
    .maybeSingle();
  if (appError || !app) {
    if (appError) log("application lookup failed", appError);
    return INVALID_LINK;
  }
  const candidateName = clean(app.full_name) || "bạn";

  // Đã có chỗ → trang trở thành thẻ xác nhận. Kiểm trước mọi thứ khác: một
  // người đã giữ chỗ không cần biết ca nào còn trống.
  const { data: booking, error: bookingError } = await client
    .from("mentee_interview_bookings")
    .select("id,session_id")
    .eq("application_id", String(app.id))
    .eq("status", "booked")
    .maybeSingle();
  if (bookingError) {
    log("booking lookup failed", bookingError);
    return { ok: false, state: "invalid", message: SAFE_ERROR };
  }
  if (booking) {
    const { data: session } = await client
      .from("interview_sessions")
      .select("starts_at,ends_at,venue")
      .eq("id", String(booking.session_id))
      .maybeSingle();
    return {
      ok: true,
      state: "booked",
      candidateName,
      booking: {
        sessionLabel: session
          ? sessionFullLabel(normIso(session.starts_at), normIso(session.ends_at))
          : "",
        venue: clean(session?.venue) || null
      },
      hotlineZalo: HOTLINE_ZALO,
      support: SUPPORT
    };
  }

  if (!isEligible(app)) {
    return {
      ok: true,
      state: "ineligible",
      candidateName,
      message:
        "Hồ sơ của bạn hiện không ở bước đặt ca phỏng vấn. Nếu bạn nghĩ đây là nhầm lẫn, liên hệ ban tổ chức giúp mình nhé.",
      hotlineZalo: HOTLINE_ZALO,
      support: SUPPORT
    };
  }

  const sessions = await readAllPages<Json>(
    "interview_sessions",
    "id,starts_at,ends_at,seat_limit,venue,booking_closes_at,status",
    (columns) => client.from("interview_sessions").select(columns).eq("season_id", String(app.season_id))
  );
  if (sessions.error) {
    log("sessions read failed", sessions.error);
    return { ok: false, state: "invalid", message: SAFE_ERROR };
  }

  const rows: SessionRow[] = sessions.data.map((row) => ({
    id: String(row.id),
    startsAtIso: normIso(row.starts_at),
    endsAtIso: normIso(row.ends_at),
    seatLimit: row.seat_limit === null || row.seat_limit === undefined ? null : Number(row.seat_limit),
    venue: clean(row.venue) || null,
    bookingClosesAtIso: normIso(row.booking_closes_at),
    status: String(row.status ?? "")
  }));

  // Đếm chỗ đã giữ của TẤT CẢ các ca trong một lượt đọc. Con số này chỉ để vẽ
  // màn hình; phép cưỡng chế thật nằm trong vam101, đếm lại dưới khoá hàng.
  const taken = new Map<string, number>();
  if (rows.length > 0) {
    const booked = await readAllPages<Json>("mentee_interview_bookings", "id,session_id", (columns) =>
      client
        .from("mentee_interview_bookings")
        .select(columns)
        .eq("season_id", String(app.season_id))
        .eq("status", "booked")
    );
    if (booked.error) {
      log("booked count read failed", booked.error);
      return { ok: false, state: "invalid", message: SAFE_ERROR };
    }
    for (const row of booked.data) {
      const key = String(row.session_id);
      taken.set(key, (taken.get(key) ?? 0) + 1);
    }
  }

  const nowIso = new Date().toISOString();
  const days = buildSessionDays(rows, taken, nowIso);
  const closesAt = bookingClosesAt(rows);

  return {
    ok: true,
    state: "eligible",
    candidateName,
    days,
    anyBookable: hasBookableSession(days),
    totalRemaining: totalRemaining(days),
    deadlineLabel: closesAt ? `${formatTime(closesAt)} ngày ${formatDate(closesAt)}` : null,
    hotlineZalo: HOTLINE_ZALO,
    support: SUPPORT
  };
}

/**
 * Luật đối tượng, dùng CHUNG hằng với vòng mentor.
 *
 * Ba trạng thái sau vòng hồ sơ là như nhau cho cả hai vai trò, và hàm vam101
 * lặp lại đúng ba tên đó. Khai một danh sách thứ hai ở đây là mời hai nơi nói
 * hai luật khác nhau.
 */
function isEligible(app: Json): boolean {
  if (String(app.role_applied ?? "").toLowerCase() !== "mentee") return false;
  if (String(app.source ?? "") !== "vam_os_form") return false;
  return BOOKING_ELIGIBLE_STATUSES.has(String(app.status ?? ""));
}

// ─────────────────────────────────────────────────────────────────────────────
// Giữ chỗ — qua RPC nguyên tử
// ─────────────────────────────────────────────────────────────────────────────

export type BookSessionResult = { ok: boolean; message: string; sessionLabel?: string };

const BOOK_ERROR_MESSAGES: Record<string, string> = {
  invalid_token: "Đường dẫn không còn hiệu lực — bạn mở lại từ email của ban tổ chức.",
  application_not_eligible: `Hồ sơ của bạn hiện không ở bước đặt ca. Cần hỗ trợ, bạn liên hệ Zalo ban tổ chức ${HOTLINE_ZALO}.`,
  already_booked: "Bạn đã chọn một ca rồi. Muốn đổi ca, bạn liên hệ ban tổ chức giúp mình nhé.",
  session_not_found: "Không tìm thấy ca này — bạn tải lại trang rồi chọn lại.",
  deadline_passed: "Đã quá hạn đăng ký. Bạn liên hệ ban tổ chức để được hướng dẫn.",
  session_not_open: "Ca này chưa mở đăng ký. Bạn chọn một ca khác, hoặc quay lại sau ít phút.",
  session_in_past: "Ca này đã qua — bạn tải lại trang và chọn ca khác.",
  session_full: "Ca này vừa có người giữ mất chỗ cuối — bạn chọn ca khác nhé."
};

export async function bookMenteeSession(input: {
  token: unknown;
  sessionId: unknown;
}): Promise<BookSessionResult> {
  const client = serviceClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const token = clean(input.token);
  const sessionId = clean(input.sessionId);
  if (!token || !isValidUuid(token)) return { ok: false, message: BOOK_ERROR_MESSAGES.invalid_token };
  if (!sessionId || !isValidUuid(sessionId)) {
    return { ok: false, message: BOOK_ERROR_MESSAGES.session_not_found };
  }

  const { data, error } = await client.rpc("vam101_book_mentee_session", {
    p_token: token,
    p_session_id: sessionId
  });
  if (error) {
    log("vam101 failed", error);
    return { ok: false, message: SAFE_ERROR };
  }

  const payload = (data ?? {}) as Json;
  if (!payload.ok) {
    const code = String(payload.code ?? "");
    return { ok: false, message: BOOK_ERROR_MESSAGES[code] ?? SAFE_ERROR };
  }

  const label = sessionFullLabel(normIso(payload.starts_at), normIso(payload.ends_at));
  return { ok: true, message: "Đã ghi nhận ca phỏng vấn của bạn.", sessionLabel: label };
}
