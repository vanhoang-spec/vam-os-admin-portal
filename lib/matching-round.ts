/**
 * Vòng ghép cặp (BTC 07/10/2026) — một cửa cho nhãn và bộ lọc theo vòng.
 *
 * Vòng 1 = mentee được người phỏng vấn nhận ngay tại buổi phỏng vấn, ở MỌI đợt (03–04/10,
 * 10–11/10, …). Database tự gắn lúc nhận (trigger vam111, migration
 * 20261007120000_vong_ghep_cap.sql); màn hình chỉ đọc `matches.matching_round`.
 * Cặp BTC ghép tay để trống cho tới khi BTC chốt cách ghép vòng 2.
 */

/** Các vòng hiện có trong ô lọc. Vòng 2 = mentor tự chọn qua link riêng (BTC 07/10/2026). */
export const KNOWN_MATCHING_ROUNDS = [1, 2] as const;

export type MatchingRoundFilter = { kind: "all" } | { kind: "round"; round: number } | { kind: "none" };

/** Giá trị `?round=` cho cặp chưa gắn vòng. */
export const UNASSIGNED_ROUND_PARAM = "none";

/** Số vòng hợp lệ (nguyên, từ 1) hoặc null. Chuỗi "1" từ PostgREST/URL cũng nhận. */
function roundNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export function matchingRoundLabel(value: unknown): string | null {
  const n = roundNumber(value);
  return n === null ? null : `Vòng ${n}`;
}

/**
 * `?round=` → bộ lọc. Giá trị lạ (gõ tay, link cũ) về "tất cả" thay vì về một danh sách
 * rỗng: rỗng trông giống "chưa có cặp nào", là câu trả lời sai.
 */
export function parseMatchingRoundFilter(raw: unknown): MatchingRoundFilter {
  const text = String(raw ?? "").trim();
  if (text === UNASSIGNED_ROUND_PARAM) return { kind: "none" };
  const n = /^\d+$/.test(text) ? roundNumber(text) : null;
  return n === null ? { kind: "all" } : { kind: "round", round: n };
}

export function matchingRoundFilterLabel(filter: MatchingRoundFilter): string | null {
  if (filter.kind === "round") return `Vòng ${filter.round}`;
  if (filter.kind === "none") return "Chưa gắn vòng";
  return null;
}
