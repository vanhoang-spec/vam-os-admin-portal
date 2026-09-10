/**
 * Người vừa đăng nhập bằng email này là ai?
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO ĐÂY LÀ CA TEST ĐÁNG VIẾT KỸ NHẤT CỦA CẢ LÁT CẮT
 * ---------------------------------------------------------------------------
 * Tài khoản đăng nhập và hồ sơ trong danh bạ là hai thứ tách rời. Nối sai một
 * lần là một người mở ra và thấy dữ liệu của người khác — thông tin liên lạc,
 * đơn ứng tuyển, ghi chú của ban tổ chức về họ. Không có thông báo lỗi nào,
 * không có dòng log nào; chỉ có một người đọc hồ sơ của một người khác và
 * tưởng đó là của mình.
 *
 * Nên phép quyết định được tách ra thành một hàm thuần, và ở đây nó bị thử với
 * mọi hình dạng dữ liệu bẩn nghĩ ra được.
 */
import { describe, expect, it } from "vitest";
import {
  decideIdentity,
  identityRefusalMessage,
  needsOperatorAttention,
  normalizeLoginEmail,
  type IdentityDecision
} from "@/lib/participant-auth-core";

const AN = { id: "person-an", emailPrimary: "an@example.com" };
const BINH = { id: "person-binh", emailPrimary: "binh@example.com" };

describe("khớp đúng một người thì nối", () => {
  it("email khớp chính xác", () => {
    expect(
      decideIdentity({ authEmail: "an@example.com", linkedPersonId: null, candidates: [AN, BINH] })
    ).toEqual({ kind: "link_now", personId: "person-an" });
  });

  it("khác nhau mỗi chữ hoa thường vẫn là một người", () => {
    // Email không phân biệt hoa thường. Người ta gõ AN@Example.COM vào ô đăng
    // nhập và vẫn phải là chính họ.
    expect(
      decideIdentity({
        authEmail: "AN@Example.COM",
        linkedPersonId: null,
        candidates: [{ id: "person-an", emailPrimary: "an@EXAMPLE.com" }]
      })
    ).toEqual({ kind: "link_now", personId: "person-an" });
  });

  it("khoảng trắng thừa hai đầu không tính", () => {
    expect(
      decideIdentity({
        authEmail: "  an@example.com  ",
        linkedPersonId: null,
        candidates: [{ id: "person-an", emailPrimary: " an@example.com" }]
      })
    ).toEqual({ kind: "link_now", personId: "person-an" });
  });
});

describe("KHÔNG ĐOÁN khi không chắc", () => {
  it("hai người cùng email thì từ chối, không lấy người đầu", () => {
    // Đây là ca quan trọng nhất trong cả file. Lấy `matches[0]` sẽ đúng chín
    // lần rồi lần thứ mười cho người ta xem nhầm hồ sơ — và chín lần đúng kia
    // không ai ghi nhận, còn lần sai thì không sửa lại được.
    const decision = decideIdentity({
      authEmail: "chung@example.com",
      linkedPersonId: null,
      candidates: [
        { id: "person-a", emailPrimary: "chung@example.com" },
        { id: "person-b", emailPrimary: "CHUNG@example.com" }
      ]
    });

    expect(decision.kind).toBe("ambiguous");
    expect(decision).not.toHaveProperty("personId");
    if (decision.kind === "ambiguous") {
      expect(decision.personIds.sort()).toEqual(["person-a", "person-b"]);
    }
  });

  it("ba người cùng email cũng vậy", () => {
    const decision = decideIdentity({
      authEmail: "chung@example.com",
      linkedPersonId: null,
      candidates: [
        { id: "a", emailPrimary: "chung@example.com" },
        { id: "b", emailPrimary: "chung@example.com" },
        { id: "c", emailPrimary: "chung@example.com" }
      ]
    });
    expect(decision.kind).toBe("ambiguous");
  });

  it("không khớp ai thì từ chối", () => {
    expect(
      decideIdentity({ authEmail: "la@example.com", linkedPersonId: null, candidates: [AN, BINH] })
    ).toEqual({ kind: "no_match" });
  });

  it("danh bạ rỗng thì từ chối", () => {
    expect(
      decideIdentity({ authEmail: "an@example.com", linkedPersonId: null, candidates: [] })
    ).toEqual({ kind: "no_match" });
  });
});

