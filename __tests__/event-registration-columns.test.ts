/**
 * Cột rỗng của bảng "Danh sách đăng ký & check-in" thì không vẽ ra.
 *
 * ---------------------------------------------------------------------------
 * CHUYỆN ĐÃ XẢY RA THẬT
 * ---------------------------------------------------------------------------
 * Sự kiện Mentor Orientation không hỏi trường lớp, không thu phí, không có bữa
 * trưa. Bảng vẫn vẽ đủ hai cột "Thông tin" và "Ăn trưa / Thanh toán", mỗi ô là
 * một dấu gạch ngang.
 *
 * Hai cột trống đó lấy mất bề ngang của những cột có nội dung thật, và với một
 * bảng đã chật thì hậu quả không dừng ở thẩm mỹ: các ô còn lại hẹp tới mức
 * "Đã đăng ký" bị bẻ thành ba dòng, mỗi hàng cao gần trăm điểm ảnh, và màn hình
 * chỉ còn chứa nổi ba người — trong khi việc thường làm với bảng này là dò cả
 * danh sách.
 */
import { describe, expect, it } from "vitest";
import { hasAnyMealOrPayment, hasAnyProfileInfo } from "@/lib/event-registration-columns";

describe("cột Thông tin", () => {
  it("có người khai trường thì hiện", () => {
    expect(hasAnyProfileInfo([{ school: "UEH" }])).toBe(true);
  });

  it("có người khai ngành học thì hiện", () => {
    expect(hasAnyProfileInfo([{ program_of_study: "Kinh doanh quốc tế" }])).toBe(true);
  });

  it("chỉ MỘT người khai cũng đủ để hiện cả cột", () => {
    // Cột hiện ở hàng này mà mất ở hàng kia thì không còn là bảng.
    expect(
      hasAnyProfileInfo([{ school: null }, { school: "UEH" }, { school: null }])
    ).toBe(true);
  });

  it("cả bảng không ai khai thì ẩn", () => {
    expect(
      hasAnyProfileInfo([
        { school: null, program_of_study: null },
        { school: "", program_of_study: "" }
      ])
    ).toBe(false);
  });

  it("ô chỉ có khoảng trắng không tính là có dữ liệu", () => {
    // Một ô toàn dấu cách vẫn vẽ ra một cột trống — đúng thứ đang muốn bỏ.
    expect(hasAnyProfileInfo([{ school: "   ", program_of_study: "\t" }])).toBe(false);
  });

  it("bảng rỗng thì ẩn", () => {
    expect(hasAnyProfileInfo([])).toBe(false);
  });
});

describe("cột Ăn trưa / Thanh toán", () => {
  it("có người chọn bữa trưa thì hiện", () => {
    expect(hasAnyMealOrPayment([{ meal_selected: true }])).toBe(true);
  });

  it("có khoản thanh toán cần theo dõi thì hiện", () => {
    for (const status of ["pending", "submitted", "confirmed"]) {
      expect(hasAnyMealOrPayment([{ payment_status: status }]), status).toBe(true);
    }
  });

  it('"not_required" KHÔNG tính là có dữ liệu', () => {
    // Đây là ca quan trọng nhất: `not_required` là giá trị mặc định của một sự
    // kiện miễn phí và nó có mặt trên MỌI dòng. Coi nó là có dữ liệu thì cột
    // này không bao giờ ẩn được, và tính năng coi như không tồn tại.
    expect(
      hasAnyMealOrPayment([
        { meal_selected: false, payment_status: "not_required" },
        { meal_selected: false, payment_status: "not_required" }
      ])
    ).toBe(false);
  });

  it("chuỗi 'false' không bị hiểu nhầm là đã chọn bữa trưa", () => {
    expect(hasAnyMealOrPayment([{ meal_selected: "false" }])).toBe(false);
  });

  it("bảng rỗng thì ẩn", () => {
    expect(hasAnyMealOrPayment([])).toBe(false);
  });
});
