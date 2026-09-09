/**
 * Sinh các buổi của một chuỗi sự kiện.
 *
 * Cả file này chạy dưới TZ=UTC (xem vitest.config.ts) trong khi các buổi được
 * tính theo lịch Việt Nam — đúng như trên production. Một phép cộng ngày làm
 * trên giờ máy sẽ đỏ ở đây chứ không đỏ trên máy của người viết.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_OCCURRENCES,
  WEEKDAY_LABELS,
  describeRecurrence,
  generateOccurrences,
  isEndMode,
  isMonthlyMode,
  isRecurrenceFrequency,
  weekdayOf,
  weekdayOrdinalOf,
  type RecurrenceRule
} from "@/lib/event-recurrence";
import { formatDate, formatTime } from "@/lib/utils";

/** Thứ Ba 08/09/2026, 19:00 giờ Việt Nam. */
const TUESDAY_7PM = "2026-09-08T12:00:00Z";

function rule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return {
    frequency: "weekly",
    interval: 1,
    monthlyMode: "day_of_month",
    endMode: "after_count",
    count: 4,
    ...overrides
  };
}

function dates(result: ReturnType<typeof generateOccurrences>): string[] {
  if (!result.ok) throw new Error(`không sinh được: ${result.message}`);
  return result.occurrences.map((row) => formatDate(row.startsAt));
}

describe("mốc thời gian gốc", () => {
  it("đọc đúng thứ và tuần thứ mấy theo lịch Việt Nam", () => {
    // 19:00 giờ Việt Nam ngày 08/09 là 12:00 UTC cùng ngày. Nếu ai đó tính
    // theo giờ máy chủ UTC thì vẫn ra Thứ Ba — nên ca dưới mới là ca có răng.
    expect(weekdayOf(TUESDAY_7PM)).toBe(2);
    expect(WEEKDAY_LABELS[2]).toBe("Thứ Ba");
    expect(weekdayOrdinalOf(TUESDAY_7PM)).toBe(2);
  });

  it("một buổi tối muộn vẫn thuộc về ngày Việt Nam của nó", () => {
    // 20:00 ngày 08/09 giờ Việt Nam = 13:00 UTC. Nhưng 01:00 ngày 09/09 giờ
    // Việt Nam = 18:00 ngày 08/09 UTC — tính theo UTC sẽ ra Thứ Ba thay vì
    // Thứ Tư.
    expect(weekdayOf("2026-09-08T18:00:00Z")).toBe(3);
    expect(formatDate("2026-09-08T18:00:00Z")).toBe("09/09/2026");
  });
});

describe("hằng tuần", () => {
  it("sinh đúng số buổi, cách nhau bảy ngày", () => {
    expect(dates(generateOccurrences({ startsAt: TUESDAY_7PM, rule: rule() }))).toEqual([
      "08/09/2026",
      "15/09/2026",
      "22/09/2026",
      "29/09/2026"
    ]);
  });

  it("giữ nguyên giờ qua các buổi", () => {
    const result = generateOccurrences({ startsAt: TUESDAY_7PM, rule: rule() });
    if (!result.ok) throw new Error(result.message);
    for (const occurrence of result.occurrences) {
      expect(formatTime(occurrence.startsAt)).toBe("19:00");
    }
  });

  it("tuần cách tuần", () => {
    expect(
      dates(generateOccurrences({ startsAt: TUESDAY_7PM, rule: rule({ interval: 2, count: 3 }) }))
    ).toEqual(["08/09/2026", "22/09/2026", "06/10/2026"]);
  });

  it("vắt qua tháng và qua năm mà không lệch thứ", () => {
    const result = generateOccurrences({
      startsAt: "2026-12-29T12:00:00Z",
      rule: rule({ count: 3 })
    });
    expect(dates(result)).toEqual(["29/12/2026", "05/01/2027", "12/01/2027"]);
    if (!result.ok) throw new Error(result.message);
    for (const occurrence of result.occurrences) {
      expect(weekdayOf(occurrence.startsAt)).toBe(2);
    }
  });

  it("dừng đúng ngày kết thúc, và tính cả buổi trong chính ngày đó", () => {
    // Buổi 19:00 của ngày cuối vẫn thuộc về chuỗi: mốc dừng là hết ngày, không
    // phải nửa đêm đầu ngày.
    const result = generateOccurrences({
      startsAt: TUESDAY_7PM,
      rule: rule({ endMode: "on_date", endsOn: "2026-09-22", count: null })
    });
    expect(dates(result)).toEqual(["08/09/2026", "15/09/2026", "22/09/2026"]);
  });
});

