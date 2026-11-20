/**
 * lib/bulk-mail-recap-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phần thuần của nhóm nhận thư "Mentee chưa có recap trong tháng" (thư nhắc ngày 20):
 * ai thuộc mẫu số của tháng, ai đã có recap, và mentor nào được CC.
 *
 * Quy ước tính chốt với BTC 20/11/2026 (`__xem-goi/thong-ke-recap/DAC-TA.md` mục 1, 3, 4.2):
 *   - Mẫu số tháng T: mentee có cặp trong mùa đã ghép trước hết ngày cuối tháng, và cặp đang
 *     active hoặc kết thúc SAU ngày cuối tháng (cặp dropped giữa tháng không vào mẫu số).
 *   - Recap hợp lệ: `submitted` hoặc `needs_review`. Tính theo mentee, gặp mentor nào cũng tính.
 *   - Recap tính vào tháng của NGÀY ĐĂNG bài (không phải ngày gặp ghi trong bài).
 *   - Mentor được CC = mentor của cặp mới nhất trong mẫu số (mentee đổi cặp → mentor mới).
 *   - Một buổi đăng hai bài (cùng mentee, cùng ngày gặp) đếm một lần.
 *
 * Không I/O — test chạy được mà không cần database.
 */

import { vietnamDateKey } from "@/lib/utils";

export const RECAP_AUDIENCE = "mentee_no_recap_month" as const;

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Tháng dạng `YYYY-MM`. Tham số đến từ form là thứ người gửi tự đặt được, nên kiểm chặt. */
export function isRecapMonth(value: unknown): value is string {
  return typeof value === "string" && MONTH_PATTERN.test(value);
}

/** Ngày cuối tháng `YYYY-MM-DD` của một tháng `YYYY-MM`. */
export function lastDayOfMonth(month: string): string {
  const match = MONTH_PATTERN.exec(month);
  if (!match) throw new Error(`Tháng không hợp lệ: ${month}`);
  const year = Number(match[1]);
  const monthIndex = Number(match[2]);
  // Ngày 0 của tháng sau là ngày cuối tháng này — tính ở UTC để không lệch múi giờ.
  const day = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return `${match[1]}-${match[2]}-${String(day).padStart(2, "0")}`;
}

/** "11/2026" — cách BTC viết tháng trong thư và trên màn hình. */
export function formatRecapMonth(month: string): string {
  const match = MONTH_PATTERN.exec(month);
  return match ? `${match[2]}/${match[1]}` : month;
}

/** Tháng trước của một tháng `YYYY-MM`. */
function previousMonth(month: string): string {
  const match = MONTH_PATTERN.exec(month);
  if (!match) throw new Error(`Tháng không hợp lệ: ${month}`);
  const year = Number(match[1]);
  const index = Number(match[2]);
  return index === 1 ? `${year - 1}-12` : `${year}-${String(index - 1).padStart(2, "0")}`;
}

/**
 * Các tháng chọn được trên màn hình, mới nhất trước: từ tháng hiện tại (giờ VN) lùi về tháng của
 * cặp ghép sớm nhất, tối đa `max` tháng. Tháng tương lai không có: nhắc "chưa có recap" cho một
 * tháng chưa tới là gửi cho cả mẫu số.
 */
export function recapMonthChoices(input: { currentMonth: string; earliestMonth: string | null; max?: number }): string[] {
  const max = input.max ?? 6;
  if (!isRecapMonth(input.currentMonth)) return [];
  const floor = input.earliestMonth && isRecapMonth(input.earliestMonth) ? input.earliestMonth : input.currentMonth;
  const months: string[] = [];
  for (let month = input.currentMonth; months.length < max && month >= floor; month = previousMonth(month)) {
    months.push(month);
  }
  return months;
}

/** Bộ quét bài Facebook đợt 19/11/2026 (212 bài, đăng 8–19/11) — chưa ghi ngày đăng. */
export const FACEBOOK_SCAN_SOURCE = "claude-quet-facebook";
/** Mọi dòng của bộ quét tạo trước mốc này là bài đăng tháng 11/2026 (đợt quét duy nhất tới nay). */
const FIRST_SCAN_MONTH = "2026-11";
const FIRST_SCAN_CUTOFF_DATE = "2026-12-01";

export type RecapRow = {
  menteePersonId: string | null;
  meetingDate: string;
  meetingMonth: string;
  status: string;
  capturedBy: string | null;
  createdAt: string | null;
  /** Ngày đăng bài (giờ VN). Cột chưa có trong database; có rồi thì đọc thêm vào đây. */
  postedDate?: string | null;
};

/**
 * Tháng mà một recap được tính vào: tháng của ngày đăng bài.
 *
 * Database chưa lưu ngày đăng (DAC-TA mục 2 — migration `posted_date` còn chờ). Tới lúc đó:
 *   - dòng có `postedDate` → tháng của ngày đó;
 *   - dòng của bộ quét Facebook tạo trước 01/12/2026 → 2026-11 (212 bài đều đăng 8–19/11, trong đó
 *     16 bài kể buổi gặp 26–31/10);
 *   - còn lại (recap nhập tay) → tháng của ngày gặp, như trang hiện có.
 * Dòng quét sau 01/12 mà vẫn thiếu ngày đăng thì rơi về ngày gặp — bộ quét đợt sau phải ghi `posted_date`.
 */
