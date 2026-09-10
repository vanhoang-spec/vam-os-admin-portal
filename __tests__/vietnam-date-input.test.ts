/**
 * Ô nhập ngày giờ tự dựng — luôn dd/mm/yyyy.
 *
 * `<input type="datetime-local">` hiển thị theo ngôn ngữ của TRÌNH DUYỆT, nên
 * Chrome tiếng Anh vẽ `mm/dd/yyyy`. Chương trình đã chốt `dd/mm/yyyy` xuyên
 * suốt, và một ô nhập nói khác cả phần còn lại của CRM là chỗ người ta đọc
 * nhầm — với ngày như 05/09 thì nhầm mà không hề biết.
 */
import { describe, expect, it } from "vitest";
import {
  combineVietnamDateTime,
  maskVietnamDate,
  maskVietnamTime,
  parseVietnamDateInput,
  parseVietnamTimeInput,
  splitVietnamDateTime,
  toVietnamDateInput
} from "@/lib/event-datetime";

describe("maskVietnamDate — chèn dấu trong lúc gõ", () => {
  it("chèn dấu gạch chéo đúng chỗ", () => {
    expect(maskVietnamDate("2")).toBe("2");
    expect(maskVietnamDate("20")).toBe("20");
    expect(maskVietnamDate("209")).toBe("20/9");
    expect(maskVietnamDate("2009")).toBe("20/09");
    expect(maskVietnamDate("200920")).toBe("20/09/20");
    expect(maskVietnamDate("20092026")).toBe("20/09/2026");
  });

  it("bỏ mọi ký tự không phải số", () => {
    expect(maskVietnamDate("20/09/2026")).toBe("20/09/2026");
    expect(maskVietnamDate("20-09-2026")).toBe("20/09/2026");
    expect(maskVietnamDate("2a0b0c9d2026")).toBe("20/09/2026");
  });

  it("không nhận quá tám chữ số", () => {
    expect(maskVietnamDate("2009202699")).toBe("20/09/2026");
  });

  it("KHÔNG tự đệm số 0 giữa chừng", () => {
    // Người đang gõ `3` để tiến tới `30` sẽ bị một bộ sửa quá sốt sắng đổi
    // thành `03` ngay dưới tay họ.
    expect(maskVietnamDate("3")).toBe("3");
  });
});

describe("maskVietnamTime", () => {
  it("chèn dấu hai chấm", () => {
    expect(maskVietnamTime("0")).toBe("0");
    expect(maskVietnamTime("08")).toBe("08");
    expect(maskVietnamTime("080")).toBe("08:0");
    expect(maskVietnamTime("0800")).toBe("08:00");
  });

  it("không nhận quá bốn chữ số", () => {
    expect(maskVietnamTime("080099")).toBe("08:00");
  });
});

describe("parseVietnamDateInput — ngày trước, tháng sau", () => {
  it("đọc đúng thứ tự ngày/tháng", () => {
    // Ca quan trọng nhất: 05/09 là mùng 5 tháng 9, KHÔNG phải mùng 9 tháng 5.
    expect(parseVietnamDateInput("05/09/2026")).toBe("2026-09-05");
    expect(parseVietnamDateInput("20/09/2026")).toBe("2026-09-20");
  });

  it("từ chối ngày không có thật", () => {
    // `31/02` lọt qua mọi phép kiểm "ngày từ 1 đến 31", và `new Date` sẽ lặng
    // lẽ đổi nó thành mùng 3 tháng 3.
    expect(parseVietnamDateInput("31/02/2026")).toBeNull();
    expect(parseVietnamDateInput("31/04/2026")).toBeNull();
    expect(parseVietnamDateInput("30/02/2028")).toBeNull();
  });

  it("nhận ngày 29 tháng 2 của năm nhuận", () => {
    expect(parseVietnamDateInput("29/02/2028")).toBe("2028-02-29");
    expect(parseVietnamDateInput("29/02/2026")).toBeNull();
  });

  it("từ chối tháng và ngày ngoài khoảng", () => {
    for (const bad of ["00/09/2026", "20/00/2026", "20/13/2026", "32/01/2026"]) {
      expect(parseVietnamDateInput(bad), bad).toBeNull();
    }
  });

  it("từ chối chuỗi chưa đủ hoặc sai dạng", () => {
    for (const bad of ["", "20/09", "20/09/26", "2026-09-20", "hôm nay", null]) {
      expect(parseVietnamDateInput(bad), String(bad)).toBeNull();
    }
  });
});

describe("parseVietnamTimeInput", () => {
  it("nhận giờ hợp lệ", () => {
    expect(parseVietnamTimeInput("08:00")).toBe("08:00");
    expect(parseVietnamTimeInput("23:59")).toBe("23:59");
    expect(parseVietnamTimeInput("00:00")).toBe("00:00");
  });

  it("từ chối giờ và phút ngoài khoảng", () => {
    for (const bad of ["24:00", "25:00", "08:60", "08:99"]) {
      expect(parseVietnamTimeInput(bad), bad).toBeNull();
    }
  });

  it("từ chối chuỗi chưa đủ", () => {
    for (const bad of ["", "8:00", "08", "08:0"]) {
      expect(parseVietnamTimeInput(bad), bad).toBeNull();
    }
  });
});

describe("combineVietnamDateTime", () => {
  it("ghép thành dạng máy chủ đọc được", () => {
    expect(combineVietnamDateTime("20/09/2026", "08:00")).toBe("2026-09-20T08:00");
  });

  it("thiếu một trong hai thì rỗng, không đoán nốt phần còn lại", () => {
    expect(combineVietnamDateTime("20/09/2026", "")).toBe("");
    expect(combineVietnamDateTime("", "08:00")).toBe("");
    expect(combineVietnamDateTime("31/02/2026", "08:00")).toBe("");
  });
});

describe("đi một vòng rồi về", () => {
  it("giá trị đang lưu đổ ngược vào ô nhập rồi ghép lại phải bằng chính nó", () => {
    for (const stored of [
      "2026-09-20T01:00:00.000Z",
      "2026-01-02T17:30:00.000Z",
      "2026-12-31T16:59:00.000Z"
    ]) {
      const parts = splitVietnamDateTime(stored);
      expect(parts.date, stored).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
      const combined = combineVietnamDateTime(parts.date, parts.time);
      expect(combined, stored).not.toBe("");
    }
  });

  it("splitVietnamDateTime cho ra ngày theo giờ Việt Nam", () => {
    // 01:00Z ngày 20/09 là 08:00 ngày 20/09 giờ Việt Nam.
    expect(splitVietnamDateTime("2026-09-20T01:00:00.000Z")).toEqual({
      date: "20/09/2026",
      time: "08:00"
    });
  });

  it("giá trị rỗng cho ra hai ô rỗng", () => {
    expect(splitVietnamDateTime("")).toEqual({ date: "", time: "" });
    expect(splitVietnamDateTime(null)).toEqual({ date: "", time: "" });
  });

  it("toVietnamDateInput đảo đúng thứ tự", () => {
    expect(toVietnamDateInput("2026-09-20")).toBe("20/09/2026");
    expect(toVietnamDateInput("")).toBe("");
  });
});
