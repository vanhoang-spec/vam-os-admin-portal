/**
 * lib/submission-bonus-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Điểm cộng theo ngày nộp: "nộp đến hết ngày X được cộng N điểm".
 *
 * Chủ dự án chốt 16/09/2026: team support tự đặt mốc và số điểm cho form tuyển
 * mentee đang mở, không phải chờ deploy; về sau form đăng ký training, company
 * visit… dùng cùng kiểu cài đặt này.
 *
 * ĐIỂM CỘNG ĐƯỢC TÍNH LÚC ĐỌC, KHÔNG LƯU VÀO ĐƠN
 *   Mốc được đặt khi form ĐÃ mở và đã có hàng trăm đơn. Lưu điểm vào từng đơn lúc
 *   nộp thì những đơn đó không bao giờ nhận được điểm; lưu bằng một lần chạy bù
 *   thì mỗi lần sửa mốc lại phải chạy bù. Tính lúc đọc thì sửa mốc là mọi màn hình
 *   đổi theo ngay. Cái giá: sửa mốc sau khi đã xếp hạng sẽ đổi điểm đã xếp — vì thế
 *   mỗi lần thêm/xoá mốc đều ghi nhật ký.
 *
 * NGÀY NỘP LÀ `created_at` ĐỌC THEO GIỜ VIỆT NAM, KHÔNG PHẢI `submitted_at`
 *   `applications.submitted_at` là cột DATE được ghi bằng ngày UTC
 *   (`toISOString().slice(0, 10)`): đơn nộp lúc 01:00 sáng 11/09 giờ Việt Nam
 *   mang `submitted_at` = 10/09. Dùng cột đó thì một đơn nộp trễ vẫn lọt mốc
 *   "đến hết 10/09". Ngày 16/09/2026 có 30 đơn mentee S12 lệch ngày như vậy.
 *
 * Module thuần, không I/O — để phần quyết định ai được cộng kiểm được mà không
 * cần database.
 */

import { parseVietnamDateInput, toVietnamDateInput } from "@/lib/event-datetime";
import { formatDate } from "@/lib/utils";

export const SUBMISSION_BONUS_PATH = "/admin/seasons-forms/bonus-points";

export const BONUS_POINTS_MIN = 1;
export const BONUS_POINTS_MAX = 100;
export const BONUS_LABEL_MAX = 120;
/** Trần số mốc cho một form. Không phải luật nghiệp vụ — chặn một vòng lặp bấm nhầm. */
export const BONUS_RULES_MAX = 20;

export type SubmissionBonusRule = {
  id: string;
  label: string | null;
  /** `YYYY-MM-DD`, tính CẢ ngày đó, giờ Việt Nam. Null = không có mốc đầu. */
  startsOn: string | null;
  /** `YYYY-MM-DD`, tính đến HẾT ngày đó, giờ Việt Nam. Null = không có mốc cuối. */
  endsOn: string | null;
  points: number;
};

export type SubmissionBonus =
  /** Không đọc được mốc. Khác "không được cộng": màn hình phải nói ra, không hiện 0. */
  | { kind: "unknown" }
  | { kind: "none"; submittedOn: string | null }
  | { kind: "bonus"; points: number; rule: SubmissionBonusRule; submittedOn: string };

/** Khoá gom mốc theo form: một đợt tuyển, một vai trò. */
export function bonusTargetKey(intakeBatchId: unknown, role: unknown): string {
  return `${String(intakeBatchId ?? "").trim()}:${String(role ?? "").trim()}`;
}

/**
 * Mốc thời gian → ngày theo giờ Việt Nam, dạng `YYYY-MM-DD`.
 *
 * Đi qua đúng cửa định dạng ngày của cả sản phẩm (`formatDate`, đã ấn định múi
 * giờ) rồi đọc ngược lại, thay vì tự cộng bảy tiếng: một phép cộng tay là thêm
 * một chỗ nữa có thể sai múi giờ.
 */
export function vietnamDateKey(value: unknown): string | null {
  if (!value) return null;
  return parseVietnamDateInput(formatDate(value));
}

