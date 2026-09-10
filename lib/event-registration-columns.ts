/**
 * lib/event-registration-columns.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Cột nào của bảng "Danh sách đăng ký & check-in" có gì để nói.
 *
 * Một sự kiện chỉ hỏi những gì nó bật trong biểu mẫu đăng ký. Sự kiện không hỏi
 * trường lớp thì cột "Thông tin" là một cột toàn dấu gạch ngang: nó lấy mất bề
 * ngang của những cột có nội dung thật, và bắt người đọc quét mắt qua một cột
 * không bao giờ nói gì.
 *
 * Xét theo CẢ BẢNG chứ không theo từng ô. Một cột hiện ở hàng này mà mất ở hàng
 * kia thì không còn là bảng — các ô sẽ lệch nhau và người đọc mất chỗ bám.
 *
 * Module thuần, không I/O, để phần quyết định này kiểm được mà không phải dựng
 * cả một trang máy chủ.
 */

type Row = Record<string, unknown>;

function filled(value: unknown): boolean {
  return String(value ?? "").trim().length > 0;
}

/** Có ai khai trường hoặc ngành học không. */
export function hasAnyProfileInfo(rows: Row[]): boolean {
  return rows.some((row) => filled(row.school) || filled(row.program_of_study));
}

/**
 * Có ai chọn bữa trưa, hoặc có khoản thanh toán nào cần theo dõi không.
 *
 * `not_required` không tính: đó là giá trị mặc định của một sự kiện miễn phí,
 * và nó có mặt trên MỌI dòng — coi nó là "có dữ liệu" thì cột này không bao giờ
 * ẩn được.
 */
export function hasAnyMealOrPayment(rows: Row[]): boolean {
  return rows.some(
    (row) =>
      row.meal_selected === true ||
      (filled(row.payment_status) && row.payment_status !== "not_required")
  );
}
