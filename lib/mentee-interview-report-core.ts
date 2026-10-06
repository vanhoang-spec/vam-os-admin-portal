import { MENTEE_FORM_OPTION_LISTS, type FormOption } from "@/lib/application-form-options";
import { vietnamDateKeyOf } from "@/lib/mentee-interview-core";
import {
  EXPECTATION_ALIGNMENTS,
  TAKE_CHOICES,
  type ExpectationAlignment,
  type InterviewScore,
  type TakeChoice
} from "@/lib/mentee-interview-rubric-core";
import type { OfflineDashboard, OfflineOutcome } from "@/lib/mentee-offline-core";
import { progressStatus } from "@/lib/mentee-progress-core";

/**
 * lib/mentee-interview-report-core.ts — báo cáo kết quả phỏng vấn mentee theo
 * ĐỢT (BTC 06/10/2026). Phần thuần, không I/O.
 *
 * Một đợt là các ngày phỏng vấn liền nhau (03–04/10 là đợt 1). Báo cáo không
 * cộng dồn các đợt: đợt sau có người khác, mentor khác, và BTC đọc đợt 1 để rút
 * kinh nghiệm cho đợt 2 — trộn hai đợt là xoá đúng thứ đang cần so.
 *
 * Nguồn duy nhất là dữ liệu màn hình phỏng vấn trực tiếp (vam104_offline_dashboard),
 * cùng nguồn với trang tiến độ, để hai trang nói cùng một con số về cùng một ca.
 */

export const REPORT_GROUPS: OfflineOutcome[] = ["passed", "rejected", "needs_review"];

export const REPORT_GROUP_LABELS: Record<OfflineOutcome, string> = {
  passed: "(a) Đạt làm mentee",
  rejected: "(b) Không đạt",
  needs_review: "(c) Cần BTC xem xét"
};

export type ReportCriterion = { key: string; label: string; weight: number; score: number };

/** Một hồ sơ đã đặt lịch, rút gọn đúng những gì báo cáo cần — không tên, không SĐT. */
export type ReportRow = {
  sessionId: string;
  /** result = đã có kết quả; pending = đã đến, chưa có kết quả; not_arrived = chưa check-in. */
  status: "result" | "pending" | "not_arrived" | "withdrawn";
  outcome: OfflineOutcome | null;
  isOnline: boolean;
  yearOfStudy: string;
  targetIndustry: string;
  interviewerId: string;
  interviewerName: string;
  weightedScore: number | null;
  criteria: ReportCriterion[];
  alignment: ExpectationAlignment | null;
  takeChoice: TakeChoice | null;
  /** Mentor phỏng vấn đã nhận bạn này và cặp ghép CÒN hiệu lực. Cặp bấm nhầm đã huỷ không tính. */
  taken: boolean;
};

type Candidate = OfflineDashboard["candidates"][number];

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function criteriaOf(scores: InterviewScore[] | null | undefined): ReportCriterion[] {
  if (!Array.isArray(scores)) return [];
  return scores
    .filter((s) => s && typeof s.key === "string" && Number.isFinite(Number(s.score)))
    .map((s) => ({ key: s.key, label: s.label, weight: Number(s.weight) || 0, score: Number(s.score) }));
}

/**
 * Rút gọn danh sách màn hình phỏng vấn thành dòng báo cáo. Trạng thái đi qua
 * progressStatus — đúng hàm trang tiến độ dùng — để "chưa đến" ở hai trang là
 * cùng một nhóm người.
 *
 * `activeMatchIds`: id các cặp ghép đang hiệu lực. Màn hình phỏng vấn giữ match_id
 * cả khi BTC đã huỷ cặp ở trang Ghép cặp, nên "được chọn" phải đối chiếu trạng
 * thái cặp, không chỉ có hay không có match_id.
 */
