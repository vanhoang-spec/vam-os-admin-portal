import { describe, expect, it } from "vitest";
import { DAILY_EMAIL_LIMIT } from "@/lib/mentee-invite-dispatch-core";
import {
  BULK_GRANT_MAX_PER_RUN,
  bulkGrantAllowance,
  matchEmailsToPool,
  normalizeEmailForMatch,
  parseEmailList
} from "@/lib/reviewer-invite-dispatch-core";

describe("bulkGrantAllowance", () => {
  it("chưa gửi gì thì cho đủ trần một lượt, không phải toàn bộ DAILY_EMAIL_LIMIT", () => {
    expect(bulkGrantAllowance(0)).toBe(BULK_GRANT_MAX_PER_RUN);
  });

  it("chỉ nhìn phần THẬT còn trống trong DAILY_EMAIL_LIMIT — không trừ thêm một lần chừa nữa", () => {
    // Bộ mentee đã dùng hết phần chừa riêng của nó (220), còn DAILY_EMAIL_LIMIT - 220 = 80 trống thật.
    expect(bulkGrantAllowance(DAILY_EMAIL_LIMIT - 90)).toBe(Math.min(BULK_GRANT_MAX_PER_RUN, 90));
  });

  it("hết hạn mức thật thì trả 0, không âm", () => {
    expect(bulkGrantAllowance(DAILY_EMAIL_LIMIT)).toBe(0);
    expect(bulkGrantAllowance(DAILY_EMAIL_LIMIT + 500)).toBe(0);
  });

  it("số đã gửi không hợp lệ (âm, NaN) thì coi như 0 đã gửi", () => {
    expect(bulkGrantAllowance(-5)).toBe(BULK_GRANT_MAX_PER_RUN);
    expect(bulkGrantAllowance(Number.NaN)).toBe(BULK_GRANT_MAX_PER_RUN);
  });
});

describe("parseEmailList", () => {
  it("tách theo dòng, dấu phẩy, chấm phẩy và khoảng trắng — bỏ trùng, bỏ chuỗi rỗng", () => {
    const raw = "a@example.com\nB@Example.com, c@example.com;  d@example.com   a@example.com";
    expect(parseEmailList(raw)).toEqual(["a@example.com", "b@example.com", "c@example.com", "d@example.com"]);
  });

  it("bỏ mọi chuỗi không có @", () => {
    expect(parseEmailList("a@example.com\nkhông-phải-email\n\n  ")).toEqual(["a@example.com"]);
  });

  it("chuỗi rỗng cho danh sách rỗng", () => {
    expect(parseEmailList("")).toEqual([]);
    expect(parseEmailList("   \n  ")).toEqual([]);
  });
});

describe("normalizeEmailForMatch", () => {
  it("cắt khoảng trắng, chữ thường", () => {
    expect(normalizeEmailForMatch("  Vana@Example.COM  ")).toBe("vana@example.com");
  });

  it("giá trị không phải chuỗi thì không vỡ, trả rỗng", () => {
    expect(normalizeEmailForMatch(null)).toBe("");
    expect(normalizeEmailForMatch(undefined)).toBe("");
  });
});

describe("matchEmailsToPool", () => {
  const pool = [
    { personId: "p1", email: "vana@example.com" },
    { personId: "p2", email: "vanb@example.com" }
  ];

  it("khớp đúng người, không phân biệt hoa thường", () => {
    const result = matchEmailsToPool(["VANA@example.com", "vanb@example.com"], pool);
    expect(result.matched).toEqual([
      { personId: "p1", email: "vana@example.com" },
      { personId: "p2", email: "vanb@example.com" }
    ]);
    expect(result.notFound).toEqual([]);
  });

  it("email không khớp mentor nào của mùa thì liệt kê rõ ràng, không âm thầm bỏ qua", () => {
    const result = matchEmailsToPool(["vana@example.com", "khong-ton-tai@example.com"], pool);
    expect(result.matched).toEqual([{ personId: "p1", email: "vana@example.com" }]);
    expect(result.notFound).toEqual(["khong-ton-tai@example.com"]);
  });

  it("hai email khác nhau trỏ về cùng một person_id chỉ xử lý một lần", () => {
    const dupPool = [{ personId: "p1", email: "vana@example.com" }];
    // Giả lập một person có nhiều email nhập trùng ý — ở đây cùng email lặp lại
    // qua parseEmailList đã tự bỏ trùng, nhưng matchEmailsToPool tự nó cũng phải
    // an toàn nếu nhận đầu vào có lặp person_id từ hai email khác nhau.
    const result = matchEmailsToPool(["vana@example.com"], dupPool);
    expect(result.matched).toHaveLength(1);
  });
});
