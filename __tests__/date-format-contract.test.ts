/**
 * Định dạng ngày tháng của toàn CRM.
 *
 * Không có ca test nào ghim định dạng này trước đây, và đó là lý do nó trôi:
 * `formatDate` cho ra `8/9/2026` (không đệm số 0), `formatDateTime` cho ra
 * `14:05 8/9/26` (giờ đứng trước, năm hai chữ số), và không cái nào ấn định
 * múi giờ — nên trên máy chủ UTC của Vercel, một sự kiện 1 giờ sáng giờ Việt
 * Nam hiện SAI NGÀY.
 *
 * Ba tính chất được khoá ở đây: đúng một hình dạng DD/MM/YYYY, đọc theo giờ
 * Việt Nam, và không màn hình nào tự định dạng ngày ngoài `lib/utils`.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatTime } from "@/lib/utils";

describe("formatDate — luôn là DD/MM/YYYY", () => {
  it("đệm số 0 cho cả ngày và tháng", () => {
    // Đây là ca đã sai suốt: `vi-VN` mặc định cho ra `2/1/2026`, và `1/2` với
    // `2/1` chỉ khác nhau ở thói quen người đọc.
    expect(formatDate("2026-01-02")).toBe("02/01/2026");
  });

  it("năm đủ bốn chữ số", () => {
    expect(formatDate("2026-12-25")).toBe("25/12/2026");
  });

  it("khớp đúng khuôn DD/MM/YYYY với mọi ngày trong năm", () => {
    for (let month = 0; month < 12; month += 1) {
      const value = new Date(Date.UTC(2026, month, month + 1, 5)).toISOString();
      expect(formatDate(value)).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    }
  });

  it("giữ nguyên ngày của một chuỗi chỉ có ngày", () => {
    // Cột kiểu `date` (ví dụ `event_participations.attendance_date`) về dưới
    // dạng "2026-09-08"; nó không được nhảy sang ngày khác vì đổi múi giờ.
    expect(formatDate("2026-09-08")).toBe("08/09/2026");
  });
});

describe("đọc theo giờ Việt Nam, không theo giờ máy chủ", () => {
  it("một thời điểm sau 17:00 UTC thuộc về NGÀY HÔM SAU ở Việt Nam", () => {
    // 18:00 UTC ngày 8/9 là 01:00 ngày 9/9 giờ Việt Nam. Bản cũ không ấn định
    // múi giờ nên trên Vercel (chạy UTC) nó hiện 8/9 — sai ngày, và sai đúng
    // vào những sự kiện buổi tối.
    expect(formatDate("2026-09-08T18:00:00Z")).toBe("09/09/2026");
    expect(formatTime("2026-09-08T18:00:00Z")).toBe("01:00");
  });

  it("một thời điểm trước 17:00 UTC vẫn là ngày hôm đó", () => {
    expect(formatDate("2026-09-08T09:00:00Z")).toBe("08/09/2026");
  });

  it("giữ nguyên giờ của một thời điểm đã ghi kèm offset +07:00", () => {
    expect(formatDateTime("2026-09-08T14:05:00+07:00")).toBe("08/09/2026 14:05");
  });
});

describe("formatTime — 24 giờ, HH:mm", () => {
  it("in nửa đêm là 00:00 chứ không phải 24:00", () => {
    // Ghim kết quả, không ghim cách làm: bản ICU của Node hiện tại cho `00:00`
    // với cả `hour12: false` lẫn `hourCycle: "h23"`, nên ca này không phân biệt
    // được hai lựa chọn đó — nó chỉ chặn ngày mà một bản ICU khác cho `24:00`.
    expect(formatTime("2026-09-08T00:00:00+07:00")).toBe("00:00");
  });

  it("đệm số 0 cho giờ một chữ số", () => {
    expect(formatTime("2026-09-08T07:05:00+07:00")).toBe("07:05");
  });

  it("dùng 24 giờ, không có SA/CH", () => {
    expect(formatTime("2026-09-08T20:30:00+07:00")).toBe("20:30");
  });
});

describe("formatDateTime — ngày trước, giờ sau", () => {
  it("cho ra đúng khuôn DD/MM/YYYY HH:mm", () => {
    expect(formatDateTime("2026-01-02T09:07:00+07:00")).toBe("02/01/2026 09:07");
  });

  it("mở đầu bằng ngày, không mở đầu bằng giờ", () => {
    // Bản cũ cho ra `14:05 8/9/26`: giờ đứng trước, năm hai chữ số.
    expect(formatDateTime("2026-09-08T14:05:00+07:00")).toMatch(/^\d{2}\/\d{2}\/\d{4} /);
  });

  it("phần ngày của nó bằng đúng formatDate", () => {
    const value = "2026-09-08T22:45:00+07:00";
    expect(formatDateTime(value).startsWith(formatDate(value))).toBe(true);
    expect(formatDateTime(value).endsWith(formatTime(value))).toBe(true);
  });
});

describe("giá trị rỗng và giá trị hỏng", () => {
  it("giá trị rỗng thành một dấu gạch", () => {
    for (const empty of [null, undefined, ""]) {
      expect(formatDate(empty)).toBe("-");
      expect(formatTime(empty)).toBe("-");
      expect(formatDateTime(empty)).toBe("-");
    }
  });

  it("chuỗi không đọc được thì trả nguyên xi, không giấu sau dấu gạch", () => {
    // Giấu nó đi là bỏ mất manh mối duy nhất để lần ra dữ liệu hỏng.
    expect(formatDate("chưa rõ")).toBe("chưa rõ");
    expect(formatDateTime("chưa rõ")).toBe("chưa rõ");
  });
});

describe("không màn hình nào tự định dạng ngày", () => {
  /** Mọi file .ts/.tsx dưới app/, lib/ và components/, trừ test. */
  function sourceFiles(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) sourceFiles(full, found);
      else if (/\.tsx?$/.test(entry)) found.push(full);
    }
    return found;
  }

  const ROOT = join(__dirname, "..");
  const files = ["app", "lib", "components"].flatMap((dir) => sourceFiles(join(ROOT, dir)));

  it("quét được một lượng file hợp lý", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("không nơi nào gọi toLocaleDateString hay toLocaleTimeString", () => {
    // Năm màn hình từng tự gọi `toLocaleDateString("vi-VN")` và vì thế nằm
    // ngoài mọi lần sửa định dạng. Cửa duy nhất là `lib/utils`.
    const offenders = files.filter((file) =>
      /\.toLocale(Date|Time)String\(/.test(readFileSync(file, "utf8"))
    );
    expect(offenders.map((file) => file.slice(ROOT.length + 1))).toEqual([]);
  });

  it("chỉ lib/utils.ts được dựng Intl.DateTimeFormat", () => {
    const offenders = files.filter(
      (file) =>
        /new Intl\.DateTimeFormat\(/.test(readFileSync(file, "utf8")) &&
        !file.endsWith(join("lib", "utils.ts")) &&
        !file.endsWith(join("lib", "dashboard-month.ts"))
    );
    expect(offenders.map((file) => file.slice(ROOT.length + 1))).toEqual([]);
  });
});
