/**
 * Phiếu chấm phỏng vấn mentee theo mùa — phần thuần, không I/O.
 *
 * Phần ĐỔI theo mùa (tiêu chí, trọng số, câu hỏi, mô tả 1/3/5, hướng dẫn) là dữ
 * liệu trong bảng mentee_interview_rubrics. Phần KHÔNG đổi theo mùa nằm cố định
 * ở đây vì chúng điều khiển logic database: 3 kết quả (đổi trạng thái hồ sơ),
 * 3 mức alignment và 3 lựa chọn mục C ("Có" tạo cặp ghép ngay).
 */

export type RubricDescriptorLevel = "1" | "3" | "5";

export type RubricCriterion = {
  key: string;
  label: string;
  label_en?: string;
  weight: number;
  question?: string;
  descriptors?: Partial<Record<RubricDescriptorLevel, string>>;
  interview_questions?: string[];
};

export type RubricGuidance = { motto?: string; note?: string; reminder?: string };

export type InterviewRubric = {
  id: string;
  seasonId: string;
  seasonCode: string;
  /** true: phiếu riêng của mùa đang xem; false: đang kế thừa phiếu lưu gần nhất của mùa khác. */
  own: boolean;
  version: number;
  handbookVersion: number;
  criteria: RubricCriterion[];
  guidance: RubricGuidance;
  copiedFromSeasonCode: string | null;
  updatedAt: string;
  updatedByName: string | null;
  hasHandbook: boolean;
  handbookHtml: string | null;
  handbookFileName: string | null;
  handbookUpdatedAt: string | null;
  handbookUpdatedByName: string | null;
};

export type InterviewGuide = { rubric: InterviewRubric | null; submittedCount: number };

/** Ảnh chụp một tiêu chí lúc chấm — tự mô tả, không phụ thuộc phiếu hiện hành. */
export type InterviewScore = { key: string; label: string; weight: number; score: number; note: string | null };

export const EXPECTATION_ALIGNMENTS = {
  aligned: "Kỳ vọng phù hợp",
  needs_clarification: "Cần làm rõ thêm",
  concern: "Kỳ vọng không phù hợp"
} as const;
export type ExpectationAlignment = keyof typeof EXPECTATION_ALIGNMENTS;

export const TAKE_CHOICES = {
  take: "Có – Tôi muốn nhận bạn này",
  recommend_other: "Không – Nhưng đề xuất bạn này trở thành Mentee và Mentor khác nhận bạn",
  undecided: "Chưa quyết định"
} as const;
export type TakeChoice = keyof typeof TAKE_CHOICES;

/**
 * Mỗi mentor phỏng vấn chọn "Có – Tôi muốn nhận bạn này" cho tối đa chừng này hồ
 * sơ trong một mùa (BTC 02/10/2026). Database kiểm lại đúng con số này trong
 * vam104_save_offline_interview (TAKE_LIMIT_REACHED) — sửa một nơi phải sửa cả hai.
 */
export const MAX_TAKES_PER_INTERVIEWER = 2;

/** Lưu ý BTC đặt dưới mục B của form chấm. */
export const EXPECTATION_BRIEF_NOTE =
  "Lưu ý: Mentor có trách nhiệm mô tả ngắn gọn các cam kết của Mentor và Mentee, còn Mentee cần xác nhận và làm rõ kỳ vọng để hai bên thống nhất nhằm đảm bảo cả Mentor, Mentee hiểu rõ nội dung, phạm vi và vai trò, trách nhiệm trước khi bắt đầu quá trình mentoring.";

export const DESCRIPTOR_LEVELS: RubricDescriptorLevel[] = ["1", "3", "5"];
export const MAX_CRITERIA = 8;
export const MAX_INTERVIEW_QUESTIONS = 6;
const KEY_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;

/**
 * Điểm quy đổi thang 1–5 = Σ(điểm × trọng số) / Σ trọng số, làm tròn 2 số.
 * CHỈ để BTC tham khảo — phiếu ghi rõ không cộng tổng và không có điểm sàn.
 * Cùng công thức với vam104_save_offline_interview; database là nơi ghi thật.
 */