export function recapPostedMonth(row: RecapRow): string {
  const posted = String(row.postedDate ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(posted)) return posted.slice(0, 7);
  if (row.capturedBy === FACEBOOK_SCAN_SOURCE) {
    const created = vietnamDateKey(row.createdAt);
    if (created && created < FIRST_SCAN_CUTOFF_DATE) return FIRST_SCAN_MONTH;
  }
  const meetingMonth = String(row.meetingMonth ?? "").trim();
  return meetingMonth || String(row.meetingDate ?? "").slice(0, 7);
}

const VALID_RECAP_STATUSES = new Set(["submitted", "needs_review"]);

export type RecapMatchRow = {
  id: string;
  menteePersonId: string | null;
  mentorPersonId: string | null;
  status: string;
  matchedAt: string | null;
  endedAt: string | null;
  updatedAt: string | null;
};

/** Cặp có thuộc mẫu số của tháng có ngày cuối `lastDay` không (so theo ngày giờ VN). */
function inDenominator(match: RecapMatchRow, lastDay: string): boolean {
  const matched = vietnamDateKey(match.matchedAt);
  if (!matched || matched > lastDay) return false;
  if (match.status === "active") return true;
  // 40 cặp dropped của mùa 12 không ghi ended_at — lần sửa cuối là lúc chuyển dropped.
  const ended = vietnamDateKey(match.endedAt ?? match.updatedAt);
  return Boolean(ended && ended > lastDay);
}

export type NoRecapMentee = {
  menteePersonId: string;
  /** Mentor của cặp mới nhất trong mẫu số; null khi cặp không ghi mentor. */
  mentorPersonId: string | null;
  matchId: string;
};

export type RecapMonthSummary = {
  /** Số mentee trong mẫu số. */
  denominator: number;
  /** Số mentee trong mẫu số đã có ít nhất một buổi trong tháng. */
  met: number;
  /** Số buổi đăng trong tháng (mọi mentee): cặp (mentee, ngày gặp) khác nhau. */
  sessions: number;
  /** Danh sách nhắc: mentee trong mẫu số, 0 buổi trong tháng. Sắp theo id để thứ tự ổn định. */
  noRecap: NoRecapMentee[];
};

/**
 * Danh sách nhắc của tháng `month`: mentee trong mẫu số chưa có buổi nào đăng trong tháng,
 * kèm mentor của cặp mới nhất để CC.
 */
export function menteesWithoutRecap(input: {
  month: string;
  matches: readonly RecapMatchRow[];
  recaps: readonly RecapRow[];
}): RecapMonthSummary {
  const lastDay = lastDayOfMonth(input.month);

  // Cặp mới nhất của mỗi mentee trong mẫu số. Cùng mốc ghép thì lấy id lớn hơn — chỉ để kết quả
  // không phụ thuộc thứ tự database trả về.
  const latest = new Map<string, RecapMatchRow>();
  for (const match of input.matches) {
    const mentee = String(match.menteePersonId ?? "").trim();
    if (!mentee || !inDenominator(match, lastDay)) continue;
    const current = latest.get(mentee);
    const key = `${match.matchedAt ?? ""}|${match.id}`;
    if (!current || key > `${current.matchedAt ?? ""}|${current.id}`) latest.set(mentee, match);
  }

  // Buổi = (mentee, ngày gặp) duy nhất trong tháng: hai bài cùng một buổi là một buổi.
  const sessions = new Map<string, Set<string>>();
  for (const recap of input.recaps) {
    if (!VALID_RECAP_STATUSES.has(String(recap.status ?? ""))) continue;
    const mentee = String(recap.menteePersonId ?? "").trim();
    if (!mentee || recapPostedMonth(recap) !== input.month) continue;
    const days = sessions.get(mentee) ?? new Set<string>();
    days.add(String(recap.meetingDate ?? ""));
    sessions.set(mentee, days);
  }

  let sessionCount = 0;
  for (const days of Array.from(sessions.values())) sessionCount += days.size;

  let met = 0;
  const noRecap: NoRecapMentee[] = [];
  for (const [mentee, match] of Array.from(latest)) {
    if ((sessions.get(mentee)?.size ?? 0) > 0) {
      met += 1;
      continue;
    }
    const mentor = String(match.mentorPersonId ?? "").trim();
    noRecap.push({ menteePersonId: mentee, mentorPersonId: mentor || null, matchId: String(match.id) });
  }
  noRecap.sort((a, b) => a.menteePersonId.localeCompare(b.menteePersonId));

  return { denominator: latest.size, met, sessions: sessionCount, noRecap };
}

/** Một tháng chọn được cho nhóm, kèm số đã đếm sẵn — đúng con số lệnh gửi sẽ tự đếm lại. */
export type RecapMonthOption = {
  month: string;
  label: string;
  /** Số mentee sẽ nhận thư. */
  sendable: number;
  /** Mentee trong danh sách nhắc mà không gửi được (thiếu email / họ tên). */
  unreachable: number;
  /** Số mentor khác nhau được CC. */
  ccMentors: number;
  /** Số thư đi mà KHÔNG có CC (mentor thiếu email hợp lệ, hoặc cặp không ghi mentor). */
  ccMissing: number;
};

/** Mentor khác nhau được CC trong một danh sách người nhận. */
export function countCcMentors(rows: ReadonlyArray<{ ccEmails?: readonly string[] }>): number {
  const set = new Set<string>();
  for (const row of rows) for (const email of row.ccEmails ?? []) set.add(email);
  return set.size;
}
