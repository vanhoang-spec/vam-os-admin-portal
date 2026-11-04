/**
 * VAM00023 — lọc danh sách mentee phỏng vấn trực tiếp trước khi xuất Excel. Phần thuần, không I/O, không phụ thuộc
 * gói chỉ chạy ở máy chủ: trang dùng nó để lọc ngay trên màn hình, còn đường tải áp lại ĐÚNG các điều kiện này vì
 * cái đến từ biểu mẫu là thứ người gửi tự đặt được (CLAUDE.md).
 *
 * Các điều kiện kết hợp bằng VÀ: một mentee chỉ ở lại khi thoả mọi điều kiện đang đặt.
 */

export const NONE = "__none";
/** Một lần xuất tối đa chừng này mentee: đủ cho cả mùa (903 bạn mùa 12), chặn một yêu cầu phình vô hạn. */
export const MAX_EXPORT_IDS = 2000;

export type ExportRoundCell = { reviewerId: string; reviewerName: string; result: string };
export type ExportSummaryRow = {
  id: string;
  name: string;
  email: string;
  /** Giờ bắt đầu ca phỏng vấn, ISO; rỗng nếu chưa biết ca. */
  startsAt: string;
  profile: ExportRoundCell;
  interview: ExportRoundCell;
};

export type ExportFilters = {
  ids?: string[];
  q?: string;
  profileReviewer?: string;
  profileResult?: string;
  interviewReviewer?: string;
  interviewResult?: string;
};

const COMBINING_MARKS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g");

/** Bỏ dấu, bỏ hoa thường: gõ "nguyen" vẫn ra "Nguyễn". */
export function foldText(value: string) {
  return value.normalize("NFD").replace(COMBINING_MARKS, "").replace(/[đĐ]/g, "d").toLowerCase();
}

function matchesChoice(cellValue: string, wanted: string | undefined) {
  if (!wanted) return true;
  return wanted === NONE ? cellValue === "" : cellValue === wanted;
}

export function applyExportFilters(rows: readonly ExportSummaryRow[], filters: ExportFilters): ExportSummaryRow[] {
  const ids = filters.ids && filters.ids.length ? new Set(filters.ids) : null;
  const tokens = foldText(filters.q ?? "").split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (ids && !ids.has(row.id)) return false;
    if (tokens.length) {
      const haystack = foldText(`${row.name} ${row.email}`);
      if (!tokens.every((token) => haystack.includes(token))) return false;
    }
    if (!matchesChoice(row.profile.reviewerId, filters.profileReviewer)) return false;
    if (!matchesChoice(row.profile.result, filters.profileResult)) return false;
    if (!matchesChoice(row.interview.reviewerId, filters.interviewReviewer)) return false;
    if (!matchesChoice(row.interview.result, filters.interviewResult)) return false;
    return true;
  });
}

/** Người đánh giá có mặt trong danh sách, xếp A → Z theo tên: nguồn của hai ô chọn người đánh giá. */
export function reviewerOptions(rows: readonly ExportSummaryRow[], round: "profile" | "interview") {
  const names = new Map<string, string>();
  for (const row of rows) {
    const cell = row[round];
    if (cell.reviewerId) names.set(cell.reviewerId, cell.reviewerName || cell.reviewerId);
  }
  return Array.from(names, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "vi", { sensitivity: "base" }));
}

/** Kết quả có mặt trong danh sách (không tính ô trống), theo thứ tự xuất hiện đầu tiên. */
export function resultOptions(rows: readonly ExportSummaryRow[], round: "profile" | "interview") {
  const seen = new Set<string>();
  for (const row of rows) if (row[round].result) seen.add(row[round].result);
  return Array.from(seen);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESULT_KEY = /^[a-z][a-z0-9_]{1,39}$/;
/** Kết quả vòng phỏng vấn là ba giá trị cố định của database (mentee_interview_operations.outcome). */
const INTERVIEW_RESULTS = ["passed", "rejected", "needs_review"];

export type ExportFilterParse = { ok: true; filters: ExportFilters } | { ok: false; message: string };

/**
 * Đọc điều kiện từ biểu mẫu. Giá trị sai dạng là LỖI chứ không lặng lẽ bỏ qua: bỏ một điều kiện nghĩa là xuất rộng
 * hơn người dùng đã chọn, và file này chứa dữ liệu cá nhân.
 */
export function parseExportFilters(read: (key: string) => string | null | undefined): ExportFilterParse {
  const filters: ExportFilters = {};
  const rawIds = String(read("ids") ?? "").trim();
  if (rawIds) {
    const ids = rawIds.split(/[\s,;]+/).filter(Boolean);
    if (ids.length > MAX_EXPORT_IDS) return { ok: false, message: `Chọn tối đa ${MAX_EXPORT_IDS} mentee mỗi lần xuất.` };
    if (ids.some((id) => !UUID.test(id))) return { ok: false, message: "Danh sách mentee có mã không hợp lệ." };
    filters.ids = Array.from(new Set(ids.map((id) => id.toLowerCase())));
  }
  const q = String(read("q") ?? "").trim();
  if (q.length > 100) return { ok: false, message: "Ô tìm mentee quá dài." };
  if (q) filters.q = q;

  for (const [field, key] of [["profile_reviewer", "profileReviewer"], ["interview_reviewer", "interviewReviewer"]] as const) {
    const value = String(read(field) ?? "").trim();
    if (!value) continue;
    if (value !== NONE && !UUID.test(value)) return { ok: false, message: "Người đánh giá không hợp lệ." };
    filters[key] = value === NONE ? value : value.toLowerCase();
  }
  const profileResult = String(read("profile_result") ?? "").trim();
  if (profileResult) {
    if (profileResult !== NONE && !RESULT_KEY.test(profileResult)) return { ok: false, message: "Kết quả vòng hồ sơ không hợp lệ." };
    filters.profileResult = profileResult;
  }
  const interviewResult = String(read("interview_result") ?? "").trim();
  if (interviewResult) {
    if (interviewResult !== NONE && !INTERVIEW_RESULTS.includes(interviewResult)) return { ok: false, message: "Kết quả vòng phỏng vấn không hợp lệ." };
    filters.interviewResult = interviewResult;
  }
  return { ok: true, filters };
}