export function weightedScore(scores: ReadonlyArray<{ score: number; weight: number }>): number | null {
  const totalWeight = scores.reduce((sum, s) => sum + s.weight, 0);
  if (!scores.length || totalWeight <= 0) return null;
  const raw = scores.reduce((sum, s) => sum + s.score * s.weight, 0) / totalWeight;
  return Math.round(raw * 100) / 100;
}

export function formatWeightedScore(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(2)}/5` : "—";
}

/**
 * 8 ô cuối của file xuất điểm review cho một dòng phỏng vấn theo phiếu. Dòng vòng
 * hồ sơ (hoặc phiếu phỏng vấn cũ) để trống — không bịa giá trị cho thứ không có.
 */
export function interviewRubricExportCells(review: {
  interview_scores?: unknown;
  weighted_score?: number | string | null;
  key_development_need?: string | null;
  expectation_alignment?: string | null;
  alignment_note?: string | null;
  take_choice?: string | null;
  desired_mentor_profile?: string | null;
  additional_note?: string | null;
}): string[] {
  const scores = Array.isArray(review.interview_scores) ? (review.interview_scores as InterviewScore[]) : [];
  const alignment = review.expectation_alignment as ExpectationAlignment | null | undefined;
  const take = review.take_choice as TakeChoice | null | undefined;
  const weighted = review.weighted_score === null || review.weighted_score === undefined || review.weighted_score === ""
    ? "" : Number(review.weighted_score).toFixed(2);
  return [
    scores.map((s) => `${s.label}: ${s.score}`).join("; "),
    weighted,
    review.key_development_need ?? "",
    alignment && alignment in EXPECTATION_ALIGNMENTS ? EXPECTATION_ALIGNMENTS[alignment] : "",
    review.alignment_note ?? "",
    take && take in TAKE_CHOICES ? TAKE_CHOICES[take] : "",
    review.desired_mentor_profile ?? "",
    review.additional_note ?? ""
  ];
}

// Dải dấu kết hợp U+0300–U+036F dựng bằng mã số: công cụ ghi file của máy này
// đổi escape Unicode thành ký tự thật (CLAUDE.md, 14/09/2026).
const COMBINING_MARKS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g");

/** Key ổn định sinh từ nhãn lúc tạo tiêu chí; không đổi khi đổi nhãn về sau. */
export function slugifyCriterionKey(label: string, taken: readonly string[]): string {
  const base =
    label
      .normalize("NFD")
      .replace(COMBINING_MARKS, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^[^a-z]+/, "")
      .slice(0, 32) || "tieu_chi";
  const seed = base.length >= 2 ? base : `${base}_x`;
  let key = seed;
  for (let n = 2; taken.includes(key); n++) key = `${seed}_${n}`;
  return key;
}

/**
 * Kiểm phiếu phía màn hình — cùng luật với vam106_valid_criteria để báo lỗi bằng
 * câu dễ hiểu trước khi gửi. Database vẫn kiểm lại; đây không phải phép kiểm.
 */
export function rubricDraftError(criteria: readonly RubricCriterion[], guidance: RubricGuidance): string | null {
  if (criteria.length < 1) return "Phiếu cần ít nhất 1 tiêu chí.";
  if (criteria.length > MAX_CRITERIA) return `Phiếu tối đa ${MAX_CRITERIA} tiêu chí.`;
  const keys = new Set<string>();
  for (let index = 0; index < criteria.length; index++) {
    const c = criteria[index];
    const n = index + 1;
    if (!KEY_PATTERN.test(c.key) || keys.has(c.key)) return `Tiêu chí ${n}: mã nội bộ không hợp lệ hoặc bị trùng.`;
    keys.add(c.key);
    const label = c.label.trim();
    if (!label) return `Tiêu chí ${n}: chưa có tên.`;
    if (label.length > 120) return `Tiêu chí ${n}: tên dài quá 120 ký tự.`;
    if (!Number.isInteger(c.weight) || c.weight < 1 || c.weight > 100) return `Tiêu chí ${n}: trọng số phải là số nguyên 1–100.`;
    if ((c.label_en ?? "").length > 120) return `Tiêu chí ${n}: tên tiếng Anh dài quá 120 ký tự.`;
    if ((c.question ?? "").length > 500) return `Tiêu chí ${n}: câu hỏi cốt lõi dài quá 500 ký tự.`;
    for (const level of DESCRIPTOR_LEVELS) {
      if ((c.descriptors?.[level] ?? "").length > 500) return `Tiêu chí ${n}: mô tả mức ${level} dài quá 500 ký tự.`;
    }
    const questions = c.interview_questions ?? [];
    if (questions.length > MAX_INTERVIEW_QUESTIONS) return `Tiêu chí ${n}: tối đa ${MAX_INTERVIEW_QUESTIONS} câu hỏi gợi ý.`;
    if (questions.some((q) => q.length > 500)) return `Tiêu chí ${n}: một câu hỏi gợi ý dài quá 500 ký tự.`;
  }
  const total = criteria.reduce((sum, c) => sum + c.weight, 0);
  if (total !== 100) return `Tổng trọng số đang là ${total}% — phải đúng 100%.`;
  for (const [field, value] of Object.entries(guidance)) {
    if ((value ?? "").length > 1000) return `Dòng hướng dẫn "${field}" dài quá 1000 ký tự.`;
  }
  return null;
}

const asText = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * Đọc phiếu từ dữ liệu biểu mẫu gửi lên. Cái đến từ biểu mẫu là thứ người gửi tự
 * đặt được (CLAUDE.md): chỉ nhận đúng hình dạng mong đợi, sai một chỗ là null.
 */
export function parseRubricInput(
  criteria: unknown,
  guidance: unknown
): { criteria: RubricCriterion[]; guidance: RubricGuidance } | null {
  if (!Array.isArray(criteria) || !guidance || typeof guidance !== "object" || Array.isArray(guidance)) return null;
  const parsed: RubricCriterion[] = [];
  for (const raw of criteria) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    if (typeof item.key !== "string" || typeof item.label !== "string" || typeof item.weight !== "number") return null;
    const descriptorsRaw = item.descriptors && typeof item.descriptors === "object" && !Array.isArray(item.descriptors)
      ? (item.descriptors as Record<string, unknown>) : {};
    const descriptors: Partial<Record<RubricDescriptorLevel, string>> = {};
    for (const level of DESCRIPTOR_LEVELS) descriptors[level] = asText(descriptorsRaw[level]);
    const questions = Array.isArray(item.interview_questions) ? item.interview_questions.map(asText) : [];
    parsed.push({
      key: item.key,
      label: item.label,
      label_en: asText(item.label_en),
      weight: item.weight,
      question: asText(item.question),
      descriptors,
      interview_questions: questions
    });
  }
  const g = guidance as Record<string, unknown>;
  return { criteria: parsed, guidance: { motto: asText(g.motto), note: asText(g.note), reminder: asText(g.reminder) } };
}

/** Bỏ ô trống để phiếu lưu gọn: mô tả/câu hỏi rỗng không mang ý nghĩa gì. */
export function cleanRubricDraft(criteria: readonly RubricCriterion[], guidance: RubricGuidance) {
  const cleaned: RubricCriterion[] = criteria.map((c) => {
    const descriptors: Partial<Record<RubricDescriptorLevel, string>> = {};
    for (const level of DESCRIPTOR_LEVELS) {
      const text = c.descriptors?.[level]?.trim();
      if (text) descriptors[level] = text;
    }
    const questions = (c.interview_questions ?? []).map((q) => q.trim()).filter(Boolean);
    return {
      key: c.key,
      label: c.label.trim(),
      ...(c.label_en?.trim() ? { label_en: c.label_en.trim() } : {}),
      weight: c.weight,
      ...(c.question?.trim() ? { question: c.question.trim() } : {}),
      descriptors,
      interview_questions: questions
    };
  });
  const cleanGuidance: RubricGuidance = {};
  for (const field of ["motto", "note", "reminder"] as const) {
    const text = guidance[field]?.trim();
    if (text) cleanGuidance[field] = text;
  }
  return { criteria: cleaned, guidance: cleanGuidance };
}