export function reportRowsFrom(candidates: readonly Candidate[], activeMatchIds: ReadonlySet<string>): ReportRow[] {
  return candidates.map((c) => {
    const op = c.operation;
    const progress = progressStatus(c);
    const status: ReportRow["status"] =
      progress === "done" ? "result"
      : progress === "withdrawn" ? "withdrawn"
      : progress === "not_arrived" ? "not_arrived"
      : "pending";
    const review = op?.review_id ? c.reviews.find((r) => r.id === op.review_id) ?? null : null;
    const outcome = status === "result" ? op?.outcome ?? null : null;
    const payload = (c.rawPayload ?? {}) as Record<string, unknown>;
    return {
      sessionId: c.sessionId,
      status,
      outcome,
      isOnline: Boolean(op?.is_online),
      yearOfStudy: text(payload.year_of_study),
      targetIndustry: text(payload.target_industry),
      interviewerId: String(review?.reviewer_admin_user_id ?? op?.interviewer_id ?? review?.reviewerName ?? ""),
      interviewerName: text(review?.reviewerName) || "Chưa rõ người phỏng vấn",
      weightedScore: review ? numberOrNull(review.weighted_score) : null,
      criteria: criteriaOf(review?.interview_scores),
      alignment: (review?.expectation_alignment as ExpectationAlignment | null | undefined) ?? null,
      takeChoice: (review?.take_choice as TakeChoice | null | undefined) ?? null,
      taken: outcome === "passed" && Boolean(op?.match_id) && activeMatchIds.has(String(op?.match_id))
    };
  });
}

// ---------------------------------------------------------------------------
// Đợt phỏng vấn

export type InterviewWave = {
  /** Ngày đầu đợt, YYYY-MM-DD giờ Việt Nam — dùng làm ?dot= trên đường dẫn. */
  key: string;
  number: number;
  /** "03–04/10/2026" */
  dateLabel: string;
  /** "Đợt 1 · 03–04/10/2026" */
  label: string;
  dateKeys: string[];
  sessionIds: string[];
};

