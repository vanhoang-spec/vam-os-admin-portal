import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import {
  type MenteeSessionDay,
  type SessionRow,
  buildSessionDays,
  sessionTimeLabel
} from "@/lib/mentee-interview-core";
import { readAllPages } from "@/lib/paged-read";
import { canAssignReview } from "@/lib/permissions";
import { SEASON_CONFIG } from "@/lib/season-config";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { formatDate, formatTime } from "@/lib/utils";

/**
 * lib/mentee-session-admin.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Ban tổ chức điền số ghế và địa điểm cho 12 ca phỏng vấn mentee.
 *
 * 12 ca sinh ra với `seat_limit` NULL, và NULL nghĩa là ĐÓNG — không ai đặt
 * được cho tới khi có người điền số. Màn hình này là chỗ điền số đó; trước khi
 * có nó, việc ấy phải làm bằng một câu SQL.
 *
 * Không có tranh chấp ở đây nên không cần RPC: mỗi ca do đúng một người vận
 * hành sửa, và cái đắt giá — sức chứa — vẫn được cưỡng chế lúc giữ chỗ, trong
 * vam101/vam102, bằng khoá hàng rồi đếm lại. Con số ở màn hình này chỉ là trần.
 */

type Json = Record<string, any>;

const SAFE_ERROR = "Hệ thống đang bận, thử lại sau ít phút.";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Trần mềm cho một ô nhập: 300 ghế một ca là con số không ai gõ có chủ ý. */
export const MAX_SEATS_PER_SESSION = 300;