/** So chuỗi `YYYY-MM-DD` là so ngày: cùng độ dài, năm-tháng-ngày từ trái sang. */
export function ruleCoversDate(rule: Pick<SubmissionBonusRule, "startsOn" | "endsOn">, dateKey: string): boolean {
  if (rule.startsOn && dateKey < rule.startsOn) return false;
  if (rule.endsOn && dateKey > rule.endsOn) return false;
  return Boolean(rule.startsOn || rule.endsOn);
}

/**
 * Điểm cộng của một đơn.
 *
 * Đơn rơi vào nhiều mốc thì nhận MỐC CAO NHẤT, không cộng dồn: đặt "đến hết 10/09
 * +5" rồi thêm "đến hết 15/09 +3" là cách tự nhiên để nói "sớm hơn thì nhiều hơn",
 * và cộng dồn sẽ biến nó thành +8 mà không ai định thế.
 */
export function resolveSubmissionBonus(
  rules: readonly SubmissionBonusRule[] | null,
  submittedAt: unknown
): SubmissionBonus {
  if (!rules) return { kind: "unknown" };
  const submittedOn = vietnamDateKey(submittedAt);
  if (!submittedOn) return { kind: "none", submittedOn: null };

  let best: SubmissionBonusRule | null = null;
  for (const rule of rules) {
    if (!ruleCoversDate(rule, submittedOn)) continue;
    if (!best || rule.points > best.points || (rule.points === best.points && rule.id < best.id)) {
      best = rule;
    }
  }
  return best ? { kind: "bonus", points: best.points, rule: best, submittedOn } : { kind: "none", submittedOn };
}

/** Tổng điểm reviewer cộng điểm cộng. Chưa có điểm reviewer thì chưa có tổng. */
export function addSubmissionBonus(total: number | null | undefined, bonus: SubmissionBonus): number | null {
  if (typeof total !== "number") return null;
  return bonus.kind === "bonus" ? total + bonus.points : total;
}

/** Số điểm để in ra: `+3`, rỗng khi không được cộng, và null khi không đọc được. */
export function bonusPointsLabel(bonus: SubmissionBonus): string | null {
  if (bonus.kind === "unknown") return null;
  return bonus.kind === "bonus" ? `+${bonus.points}` : "";
}

/** Khoảng ngày của một mốc, bằng lời người vận hành đọc. */
export function describeBonusWindow(rule: Pick<SubmissionBonusRule, "startsOn" | "endsOn">): string {
  const from = toVietnamDateInput(rule.startsOn);
  const to = toVietnamDateInput(rule.endsOn);
  if (from && to) return from === to ? `Nộp trong ngày ${from}` : `Nộp từ ${from} đến hết ${to}`;
  if (to) return `Nộp đến hết ${to}`;
  if (from) return `Nộp từ ${from} trở đi`;
  return "Chưa có mốc ngày";
}

/** Thứ tự hiển thị: mốc bắt đầu sớm hơn lên trước, mốc không có đầu đứng đầu. */
export function sortBonusRules(rules: readonly SubmissionBonusRule[]): SubmissionBonusRule[] {
  const startKey = (rule: SubmissionBonusRule) => rule.startsOn ?? "";
  const endKey = (rule: SubmissionBonusRule) => rule.endsOn ?? "9999-12-31";
  return [...rules].sort(
    (a, b) =>
      startKey(a).localeCompare(startKey(b)) ||
      endKey(a).localeCompare(endKey(b)) ||
      b.points - a.points ||
      a.id.localeCompare(b.id)
  );
}

export type BonusCoverage = {
  total: number;
  withBonus: number;
  /** Số đơn nhận điểm từ từng mốc — đơn rơi vào nhiều mốc chỉ tính ở mốc thắng. */
  byRule: Record<string, number>;
};