describe("hằng tháng theo ngày trong tháng", () => {
  it("giữ nguyên ngày qua các tháng", () => {
    expect(
      dates(
        generateOccurrences({
          startsAt: "2026-09-08T12:00:00Z",
          rule: rule({ frequency: "monthly", count: 3 })
        })
      )
    ).toEqual(["08/09/2026", "08/10/2026", "08/11/2026"]);
  });

  it("BỎ QUA tháng không có ngày đó, không lùi về ngày cuối tháng", () => {
    // "Ngày 31 hằng tháng" không tồn tại trong tháng Hai, và tự ý dời sang 28
    // là đổi ngày của một buổi mà không ai yêu cầu.
    const result = generateOccurrences({
      startsAt: "2026-01-31T12:00:00Z",
      rule: rule({ frequency: "monthly", count: 4 })
    });
    expect(dates(result)).toEqual(["31/01/2026", "31/03/2026", "31/05/2026", "31/07/2026"]);
  });

  it("bỏ qua một tháng không làm trượt cả chuỗi sau đó", () => {
    // Đây là lý do vòng lặp đếm chu kỳ chứ không đếm số buổi đã sinh: dùng số
    // buổi thì sau mỗi tháng bị bỏ qua, toàn bộ phần còn lại lùi đi một tháng.
    const result = generateOccurrences({
      startsAt: "2026-01-30T12:00:00Z",
      rule: rule({ frequency: "monthly", count: 3 })
    });
    expect(dates(result)).toEqual(["30/01/2026", "30/03/2026", "30/04/2026"]);
  });
});

describe("hằng tháng theo thứ của tuần", () => {
  it("giữ nguyên 'Thứ Ba tuần thứ 2' qua các tháng", () => {
    const result = generateOccurrences({
      startsAt: TUESDAY_7PM,
      rule: rule({ frequency: "monthly", monthlyMode: "weekday_of_month", count: 4 })
    });
    expect(dates(result)).toEqual(["08/09/2026", "13/10/2026", "10/11/2026", "08/12/2026"]);
    if (!result.ok) throw new Error(result.message);
    for (const occurrence of result.occurrences) {
      expect(weekdayOf(occurrence.startsAt)).toBe(2);
      expect(weekdayOrdinalOf(occurrence.startsAt)).toBe(2);
    }
  });

  it("bỏ qua tháng không có lần thứ 5 của thứ đó", () => {
    // 29/09/2026 là Thứ Ba thứ 5 của tháng Chín; hầu hết các tháng không có.
    const result = generateOccurrences({
      startsAt: "2026-09-29T12:00:00Z",
      rule: rule({ frequency: "monthly", monthlyMode: "weekday_of_month", count: 3 })
    });
    if (!result.ok) throw new Error(result.message);
    for (const occurrence of result.occurrences) {
      expect(weekdayOrdinalOf(occurrence.startsAt)).toBe(5);
      expect(weekdayOf(occurrence.startsAt)).toBe(2);
    }
  });
});

describe("độ dài buổi", () => {
  it("giữ nguyên qua các lần lặp", () => {
    const result = generateOccurrences({
      startsAt: TUESDAY_7PM,
      endsAt: "2026-09-08T14:00:00Z",
      rule: rule({ count: 3 })
    });
    if (!result.ok) throw new Error(result.message);
    for (const occurrence of result.occurrences) {
      expect(occurrence.endsAt).not.toBeNull();
      const minutes =
        (new Date(occurrence.endsAt!).getTime() - new Date(occurrence.startsAt).getTime()) / 60_000;
      expect(minutes).toBe(120);
    }
  });

  it("không có giờ kết thúc thì mọi buổi cũng không có", () => {
    const result = generateOccurrences({ startsAt: TUESDAY_7PM, rule: rule({ count: 2 }) });
    if (!result.ok) throw new Error(result.message);
    expect(result.occurrences.every((row) => row.endsAt === null)).toBe(true);
  });

  it("từ chối giờ kết thúc trước giờ bắt đầu", () => {
    const result = generateOccurrences({
      startsAt: TUESDAY_7PM,
      endsAt: "2026-09-08T10:00:00Z",
      rule: rule()
    });
    expect(result.ok).toBe(false);
  });
});