function log(message: string, error?: unknown) {
  console.error(`[mentee-session-admin] ${message}`, error ?? "");
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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

async function requireBtc(): Promise<
  { ok: true; client: any; seasonId: string } | { ok: false; message: string }
> {
  const admin = await getCurrentAdminUser();
  if (!admin) return { ok: false, message: "Cần đăng nhập." };
  if (!canAssignReview(admin.role)) {
    return { ok: false, message: "Bạn không có quyền cấu hình ca phỏng vấn." };
  }
  const client = serviceClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const { data, error } = await client
    .from("seasons")
    .select("id")
    .eq("code", SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE)
    .maybeSingle();
  if (error) {
    log("seasons lookup failed", error);
    return { ok: false, message: SAFE_ERROR };
  }
  if (!data?.id) {
    return {
      ok: false,
      message: `Không tìm thấy mùa ${SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE}.`
    };
  }
  return { ok: true, client, seasonId: String(data.id) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Đọc màn hình
// ─────────────────────────────────────────────────────────────────────────────

export type SessionAdminRow = {
  id: string;
  dayLabel: string;
  timeLabel: string;
  seatLimit: number | null;
  venue: string;
  status: string;
  taken: number;
  /** Ghi chú cảnh báo khi trần thấp hơn số người đã giữ chỗ. */
  overbooked: boolean;
};

export type SessionAdminData =
  | { ok: false; message: string }
  | {
      ok: true;
      days: Array<{ dateKey: string; label: string; rows: SessionAdminRow[] }>;
      totals: { sessions: number; configured: number; seats: number; booked: number };
      deadlineLabel: string | null;
    };

export async function getSessionAdminData(): Promise<SessionAdminData> {
  const access = await requireBtc();
  if (!access.ok) return { ok: false, message: access.message };
  const { client, seasonId } = access;

  const sessions = await readAllPages<Json>(
    "interview_sessions",
    "id,starts_at,ends_at,seat_limit,venue,booking_closes_at,status",
    (columns) => client.from("interview_sessions").select(columns).eq("season_id", seasonId)
  );
  if (sessions.error) {
    log("sessions read failed", sessions.error);
    return { ok: false, message: SAFE_ERROR };
  }

  const booked = await readAllPages<Json>("mentee_interview_bookings", "id,session_id", (columns) =>
    client
      .from("mentee_interview_bookings")
      .select(columns)
      .eq("season_id", seasonId)
      .eq("status", "booked")
  );
  if (booked.error) {
    log("booked read failed", booked.error);
    return { ok: false, message: SAFE_ERROR };
  }

  const taken = new Map<string, number>();
  for (const row of booked.data) {
    const key = String(row.session_id);
    taken.set(key, (taken.get(key) ?? 0) + 1);
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

  // Nhóm theo ngày bằng ĐÚNG hàm mà trang công khai dùng, để hai màn hình không
  // bao giờ xếp ca theo hai thứ tự khác nhau.
  const grouped: MenteeSessionDay[] = buildSessionDays(rows, taken, new Date().toISOString());
  const byId = new Map(rows.map((r) => [r.id, r]));

  const days = grouped.map((day) => ({
    dateKey: day.dateKey,
    label: day.label,
    rows: day.sessions.map((s) => {
      const row = byId.get(s.id)!;
      return {
        id: s.id,
        dayLabel: day.label,
        timeLabel: sessionTimeLabel(row.startsAtIso, row.endsAtIso),
        seatLimit: row.seatLimit,
        venue: row.venue ?? "",
        status: row.status,
        taken: s.taken,
        overbooked: row.seatLimit !== null && s.taken > row.seatLimit
      };
    })
  }));

  const closesAt = rows.map((r) => r.bookingClosesAtIso).filter(Boolean).sort().pop() ?? null;

  return {
    ok: true,
    days,
    totals: {
      sessions: rows.length,
      configured: rows.filter((r) => r.seatLimit !== null).length,
      seats: rows.reduce((sum, r) => sum + (r.seatLimit ?? 0), 0),
      booked: booked.data.length
    },
    deadlineLabel: closesAt ? `${formatTime(closesAt)} ngày ${formatDate(closesAt)}` : null
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ghi
// ─────────────────────────────────────────────────────────────────────────────

export type SaveResult = { ok: boolean; message: string };

/**
 * Ô ghế để trống nghĩa là ĐÓNG ca, không phải "giữ nguyên số cũ".
 *
 * Người vận hành xoá số trong ô rồi bấm lưu đang nói "đóng ca này lại", và đó
 * là một thao tác họ cần. Hiểu thành "không đổi gì" sẽ làm một ca họ tưởng đã
 * đóng vẫn nhận người.
 */
function parseSeatLimit(value: unknown): { ok: true; value: number | null } | { ok: false; message: string } {
  const raw = clean(value);
  if (raw === "") return { ok: true, value: null };
  if (!/^\d+$/.test(raw)) return { ok: false, message: "Số ghế phải là một số nguyên." };
  const n = Number(raw);
  if (n < 1) return { ok: false, message: "Số ghế phải lớn hơn 0. Để trống nếu muốn đóng ca." };
  if (n > MAX_SEATS_PER_SESSION) {
    return { ok: false, message: `Số ghế tối đa ${MAX_SEATS_PER_SESSION} — kiểm lại giúp em.` };
  }
  return { ok: true, value: n };
}

export async function saveSessionConfig(input: {
  sessionId: unknown;
  seatLimit: unknown;
  venue: unknown;
  closed: unknown;
}): Promise<SaveResult> {
  const access = await requireBtc();
  if (!access.ok) return { ok: false, message: access.message };
  const { client, seasonId } = access;

  const sessionId = clean(input.sessionId);
  if (!sessionId || !UUID_REGEX.test(sessionId)) {
    return { ok: false, message: "Không xác định được ca cần lưu." };
  }

  const seats = parseSeatLimit(input.seatLimit);
  if (!seats.ok) return { ok: false, message: seats.message };

  const venue = clean(input.venue);
  const closed = clean(input.closed) === "yes";

  // Lọc theo season_id nữa: id ca đến từ biểu mẫu, và ô chọn đã lọc trên màn
  // hình không phải một phép kiểm.
  const { data, error } = await client
    .from("interview_sessions")
    .update({
      seat_limit: seats.value,
      venue: venue || null,
      status: closed ? "closed" : "open",
      updated_at: new Date().toISOString()
    })
    .eq("id", sessionId)
    .eq("season_id", seasonId)
    .select("id");
  if (error) {
    log("session update failed", error);
    return { ok: false, message: SAFE_ERROR };
  }
  if (!data || data.length === 0) {
    return { ok: false, message: "Không tìm thấy ca này trong mùa đang tuyển." };
  }

  return { ok: true, message: "Đã lưu." };
}

/**
 * Điền cùng một số ghế cho cả 12 ca.
 *
 * Đây là thao tác thật của ban tổ chức: số mentor mỗi ca thường như nhau, nên
 * bắt họ gõ mười hai lần chỉ là mười hai cơ hội gõ lệch một ô.
 *
 * KHÔNG đụng tới địa điểm và trạng thái: người bấm nút này đang nói về ghế.
 */
export async function applySeatLimitToAllSessions(input: { seatLimit: unknown }): Promise<SaveResult> {
  const access = await requireBtc();
  if (!access.ok) return { ok: false, message: access.message };
  const { client, seasonId } = access;

  const seats = parseSeatLimit(input.seatLimit);
  if (!seats.ok) return { ok: false, message: seats.message };
  if (seats.value === null) {
    return { ok: false, message: "Nhập số ghế muốn áp cho cả 12 ca." };
  }

  const { data, error } = await client
    .from("interview_sessions")
    .update({ seat_limit: seats.value, updated_at: new Date().toISOString() })
    .eq("season_id", seasonId)
    .select("id");
  if (error) {
    log("bulk seat update failed", error);
    return { ok: false, message: SAFE_ERROR };
  }

  return { ok: true, message: `Đã đặt ${seats.value} ghế cho ${data?.length ?? 0} ca.` };
}

/** Điền cùng một địa điểm cho cả 12 ca — thư xác nhận nào cũng cần nó. */
export async function applyVenueToAllSessions(input: { venue: unknown }): Promise<SaveResult> {
  const access = await requireBtc();
  if (!access.ok) return { ok: false, message: access.message };
  const { client, seasonId } = access;

  const venue = clean(input.venue);
  if (!venue) return { ok: false, message: "Nhập địa điểm muốn áp cho cả 12 ca." };

  const { data, error } = await client
    .from("interview_sessions")
    .update({ venue, updated_at: new Date().toISOString() })
    .eq("season_id", seasonId)
    .select("id");
  if (error) {
    log("bulk venue update failed", error);
    return { ok: false, message: SAFE_ERROR };
  }

  return { ok: true, message: `Đã đặt địa điểm cho ${data?.length ?? 0} ca.` };
}
