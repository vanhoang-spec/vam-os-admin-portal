/**
 * Từ vựng và bộ lọc của sổ thư đi.
 *
 * Phân loại: DIRECT PRODUCTION TESTS.
 */
import { describe, expect, it } from "vitest";
import {
  CONFIRMATION_KIND_BY_ROLE,
  INTERVIEW_ROUND_INVITE_KIND,
  MAIN_OUTBOUND_EMAIL_KINDS,
  confirmationKindForRole,
  isOutboundEmailStatus,
  outboundEmailKindLabel,
  outboundEmailQueryString,
  outboundEmailStatusLabel,
  parseOutboundEmailFilters,
  sanitizeIlikeTerm
} from "@/lib/outbound-emails-core";

describe("confirmationKindForRole", () => {
  it("ánh xạ đúng hai vai trò", () => {
    expect(confirmationKindForRole("mentor")).toBe("mentor_application_confirmation");
    expect(confirmationKindForRole("mentee")).toBe("mentee_application_confirmation");
  });

  it("trả null cho mọi thứ khác thay vì đoán", () => {
    for (const value of ["", "  ", "observer", "MENTOR", null, undefined, 7]) {
      expect(confirmationKindForRole(value)).toBeNull();
    }
  });

  it("danh sách loại thư main phát ra đúng bằng những gì có người gọi", () => {
    expect([...MAIN_OUTBOUND_EMAIL_KINDS].sort()).toEqual(
      [
        CONFIRMATION_KIND_BY_ROLE.mentee,
        CONFIRMATION_KIND_BY_ROLE.mentor,
        INTERVIEW_ROUND_INVITE_KIND
      ].sort()
    );
  });

  it("thư mời vòng phỏng vấn KHÁC thư báo lịch đã xếp", () => {
    // 'interview_scheduled' là thư của một buổi đã có giờ — nghĩa của nó trên
    // nhánh s12. Main chưa lưu giờ phỏng vấn ở đâu cả, nên lá thư gửi lúc vào
    // vòng là một loại riêng. Dùng chung mã sẽ làm sổ ghi nói dối.
    expect(INTERVIEW_ROUND_INVITE_KIND).not.toBe("interview_scheduled");
    expect(MAIN_OUTBOUND_EMAIL_KINDS as readonly string[]).not.toContain("interview_scheduled");
  });
});

describe("nhãn", () => {
  it("dịch trạng thái sang tiếng Việt", () => {
    expect(outboundEmailStatusLabel("sent")).toBe("Đã gửi");
    expect(outboundEmailStatusLabel("skipped")).toBe("Bỏ qua");
    expect(outboundEmailStatusLabel("queued")).toBe("Đang chờ");
    expect(outboundEmailStatusLabel("failed")).toBe("Lỗi");
  });

  it("giá trị lạ được giữ nguyên chứ không bị giấu đi", () => {
    expect(outboundEmailStatusLabel("bizarre")).toBe("bizarre");
    expect(outboundEmailKindLabel("kickoff_invite")).toBe("kickoff_invite");
  });

  it("trống thì hiện gạch ngang", () => {
    expect(outboundEmailStatusLabel(null)).toBe("-");
    expect(outboundEmailKindLabel(undefined)).toBe("-");
  });

  it("isOutboundEmailStatus chỉ nhận đúng bốn giá trị", () => {
    expect(isOutboundEmailStatus("sent")).toBe(true);
    expect(isOutboundEmailStatus("Sent")).toBe(false);
    expect(isOutboundEmailStatus("pending")).toBe(false);
  });
});

describe("sanitizeIlikeTerm", () => {
  it("bỏ ký tự dành riêng của cú pháp lọc PostgREST", () => {
    expect(sanitizeIlikeTerm(`a,b(c)d"e'f`)).toBe("a b c d e f");
  });

  it("bỏ ký tự đại diện SQL để không ai tự mở rộng tìm kiếm", () => {
    expect(sanitizeIlikeTerm("%_%")).toBe("");
    expect(sanitizeIlikeTerm("an%h")).toBe("an h");
  });

  it("gộp khoảng trắng và cắt hai đầu", () => {
    expect(sanitizeIlikeTerm("   a    b   ")).toBe("a b");
  });
});

describe("parseOutboundEmailFilters", () => {
  it("đọc được bộ lọc hợp lệ", () => {
    expect(
      parseOutboundEmailFilters({
        status: "failed",
        kind: "mentee_application_confirmation",
        q: "an@example.com",
        page: "3"
      })
    ).toEqual({
      status: "failed",
      kind: "mentee_application_confirmation",
      q: "an@example.com",
      page: 3
    });
  });

  it("giá trị lạ bị bỏ chứ không làm hỏng trang", () => {
    const filters = parseOutboundEmailFilters({
      status: "exploded",
      kind: "kickoff_invite",
      page: "-4"
    });

    expect(filters.status).toBeNull();
    // kickoff_invite là loại thư có thật ở giai đoạn chưa merge, nhưng main
    // không phát ra nó, nên bộ lọc không được chào.
    expect(filters.kind).toBeNull();
    expect(filters.page).toBe(1);
  });

  it("không có tham số nào thì trả về bộ lọc rỗng, trang 1", () => {
    expect(parseOutboundEmailFilters(undefined)).toEqual({
      status: null,
      kind: null,
      q: "",
      page: 1
    });
  });

  it("mảng tham số lấy phần tử đầu", () => {
    expect(parseOutboundEmailFilters({ status: ["sent", "failed"] }).status).toBe("sent");
  });

  it("chuỗi tìm kiếm được làm sạch ngay lúc đọc", () => {
    expect(parseOutboundEmailFilters({ q: "a%b'c" }).q).toBe("a b c");
  });
});

describe("outboundEmailQueryString", () => {
  it("giữ nguyên bộ lọc khi sang trang", () => {
    const qs = outboundEmailQueryString(
      { status: "sent", kind: "mentor_application_confirmation", q: "an", page: 1 },
      2
    );

    expect(qs).toContain("status=sent");
    expect(qs).toContain("kind=mentor_application_confirmation");
    expect(qs).toContain("q=an");
    expect(qs).toContain("page=2");
  });

  it("trang 1 không cần tham số page", () => {
    expect(outboundEmailQueryString({ status: null, kind: null, q: "", page: 2 }, 1)).toBe("");
  });
});