describe("trần số buổi", () => {
  it("cắt ở trần và nói rằng đã cắt", () => {
    // Một lỗi gõ — "kết thúc năm 2036" — không được tạo ra sáu trăm sự kiện mà
    // ai đó phải xoá tay từng cái.
    const result = generateOccurrences({
      startsAt: TUESDAY_7PM,
      rule: rule({ endMode: "on_date", endsOn: "2036-01-01", count: null })
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.occurrences).toHaveLength(MAX_OCCURRENCES);
    expect(result.capped).toBe(true);
  });

  it("xin nhiều hơn trần thì cũng chỉ được tới trần", () => {
    const result = generateOccurrences({
      startsAt: TUESDAY_7PM,
      rule: rule({ count: MAX_OCCURRENCES + 30 })
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.occurrences).toHaveLength(MAX_OCCURRENCES);
    expect(result.capped).toBe(true);
  });

  it("chuỗi vừa đủ thì không bị đánh dấu là đã cắt", () => {
    const result = generateOccurrences({ startsAt: TUESDAY_7PM, rule: rule({ count: 4 }) });
    if (!result.ok) throw new Error(result.message);
    expect(result.capped).toBe(false);
  });
});

describe("từ chối quy tắc vô lý", () => {
  it("khoảng lặp phải từ 1 trở lên", () => {
    for (const interval of [0, -1, 1.5]) {
      expect(generateOccurrences({ startsAt: TUESDAY_7PM, rule: rule({ interval }) }).ok).toBe(
        false
      );
    }
  });

  it("khoảng lặp có trần", () => {
    expect(generateOccurrences({ startsAt: TUESDAY_7PM, rule: rule({ interval: 13 }) }).ok).toBe(
      false
    );
  });

  it("số buổi phải từ 1 trở lên", () => {
    expect(generateOccurrences({ startsAt: TUESDAY_7PM, rule: rule({ count: 0 }) }).ok).toBe(false);
  });

  it("ngày kết thúc phải đọc được và phải sau buổi đầu", () => {
    const bad = generateOccurrences({
      startsAt: TUESDAY_7PM,
      rule: rule({ endMode: "on_date", endsOn: "hôm nào đó", count: null })
    });
    expect(bad.ok).toBe(false);

    const early = generateOccurrences({
      startsAt: TUESDAY_7PM,
      rule: rule({ endMode: "on_date", endsOn: "2026-08-01", count: null })
    });
    expect(early.ok).toBe(false);
  });

  it("thời điểm bắt đầu không hợp lệ", () => {
    expect(generateOccurrences({ startsAt: "hôm nào đó", rule: rule() }).ok).toBe(false);
  });

  it("một buổi duy nhất vẫn là chuỗi hợp lệ", () => {
    // Buổi đầu luôn nằm trong kết quả: người dùng đã gõ ngày giờ đó, và một
    // chuỗi rỗng trông như hệ thống nuốt mất thao tác của họ.
    const result = generateOccurrences({ startsAt: TUESDAY_7PM, rule: rule({ count: 1 }) });
    if (!result.ok) throw new Error(result.message);
    expect(result.occurrences).toHaveLength(1);
  });
});

describe("describeRecurrence", () => {
  it("nói đúng thứ cho chuỗi hằng tuần", () => {
    expect(describeRecurrence({ startsAt: TUESDAY_7PM, rule: rule(), total: 4 })).toBe(
      "Lặp mỗi tuần vào Thứ Ba — 4 buổi."
    );
  });

  it("nói rõ khoảng cách khi lớn hơn một", () => {
    expect(
      describeRecurrence({ startsAt: TUESDAY_7PM, rule: rule({ interval: 2 }), total: 3 })
    ).toContain("mỗi 2 tuần");
  });

  it("nói ngày trong tháng cho chế độ theo ngày", () => {
    expect(
      describeRecurrence({
        startsAt: TUESDAY_7PM,
        rule: rule({ frequency: "monthly" }),
        total: 3
      })
    ).toContain("ngày 8");
  });

  it("nói thứ và tuần thứ mấy cho chế độ theo thứ", () => {
    expect(
      describeRecurrence({
        startsAt: TUESDAY_7PM,
        rule: rule({ frequency: "monthly", monthlyMode: "weekday_of_month" }),
        total: 3
      })
    ).toContain("Thứ Ba tuần thứ 2");
  });
});

describe("nhận dạng giá trị", () => {
  it("chỉ nhận đúng các giá trị đã khai báo", () => {
    expect(isRecurrenceFrequency("weekly")).toBe(true);
    expect(isRecurrenceFrequency("daily")).toBe(false);
    expect(isMonthlyMode("weekday_of_month")).toBe(true);
    expect(isMonthlyMode("last_day")).toBe(false);
    expect(isEndMode("on_date")).toBe(true);
    expect(isEndMode("never")).toBe(false);
  });
});
