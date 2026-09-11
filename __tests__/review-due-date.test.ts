/**
 * Hạn hoàn tất chấm hồ sơ — phép đọc duy nhất, dùng chung cho màn hình và máy chủ.
 */
import { describe, expect, it } from "vitest";
import { parseReviewDueDate, reviewDueInputProblem } from "@/lib/review-due";

// 10:00 sáng 11/09/2026 giờ Việt Nam.
const NOW = new Date("2026-09-11T03:00:00.000Z");

describe("hạn là hết ngày theo giờ Việt Nam", () => {
  it("lưu thành 23:59:59 +07:00 của đúng ngày đó", () => {
    expect(parseReviewDueDate("2026-09-20", NOW)).toEqual({
      ok: true,
      dueAt: "2026-09-20T16:59:59.000Z"
    });
  });

  it("không phụ thuộc múi giờ của máy chủ", () => {
    // vitest.config đặt TZ=UTC như production. Một hàm đọc ngày theo giờ máy
    // sẽ cho ra 2026-09-20T23:59:59.000Z ở đây — trễ bảy tiếng.
    expect(process.env.TZ).toBe("UTC");
    const parsed = parseReviewDueDate("2026-09-20", NOW);
    expect(parsed.ok && parsed.dueAt).toBe("2026-09-20T16:59:59.000Z");
  });

  it("KHÔNG phải nửa đêm UTC — lối cũ làm người chấm trễ hạn từ 7 giờ sáng", () => {
    const parsed = parseReviewDueDate("2026-09-20", NOW);
    expect(parsed.ok && parsed.dueAt).not.toBe("2026-09-20T00:00:00.000Z");
  });

  it("hôm nay vẫn đặt được, tới tận giây cuối của ngày", () => {
    expect(parseReviewDueDate("2026-09-11", NOW).ok).toBe(true);
    // 23:59:58 ngày 11/09 giờ Việt Nam.
    expect(parseReviewDueDate("2026-09-11", new Date("2026-09-11T16:59:58.000Z")).ok).toBe(true);
  });

  it("qua nửa đêm Việt Nam thì ngày đó đã qua — dù ở UTC vẫn còn là ngày ấy", () => {
    // 00:00:01 ngày 12/09 giờ Việt Nam = 17:00:01 ngày 11/09 UTC.
    expect(parseReviewDueDate("2026-09-11", new Date("2026-09-11T17:00:01.000Z")).ok).toBe(false);
  });
});

describe("rỗng là không đặt hạn", () => {
  for (const raw of ["", "   ", null, undefined]) {
    it(`${JSON.stringify(raw)} → không hạn`, () => {
      expect(parseReviewDueDate(raw, NOW)).toEqual({ ok: true, dueAt: null });
    });
  }
});

describe("không đọc được thì từ chối, không coi như bỏ trống", () => {
  const unreadable = [
    "20/09/2026",
    "2026-9-20",
    "2026-02-31",
    "2026-13-01",
    "2026-00-10",
    "2026-09-00",
    "hôm nay",
    // Có giờ thì từ chối, không cắt bớt: giờ người ta chọn không được lặng lẽ
    // biến thành 23:59.
    "2026-09-20T08:00",
    "2026-09-20T23:59:59+07:00"
  ];

  for (const raw of unreadable) {
    it(`"${raw}"`, () => {
      const parsed = parseReviewDueDate(raw, NOW);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.message).toMatch(/ngày\/tháng\/năm/);
    });
  }
});

describe("hạn vô lý là gõ nhầm", () => {
  it("hôm qua bị từ chối", () => {
    const parsed = parseReviewDueDate("2026-09-10", NOW);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/đã qua/);
  });

  it("xa hơn một năm bị từ chối", () => {
    const parsed = parseReviewDueDate("2027-09-20", NOW);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/một năm/);
  });

  it("gần tròn một năm vẫn đặt được", () => {
    expect(parseReviewDueDate("2027-09-10", NOW).ok).toBe(true);
  });
});

describe("lời nhắc dưới ô hạn trên màn hình", () => {
  it("ô trống: không nhắc", () => {
    expect(reviewDueInputProblem("", "", NOW)).toBeNull();
  });

  it("gõ dở: nhắc — máy chủ sẽ nhận chuỗi rỗng và giao đi không hạn", () => {
    expect(reviewDueInputProblem("20/09/20", "", NOW)).toMatch(/Gõ đủ ngày\/tháng\/năm/);
  });

  it("ngày đã qua: nhắc đúng lời máy chủ sẽ trả về", () => {
    const server = parseReviewDueDate("2026-09-10", NOW);
    expect(server.ok).toBe(false);
    expect(reviewDueInputProblem("10/09/2026", "2026-09-10", NOW)).toBe(
      server.ok ? null : server.message
    );
  });

  it("ngày hợp lệ: không nhắc", () => {
    expect(reviewDueInputProblem("20/09/2026", "2026-09-20", NOW)).toBeNull();
  });
});
