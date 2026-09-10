/**
 * Giờ gõ vào form phải là giờ được lưu, và là giờ hiện lại.
 *
 * ---------------------------------------------------------------------------
 * LỖI NÀY ĐÃ XẢY RA THẬT
 * ---------------------------------------------------------------------------
 * Chủ chương trình tạo sự kiện lúc 08:00, mở lại thấy 15:00. Sửa về 08:00,
 * lưu, mở lại vẫn thấy giờ khác — trông y hệt như nút lưu không có tác dụng.
 *
 * Nguyên nhân: ô `datetime-local` cho ra `2026-09-20T08:00`, KHÔNG mang múi
 * giờ, và `new Date()` hiểu chuỗi đó theo giờ của máy đang chạy. Máy chủ Vercel
 * chạy UTC, nên 8 giờ sáng Việt Nam thành 8 giờ sáng UTC — lệch bảy tiếng, mỗi
 * lần lưu lại lệch thêm một lần nữa.
 *
 * Cả file này chạy dưới TZ=UTC (vitest.config.ts) — đúng như production. Một
 * bản sửa chỉ đúng nhờ máy người viết đặt giờ Việt Nam sẽ đỏ ở đây.
 */
import { describe, expect, it } from "vitest";
import { parseVietnamDateTime, toVietnamInputValue } from "@/lib/event-datetime";
import { formatDate, formatTime } from "@/lib/utils";

describe("parseVietnamDateTime — chuỗi không múi giờ là giờ Việt Nam", () => {
  it("08:00 gõ vào form là 08:00 ở Việt Nam, không phải 08:00 UTC", () => {
    // Đây là ca tái hiện lỗi.
    const iso = parseVietnamDateTime("2026-09-20T08:00");
    expect(iso).toBe("2026-09-20T01:00:00.000Z");
    expect(formatTime(iso)).toBe("08:00");
    expect(formatDate(iso)).toBe("20/09/2026");
  });

  it("giữ đúng ngày cho giờ sát nửa đêm", () => {
    // 00:30 ngày 20/09 giờ Việt Nam là 17:30 ngày 19/09 UTC. Hiểu sai múi giờ
    // ở đây làm sự kiện nhảy sang ngày khác, không chỉ lệch giờ.
    const iso = parseVietnamDateTime("2026-09-20T00:30");
    expect(formatDate(iso)).toBe("20/09/2026");
    expect(formatTime(iso)).toBe("00:30");
  });

  it("giữ nguyên chuỗi đã mang múi giờ", () => {
    // Các buổi của một chuỗi lặp được hệ thống sinh ra ở dạng ISO đầy đủ. Gán
    // thêm +07:00 vào đó là dịch chúng đi bảy tiếng.
    expect(parseVietnamDateTime("2026-09-20T01:00:00.000Z")).toBe("2026-09-20T01:00:00.000Z");
    expect(parseVietnamDateTime("2026-09-20T08:00:00+07:00")).toBe("2026-09-20T01:00:00.000Z");
  });

  it("trả null cho giá trị rỗng hoặc gõ dở, không ném", () => {
    for (const bad of ["", "   ", null, undefined, "2026-09-", "hôm nào đó", "T08:00"]) {
      expect(parseVietnamDateTime(bad), String(bad)).toBeNull();
    }
  });
});

describe("toVietnamInputValue — hiện lại đúng giờ đã gõ", () => {
  it("mốc đã lưu quay về đúng chuỗi ban đầu", () => {
    expect(toVietnamInputValue("2026-09-20T01:00:00.000Z")).toBe("2026-09-20T08:00");
  });

  it("không phụ thuộc múi giờ của máy đang chạy", () => {
    // Bản cũ dùng `getTimezoneOffset()`. Một quản trị viên đang ở nước ngoài
    // mở form sửa sẽ thấy giờ nơi họ đứng, sửa một chỗ khác, và lưu đè lên giờ
    // thật của sự kiện. File này chạy dưới TZ=UTC, nên bản cũ sẽ ra "01:00".
    expect(toVietnamInputValue("2026-09-20T01:00:00.000Z")).toContain("T08:00");
  });

  it("rỗng vào thì rỗng ra", () => {
    for (const empty of ["", null, undefined, "hôm nào đó"]) {
      expect(toVietnamInputValue(empty), String(empty)).toBe("");
    }
  });
});

describe("đi một vòng rồi về phải bằng chính nó", () => {
  it("gõ → lưu → mở lại → lưu lại: giờ đứng yên", () => {
    // Đây là tính chất mà lỗi đã phá: mỗi vòng dịch thêm bảy tiếng, nên nó
    // không bao giờ hội tụ và trông như nút lưu không chạy.
    for (const typed of [
      "2026-09-20T08:00",
      "2026-09-20T00:30",
      "2026-09-20T23:45",
      "2026-12-31T23:59",
      "2026-01-01T00:00"
    ]) {
      const stored = parseVietnamDateTime(typed);
      const shown = toVietnamInputValue(stored);
      expect(shown, typed).toBe(typed);

      // Vòng thứ hai cũng phải đứng yên.
      expect(toVietnamInputValue(parseVietnamDateTime(shown)), typed).toBe(typed);
    }
  });

  it("khoảng thời gian giữ nguyên độ dài qua một vòng", () => {
    const start = parseVietnamDateTime("2026-09-20T08:00");
    const end = parseVietnamDateTime("2026-09-20T11:30");
    const minutes = (new Date(end!).getTime() - new Date(start!).getTime()) / 60_000;
    expect(minutes).toBe(210);
  });
});