function dayNumber(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

export function waveDateLabel(dateKeys: readonly string[]): string {
  if (!dateKeys.length) return "";
  const [y1, m1, d1] = dateKeys[0].split("-");
  const [y2, m2, d2] = dateKeys[dateKeys.length - 1].split("-");
  if (dateKeys.length === 1) return `${d1}/${m1}/${y1}`;
  if (y1 === y2 && m1 === m2) return `${d1}–${d2}/${m2}/${y2}`;
  if (y1 === y2) return `${d1}/${m1}–${d2}/${m2}/${y2}`;
  return `${d1}/${m1}/${y1}–${d2}/${m2}/${y2}`;
}

/**
 * Gom ca thành đợt: các ngày phỏng vấn liền nhau (cách nhau ≤ 1 ngày) là một đợt.
 * Thứ Bảy + Chủ nhật là một đợt; cuối tuần sau là đợt kế tiếp — tự xuất hiện khi
 * BTC tạo ca, không phải sửa mã.
 */
export function interviewWaves(sessions: ReadonlyArray<{ id: string; starts_at: string }>): InterviewWave[] {
  const byDate = new Map<string, string[]>();
  for (const s of sessions) {
    const key = vietnamDateKeyOf(s.starts_at);
    if (!key) continue;
    const ids = byDate.get(key) ?? [];
    ids.push(s.id);
    byDate.set(key, ids);
  }
  const groups: string[][] = [];
  for (const date of Array.from(byDate.keys()).sort()) {
    const last = groups[groups.length - 1];
    if (last && dayNumber(date) - dayNumber(last[last.length - 1]) <= 1) last.push(date);
    else groups.push([date]);
  }
  return groups.map((dateKeys, index) => {
    const dateLabel = waveDateLabel(dateKeys);
    return {
      key: dateKeys[0],
      number: index + 1,
      dateLabel,
      label: `Đợt ${index + 1} · ${dateLabel}`,
      dateKeys,
      sessionIds: dateKeys.flatMap((d) => byDate.get(d) ?? [])
    };
  });
}

/** Đợt được hỏi trên đường dẫn; không có thì đợt gần nhất đã có kết quả. */
export function pickWave(waves: readonly InterviewWave[], rows: readonly ReportRow[], requested?: string | null): InterviewWave | null {
  if (!waves.length) return null;
  const asked = requested ? waves.find((w) => w.key === requested) : undefined;
  if (asked) return asked;
  for (let i = waves.length - 1; i >= 0; i--) {
    const ids = new Set(waves[i].sessionIds);
    if (rows.some((r) => r.status === "result" && ids.has(r.sessionId))) return waves[i];
  }
  return waves[waves.length - 1];
}

// ---------------------------------------------------------------------------
// Bảng đếm chéo

export type CrossTabColumn = { key: string; label: string; total: number };
export type CrossTabCell = { count: number; share: number };
export type CrossTabRow = { key: string; label: string; cells: CrossTabCell[]; total: number };
export type CrossTab = { columns: CrossTabColumn[]; rows: CrossTabRow[] };

type ColumnSpec = { key: string; label: string; filter: (row: ReportRow) => boolean };

const NOT_DECLARED = "__none__";

/**
 * Đếm chéo: mỗi dòng là một giá trị (năm học, ngành…), mỗi cột là một nhóm hồ sơ.
 * `share` là tỷ lệ TRONG CỘT — "34% hồ sơ Đạt là năm 1" — để so cơ cấu giữa các
 * nhóm có cỡ khác nhau. `total` là tổng các cột.
 *
 * Giá trị lạ (không có trong danh sách lựa chọn của form) vẫn được đếm, hiện
 * nguyên mã — bỏ qua nó là làm tổng các dòng lệch với tổng hồ sơ.
 */
export function crossTab(
  rows: readonly ReportRow[],
  columns: readonly ColumnSpec[],
  categoryOf: (row: ReportRow) => string,
  options: readonly FormOption[],
  order: "options" | "count" = "options"
): CrossTab {
  const labels = new Map<string, string>(options.map((o) => [o.value, o.label]));
  const counts = new Map<string, number[]>();
  const totals = columns.map(() => 0);
  for (const row of rows) {
    const raw = categoryOf(row);
    const key = raw ? raw : NOT_DECLARED;
    columns.forEach((col, i) => {
      if (!col.filter(row)) return;
      const line = counts.get(key) ?? columns.map(() => 0);
      line[i] += 1;
      counts.set(key, line);
      totals[i] += 1;
    });
  }
  const optionOrder = new Map<string, number>(options.map((o, i) => [o.value, i]));
  const rank = (key: string) => (key === NOT_DECLARED ? Number.MAX_SAFE_INTEGER : optionOrder.get(key) ?? options.length);
  const result: CrossTabRow[] = Array.from(counts.entries()).map(([key, line]) => ({
    key,
    label: key === NOT_DECLARED ? "Chưa khai" : labels.get(key) ?? key,
    cells: line.map((count, i) => ({ count, share: totals[i] ? count / totals[i] : 0 })),
    total: line.reduce((sum, n) => sum + n, 0)
  }));
  result.sort((a, b) => {
    if (order === "count" && b.total !== a.total) return b.total - a.total;
    const byRank = rank(a.key) - rank(b.key);
    return byRank !== 0 ? byRank : a.label.localeCompare(b.label, "vi");
  });
  return { columns: columns.map((c, i) => ({ key: c.key, label: c.label, total: totals[i] })), rows: result };
}

// ---------------------------------------------------------------------------
// Điểm

export function average(values: ReadonlyArray<number | null>): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

export type ScoreSummary = {
  count: number;
  weighted: number | null;
  criteria: Array<{ key: string; label: string; weight: number; avg: number | null }>;
};

/** Trung bình điểm quy đổi và từng tiêu chí; tiêu chí theo thứ tự trên phiếu. */
export function scoreSummary(rows: readonly ReportRow[], criteriaOrder: readonly ReportCriterion[]): ScoreSummary {
  return {
    count: rows.length,
    weighted: average(rows.map((r) => r.weightedScore)),
    criteria: criteriaOrder.map((c) => ({
      key: c.key,
      label: c.label,
      weight: c.weight,
      avg: average(rows.map((r) => r.criteria.find((x) => x.key === c.key)?.score ?? null))
    }))
  };
}

/** Các tiêu chí theo thứ tự lần đầu xuất hiện — phiếu của mùa không đổi giữa đợt. */
function criteriaOrderOf(rows: readonly ReportRow[]): ReportCriterion[] {
  const seen = new Map<string, ReportCriterion>();
  for (const r of rows) for (const c of r.criteria) if (!seen.has(c.key)) seen.set(c.key, c);
  return Array.from(seen.values());
}

export type GroupScore = { count: number; avg: number | null };

export type InterviewerRow = {
  id: string;
  name: string;
  forms: number;
  avg: number | null;
  byGroup: Record<OfflineOutcome, GroupScore>;
  taken: number;
};

function groupScores(rows: readonly ReportRow[]): Record<OfflineOutcome, GroupScore> {
  const pick = (g: OfflineOutcome) => rows.filter((r) => r.outcome === g);
  return {
    passed: { count: pick("passed").length, avg: average(pick("passed").map((r) => r.weightedScore)) },
    rejected: { count: pick("rejected").length, avg: average(pick("rejected").map((r) => r.weightedScore)) },
    needs_review: { count: pick("needs_review").length, avg: average(pick("needs_review").map((r) => r.weightedScore)) }
  };
}

/** Điểm quy đổi trung bình theo từng người phỏng vấn, tách theo nhóm kết quả. */
export function interviewerTable(results: readonly ReportRow[]): { rows: InterviewerRow[]; all: InterviewerRow } {
  const byId = new Map<string, ReportRow[]>();
  for (const r of results) {
    const list = byId.get(r.interviewerId) ?? [];
    list.push(r);
    byId.set(r.interviewerId, list);
  }
  const make = (id: string, name: string, list: readonly ReportRow[]): InterviewerRow => ({
    id,
    name,
    forms: list.length,
    avg: average(list.map((r) => r.weightedScore)),
    byGroup: groupScores(list),
    taken: list.filter((r) => r.taken).length
  });
  const rows = Array.from(byId.entries())
    .map(([id, list]) => make(id, list[0].interviewerName, list))
    .sort((a, b) => a.name.localeCompare(b.name, "vi", { sensitivity: "base" }));
  return { rows, all: make("__all__", "Tất cả người phỏng vấn", results) };
}

// ---------------------------------------------------------------------------
// Báo cáo một đợt

export type WaveTotals = {
  booked: number;
  attended: number;
  notArrived: number;
  withdrawn: number;
  pending: number;
  results: number;
  passed: number;
  rejected: number;
  needs_review: number;
  taken: number;
  online: number;
  interviewers: number;
  mentorsTaking: number;
};

export const YEAR_OPTIONS: readonly FormOption[] = MENTEE_FORM_OPTION_LISTS.YEAR_OF_STUDY_OPTIONS;
export const INDUSTRY_OPTIONS: readonly FormOption[] = MENTEE_FORM_OPTION_LISTS.TARGET_INDUSTRY_OPTIONS;

const ALIGNMENT_OPTIONS: FormOption[] = (Object.keys(EXPECTATION_ALIGNMENTS) as ExpectationAlignment[]).map((key) => ({
  value: key,
  label: EXPECTATION_ALIGNMENTS[key]
}));

/** Nhóm còn lại của (a) đã chọn gì ở mục C. "take" mà cặp không còn = chọn rồi huỷ. */
const REST_CHOICE_OPTIONS: FormOption[] = [
  { value: "recommend_other", label: TAKE_CHOICES.recommend_other },
  { value: "undecided", label: TAKE_CHOICES.undecided },
  { value: "take", label: "Đã chọn “Có” nhưng cặp ghép sau đó bị huỷ" }
];

export type InterviewReport = {
  wave: InterviewWave;
  totals: WaveTotals;
  /** Cột: (a), (b), (c); Tổng của dòng là cả ba. */
  byYear: CrossTab;
  byIndustry: CrossTab;
  alignment: CrossTab;
  scores: Record<OfflineOutcome | "all", ScoreSummary>;
  interviewers: { rows: InterviewerRow[]; all: InterviewerRow };
  /** Trong (a): cột "được mentor chọn ngay" và "còn lại". */
  taken: {
    byYear: CrossTab;
    byIndustry: CrossTab;
    alignment: CrossTab;
    scores: { taken: ScoreSummary; rest: ScoreSummary };
    restChoices: CrossTab;
  };
};

export function buildInterviewReport(allRows: readonly ReportRow[], wave: InterviewWave): InterviewReport {
  const inWave = new Set(wave.sessionIds);
  const rows = allRows.filter((r) => inWave.has(r.sessionId));
  const results = rows.filter((r) => r.status === "result");
  const passed = results.filter((r) => r.outcome === "passed");
  const takenRows = passed.filter((r) => r.taken);
  const restRows = passed.filter((r) => !r.taken);
  const order = criteriaOrderOf(results);

  // Không thêm cột "tất cả": cột Tổng của bảng đã là (a)+(b)+(c), thêm cột nữa là đếm đôi.
  const groupColumns: ColumnSpec[] = REPORT_GROUPS.map((g) => ({
    key: g,
    label: REPORT_GROUP_LABELS[g],
    filter: (r: ReportRow) => r.status === "result" && r.outcome === g
  }));
  const takenColumns: ColumnSpec[] = [
    { key: "taken", label: "Được mentor chọn ngay", filter: (r) => r.status === "result" && r.outcome === "passed" && r.taken },
    { key: "rest", label: "Đạt, chưa có mentor", filter: (r) => r.status === "result" && r.outcome === "passed" && !r.taken }
  ];
  const year = (r: ReportRow) => r.yearOfStudy;
  const industry = (r: ReportRow) => r.targetIndustry;
  const alignment = (r: ReportRow) => r.alignment ?? "";

  const totals: WaveTotals = {
    booked: rows.length,
    attended: rows.filter((r) => r.status === "result" || r.status === "pending").length,
    notArrived: rows.filter((r) => r.status === "not_arrived").length,
    withdrawn: rows.filter((r) => r.status === "withdrawn").length,
    pending: rows.filter((r) => r.status === "pending").length,
    results: results.length,
    passed: passed.length,
    rejected: results.filter((r) => r.outcome === "rejected").length,
    needs_review: results.filter((r) => r.outcome === "needs_review").length,
    taken: takenRows.length,
    online: results.filter((r) => r.isOnline).length,
    interviewers: new Set(results.map((r) => r.interviewerId)).size,
    mentorsTaking: new Set(takenRows.map((r) => r.interviewerId)).size
  };

  return {
    wave,
    totals,
    byYear: crossTab(results, groupColumns, year, YEAR_OPTIONS),
    byIndustry: crossTab(results, groupColumns, industry, INDUSTRY_OPTIONS, "count"),
    alignment: crossTab(results, groupColumns, alignment, ALIGNMENT_OPTIONS),
    scores: {
      passed: scoreSummary(passed, order),
      rejected: scoreSummary(results.filter((r) => r.outcome === "rejected"), order),
      needs_review: scoreSummary(results.filter((r) => r.outcome === "needs_review"), order),
      all: scoreSummary(results, order)
    },
    interviewers: interviewerTable(results),
    taken: {
      byYear: crossTab(passed, takenColumns, year, YEAR_OPTIONS),
      byIndustry: crossTab(passed, takenColumns, industry, INDUSTRY_OPTIONS, "count"),
      alignment: crossTab(passed, takenColumns, alignment, ALIGNMENT_OPTIONS),
      scores: { taken: scoreSummary(takenRows, order), rest: scoreSummary(restRows, order) },
      restChoices: crossTab(restRows, [{ key: "rest", label: "Đạt, chưa có mentor", filter: () => true }], (r) => r.takeChoice ?? "", REST_CHOICE_OPTIONS)
    }
  };
}

// ---------------------------------------------------------------------------
// Định dạng

const SCORE_FORMAT = new Intl.NumberFormat("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "3,98" — điểm thang 5, dấu phẩy thập phân. Không có phiếu nào thì "—". */
export function formatScore(value: number | null): string {
  return value === null ? "—" : SCORE_FORMAT.format(value);
}

/** "34%" — làm tròn tới phần trăm. */
export function formatShare(value: number): string {
  return `${Math.round(value * 100)}%`;
}
