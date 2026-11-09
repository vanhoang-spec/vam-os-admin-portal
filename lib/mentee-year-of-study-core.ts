import { MENTEE_FORM_OPTION_LISTS, type FormOption } from "@/lib/application-form-options";
import { displayYearOfStudy } from "@/lib/member-code-core";

/**
 * Năm học của mentee trên hồ sơ (`mentee_profiles.year_of_study`, VAM00030).
 *
 * "Năm học" ở đây là sinh viên đang học năm thứ mấy, đúng như câu "Năm học hiện tại" của đơn
 * ứng tuyển mentee: đơn lưu mã "1".."4" hoặc "graduated", danh sách /mentees và file Excel hồ sơ
 * đọc mã đó qua `displayYearOfStudy`. Dùng chung danh sách lựa chọn của đơn để form sửa hồ sơ
 * không tự đặt ra một bộ mã thứ hai mà chỗ hiển thị không đọc được.
 *
 * Phần thuần, an toàn cho cả client lẫn server.
 */
export const MENTEE_YEAR_OF_STUDY_OPTIONS: readonly FormOption[] = MENTEE_FORM_OPTION_LISTS.YEAR_OF_STUDY_OPTIONS;

export type YearOfStudyParse = { ok: true; value: string | null } | { ok: false; message: string };

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value).trim();
}

/**
 * Kiểm lại giá trị năm học gửi từ form. Ô chọn trên màn hình không phải phép kiểm: ai cũng POST
 * thẳng được một chuỗi tuỳ ý, và chuỗi lạ thì danh sách hiện nguyên văn.
 *
 * - Trống: null (chưa rõ), không lưu chuỗi rỗng.
 * - Mã trong danh sách lựa chọn của đơn: nhận.
 * - Đúng bằng giá trị đang lưu (dữ liệu cũ ngoài danh sách): nhận, để bấm "Lưu" một hồ sơ cũ vì
 *   sửa trường khác không bị chặn và cũng không xoá mất giá trị đó.
 * - Còn lại: từ chối.
 */
export function parseYearOfStudy(raw: unknown, current?: unknown): YearOfStudyParse {
  const value = text(raw);
  if (!value) return { ok: true, value: null };
  if (MENTEE_YEAR_OF_STUDY_OPTIONS.some((option) => option.value === value)) return { ok: true, value };
  const stored = text(current);
  if (stored && value === stored) return { ok: true, value: stored };
  return {
    ok: false,
    message: `Năm học không hợp lệ. Chọn một trong: ${MENTEE_YEAR_OF_STUDY_OPTIONS.map((option) => option.label).join(", ")}, hoặc để trống.`
  };
}

/** Lựa chọn cho ô Năm học: danh sách của đơn, cộng giá trị cũ đang lưu nếu nó nằm ngoài danh sách. */
export function yearOfStudyFormOptions(current: unknown): FormOption[] {
  const options = [...MENTEE_YEAR_OF_STUDY_OPTIONS];
  const stored = text(current);
  if (stored && !options.some((option) => option.value === stored)) {
    options.push({ value: stored, label: `${displayYearOfStudy(stored)} (giá trị cũ)` });
  }
  return options;
}