/** Theo các mốc hiện tại, bao nhiêu đơn được cộng. Để người đặt mốc thấy ngay mốc mình vừa đặt trúng ai. */
export function summarizeBonusCoverage(
  rules: readonly SubmissionBonusRule[],
  submissions: readonly unknown[]
): BonusCoverage {
  const byRule: Record<string, number> = Object.fromEntries(rules.map((rule) => [rule.id, 0]));
  let withBonus = 0;
  for (const submittedAt of submissions) {
    const bonus = resolveSubmissionBonus(rules, submittedAt);
    if (bonus.kind !== "bonus") continue;
    withBonus += 1;
    byRule[bonus.rule.id] = (byRule[bonus.rule.id] ?? 0) + 1;
  }
  return { total: submissions.length, withBonus, byRule };
}

export type BonusRuleInput = {
  label: string | null;
  startsOn: string | null;
  endsOn: string | null;
  points: number;
};

/**
 * Kiểm một mốc gửi lên từ form.
 *
 * Ngày nhận dạng DD/MM/YYYY — đúng chữ người vận hành gõ. Ô ngày gõ dở không được
 * coi là ô trống: "10/09/20" mà thành "không có mốc cuối" là biến một mốc hẹp thành
 * mốc cộng điểm cho mọi đơn về sau.
 */
export function parseBonusRuleInput(raw: {
  label?: unknown;
  startsOn?: unknown;
  endsOn?: unknown;
  points?: unknown;
}): { ok: true; value: BonusRuleInput } | { ok: false; message: string } {
  const label = String(raw.label ?? "").trim();
  if (label.length > BONUS_LABEL_MAX) {
    return { ok: false, message: `Tên mốc dài quá ${BONUS_LABEL_MAX} ký tự.` };
  }

  const startText = String(raw.startsOn ?? "").trim();
  const endText = String(raw.endsOn ?? "").trim();
  const startsOn = startText ? parseVietnamDateInput(startText) : null;
  const endsOn = endText ? parseVietnamDateInput(endText) : null;
  if (startText && !startsOn) {
    return { ok: false, message: "Ngày bắt đầu không có thật. Nhập theo dạng ngày/tháng/năm, ví dụ 01/09/2026." };
  }
  if (endText && !endsOn) {
    return { ok: false, message: "Ngày kết thúc không có thật. Nhập theo dạng ngày/tháng/năm, ví dụ 10/09/2026." };
  }
  if (!startsOn && !endsOn) {
    return { ok: false, message: "Cần ít nhất một mốc ngày: nộp từ ngày nào, hoặc nộp đến hết ngày nào." };
  }
  if (startsOn && endsOn && startsOn > endsOn) {
    return { ok: false, message: "Ngày bắt đầu đang sau ngày kết thúc." };
  }

  const pointsText = String(raw.points ?? "").trim();
  const points = /^[0-9]{1,3}$/.test(pointsText) ? Number(pointsText) : Number.NaN;
  if (!Number.isInteger(points) || points < BONUS_POINTS_MIN || points > BONUS_POINTS_MAX) {
    return {
      ok: false,
      message: `Số điểm cộng phải là số nguyên từ ${BONUS_POINTS_MIN} đến ${BONUS_POINTS_MAX}.`
    };
  }

  return { ok: true, value: { label: label || null, startsOn, endsOn, points } };
}

/** Dòng database → mốc. Dòng hỏng hình dạng bị bỏ, không đoán. */
export function bonusRuleFromRow(row: Record<string, unknown>): SubmissionBonusRule | null {
  const id = String(row.id ?? "").trim();
  const points = Number(row.points);
  const date = (value: unknown) => {
    const text = String(value ?? "").trim();
    return /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(text) ? text : null;
  };
  const startsOn = date(row.starts_on);
  const endsOn = date(row.ends_on);
  if (!id || !Number.isInteger(points) || points < 1 || (!startsOn && !endsOn)) return null;
  const label = String(row.label ?? "").trim();
  return { id, label: label || null, startsOn, endsOn, points };
}

export type BonusRuleActionState = { ok: boolean; message: string };

export const initialBonusRuleActionState: BonusRuleActionState = { ok: false, message: "" };