describe("email rỗng không bao giờ khớp ai", () => {
  it("tài khoản không có email", () => {
    expect(
      decideIdentity({ authEmail: null, linkedPersonId: null, candidates: [AN] })
    ).toEqual({ kind: "no_email" });
  });

  it("email toàn khoảng trắng cũng vậy", () => {
    expect(
      decideIdentity({ authEmail: "   ", linkedPersonId: null, candidates: [AN] })
    ).toEqual({ kind: "no_email" });
  });

  it("người trong danh bạ THIẾU email không khớp với ai", () => {
    // Nếu chuẩn hoá cẩu thả, một email rỗng bên này sẽ khớp một email rỗng bên
    // kia — và mọi người thiếu email trong danh bạ trở thành cùng một người.
    for (const empty of [null, "", "   "]) {
      const decision = decideIdentity({
        authEmail: "an@example.com",
        linkedPersonId: null,
        candidates: [
          { id: "khong-email-1", emailPrimary: empty },
          { id: "khong-email-2", emailPrimary: empty }
        ]
      });
      expect(decision, String(empty)).toEqual({ kind: "no_match" });
    }
  });
});

describe("mối nối đã có thì thắng", () => {
  it("có mối nối thì KHÔNG dò email nữa", () => {
    // Ai đó sửa email trong danh bạ không được phép làm người đang đăng nhập
    // biến thành một người khác.
    expect(
      decideIdentity({
        authEmail: "an@example.com",
        linkedPersonId: "person-cu",
        candidates: [AN, BINH]
      })
    ).toEqual({ kind: "linked", personId: "person-cu" });
  });

  it("có mối nối thì email nhập nhằng cũng không cản", () => {
    expect(
      decideIdentity({
        authEmail: "chung@example.com",
        linkedPersonId: "person-cu",
        candidates: [
          { id: "a", emailPrimary: "chung@example.com" },
          { id: "b", emailPrimary: "chung@example.com" }
        ]
      })
    ).toEqual({ kind: "linked", personId: "person-cu" });
  });

  it("có mối nối nhưng tài khoản không còn email vẫn vào được", () => {
    expect(
      decideIdentity({ authEmail: null, linkedPersonId: "person-cu", candidates: [] })
    ).toEqual({ kind: "linked", personId: "person-cu" });
  });

  it("chuỗi rỗng không tính là có mối nối", () => {
    expect(
      decideIdentity({ authEmail: "an@example.com", linkedPersonId: "  ", candidates: [AN] })
    ).toEqual({ kind: "link_now", personId: "person-an" });
  });
});

describe("lời báo cho người bị chặn", () => {
  it("nhận ra được thì không báo gì", () => {
    expect(identityRefusalMessage({ kind: "linked", personId: "x" })).toBeNull();
    expect(identityRefusalMessage({ kind: "link_now", personId: "x" })).toBeNull();
  });

  it("KHÔNG tiết lộ chuyện của người khác", () => {
    // "Email của bạn khớp với hai người" là một câu kể chuyện người khác cho
    // một người chưa chứng minh được mình là ai. Hai trường hợp bị chặn phải
    // nói y hệt nhau.
    const ambiguous = identityRefusalMessage({ kind: "ambiguous", personIds: ["a", "b"] });
    const noMatch = identityRefusalMessage({ kind: "no_match" });

    expect(ambiguous).toBe(noMatch);
    expect(ambiguous).not.toMatch(/hai|2|trùng|nhiều/i);
  });

  it("mọi lời báo đều chỉ được đường đi tiếp", () => {
    const refused: IdentityDecision[] = [
      { kind: "no_match" },
      { kind: "ambiguous", personIds: ["a", "b"] },
      { kind: "no_email" }
    ];
    for (const decision of refused) {
      expect(identityRefusalMessage(decision), decision.kind).toContain("ban tổ chức");
    }
  });
});

describe("việc nào cần ban tổ chức xử lý", () => {
  it("email trùng là dữ liệu cần dọn", () => {
    expect(needsOperatorAttention({ kind: "ambiguous", personIds: ["a", "b"] })).toBe(true);
  });

  it("không khớp ai thì thường chỉ là chưa có trong danh bạ", () => {
    expect(needsOperatorAttention({ kind: "no_match" })).toBe(false);
  });

  it("nhận ra được thì không có việc gì", () => {
    expect(needsOperatorAttention({ kind: "linked", personId: "x" })).toBe(false);
    expect(needsOperatorAttention({ kind: "link_now", personId: "x" })).toBe(false);
  });
});

describe("normalizeLoginEmail", () => {
  it("bỏ khoảng trắng và hạ chữ thường", () => {
    expect(normalizeLoginEmail("  AN@Example.COM ")).toBe("an@example.com");
  });

  it("rỗng, null, undefined đều ra chuỗi rỗng", () => {
    for (const value of [null, undefined, "", "   ", "\t\n"]) {
      expect(normalizeLoginEmail(value), String(value)).toBe("");
    }
  });
});
