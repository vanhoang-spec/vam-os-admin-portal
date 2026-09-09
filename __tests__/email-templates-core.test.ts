/**
 * Kho mẫu thư — phần lõi thuần.
 *
 * Hai tính chất được khoá ở đây vì hỏng chúng là gửi sai thư cho người thật:
 * ô lạ không bao giờ lưu được, và ô rỗng không bao giờ gửi đi được.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_BODY_LENGTH,
  MAX_NAME_LENGTH,
  MAX_SUBJECT_LENGTH,
  TEMPLATE_KINDS,
  TEMPLATE_SPECS,
  extractPlaceholders,
  isTemplateKind,
  isTemplateStatus,
  placeholderToken,
  renderTemplate,
  sampleValues,
  validateTemplate
} from "@/lib/email-templates-core";

/** Một mẫu thư hợp lệ, để mỗi ca test chỉ đổi đúng thứ nó đang xét. */
const VALID = {
  kind: "general_announcement" as const,
  name: "Nhắc hạn nộp hồ sơ đợt 1",
  subject: "Thông báo {{mua}}",
  body: "Chào {{ten_nguoi_nhan}},\n\nBan tổ chức xin thông báo lịch mới của {{mua}}."
};

describe("TEMPLATE_SPECS", () => {
  it("khai báo đủ mọi loại thư trong TEMPLATE_KINDS", () => {
    for (const kind of TEMPLATE_KINDS) {
      expect(TEMPLATE_SPECS[kind]?.kind).toBe(kind);
      expect(TEMPLATE_SPECS[kind].placeholders.length).toBeGreaterThan(0);
    }
    expect(Object.keys(TEMPLATE_SPECS).sort()).toEqual([...TEMPLATE_KINDS].sort());
  });

  it("mọi ô điền đều có nhãn tiếng Việt, câu giải thích và giá trị mẫu", () => {
    // Thiếu một trong ba thứ này thì nút chèn ô trên giao diện hiện ra trống.
    for (const spec of Object.values(TEMPLATE_SPECS)) {
      for (const placeholder of spec.placeholders) {
        expect(placeholder.key).toMatch(/^[a-z0-9_]{1,40}$/);
        expect(placeholder.label.trim()).not.toBe("");
        expect(placeholder.hint.trim()).not.toBe("");
        expect(placeholder.sample.trim()).not.toBe("");
      }
    }
  });

  it("không ô nào trong danh mục là dữ liệu nhạy cảm của một người", () => {
    // Danh mục là danh sách đóng chính vì lý do này. Ca test đứng chắn đường
    // một lần "thêm cho tiện" trong tương lai: số điện thoại, ngày sinh, địa
    // chỉ, mã số sinh viên không thuộc về một thư gửi hàng loạt.
    const forbidden = /(dien_thoai|phone|sdt|ngay_sinh|dia_chi|cccd|cmnd|mssv|email)/;
    for (const spec of Object.values(TEMPLATE_SPECS)) {
      for (const placeholder of spec.placeholders) {
        expect(placeholder.key).not.toMatch(forbidden);
      }
    }
  });

  it("thông báo chung gửi được cho cả hai phía", () => {
    expect(TEMPLATE_SPECS.general_announcement.audience).toBe("both");
  });
});

describe("extractPlaceholders", () => {
  it("tìm mỗi ô đúng một lần, theo thứ tự xuất hiện", () => {
    expect(extractPlaceholders("{{b}} rồi {{a}} rồi {{b}} lần nữa")).toEqual(["b", "a"]);
  });

  it("chấp nhận khoảng trắng bên trong ngoặc", () => {
    expect(extractPlaceholders("{{  ten_nguoi_nhan  }}")).toEqual(["ten_nguoi_nhan"]);
  });

  it("không tìm thấy gì trong đoạn văn không có ô nào", () => {
    expect(extractPlaceholders("Chào anh chị")).toEqual([]);
  });

  it("bỏ qua thứ chỉ trông giống ô điền", () => {
    expect(extractPlaceholders("{ten}")).toEqual([]);
    expect(extractPlaceholders("{{Ten_Hoa}}")).toEqual([]);
    expect(extractPlaceholders("{{ten-co-gach}}")).toEqual([]);
    expect(extractPlaceholders("{{}}")).toEqual([]);
  });
});

describe("validateTemplate", () => {
  it("nhận một mẫu thư chỉ dùng ô có trong danh mục", () => {
    const result = validateTemplate(VALID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings).toEqual([]);
  });

  it("từ chối ô mà không gì điền được", () => {
    const result = validateTemplate({ ...VALID, body: "Chào {{ten_that}} nhé" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("{{ten_that}}");
  });

  it("bắt được ô lạ nằm trong tiêu đề, không chỉ trong thân thư", () => {
    const result = validateTemplate({ ...VALID, subject: "Gửi {{ten_truong}}" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("{{ten_truong}}");
  });

  it("nhắc — nhưng vẫn cho lưu — khi thiếu một ô nên dùng", () => {
    const result = validateTemplate({ ...VALID, body: "Ban tổ chức xin thông báo {{mua}}." });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("ten_nguoi_nhan");
    }
  });

  it("không nhắc về ô không bắt buộc", () => {
    // `vai_tro` khai báo required: false, nên vắng mặt nó là im lặng.
    const result = validateTemplate(VALID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings.join(" ")).not.toContain("vai_tro");
  });

  it("bắt buộc có tên mẫu, tiêu đề và nội dung", () => {
    expect(validateTemplate({ ...VALID, name: "  " }).ok).toBe(false);
    expect(validateTemplate({ ...VALID, subject: "" }).ok).toBe(false);
    expect(validateTemplate({ ...VALID, body: "\n\n" }).ok).toBe(false);
  });

  it("giới hạn độ dài cả ba", () => {
    expect(validateTemplate({ ...VALID, name: "x".repeat(MAX_NAME_LENGTH + 1) }).ok).toBe(false);
    expect(validateTemplate({ ...VALID, subject: "x".repeat(MAX_SUBJECT_LENGTH + 1) }).ok).toBe(false);
    expect(validateTemplate({ ...VALID, body: "x".repeat(MAX_BODY_LENGTH + 1) }).ok).toBe(false);
  });

  it("giữ tiêu đề trên một dòng", () => {
    const result = validateTemplate({ ...VALID, subject: "Dòng một\nDòng hai" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.subject).toBe("Dòng một Dòng hai");
  });

  it("từ chối thẻ HTML trong thân thư", () => {
    // Mẫu thư là văn bản thuần; phần HTML do lib/email-core.ts dựng và escape.
    // Cho gõ thẻ vào đây là mở đường chèn đánh dấu vào hộp thư hàng trăm người.
    const result = validateTemplate({
      ...VALID,
      body: 'Chào {{ten_nguoi_nhan}}, xem <a href="http://kia.example">tại đây</a>.'
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("văn bản thuần");
  });

  it("từ chối thẻ HTML trong tiêu đề luôn", () => {
    expect(validateTemplate({ ...VALID, subject: "<b>Khẩn</b>" }).ok).toBe(false);
  });

  it("từ chối loại thư không có trong danh mục", () => {
    const result = validateTemplate({ ...VALID, kind: "khong_co_that" as never });
    expect(result.ok).toBe(false);
  });
});

describe("renderTemplate", () => {
  it("điền các ô", () => {
    const result = renderTemplate({
      kind: "general_announcement",
      subject: "Thông báo {{mua}}",
      body: "Chào {{ten_nguoi_nhan}}.",
      values: { mua: "UEHM-S12", ten_nguoi_nhan: "Nguyễn Văn A" }
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.subject).toBe("Thông báo UEHM-S12");
      expect(result.body).toBe("Chào Nguyễn Văn A.");
    }
  });

  it("từ chối gửi bức thư còn thiếu giá trị", () => {
    const result = renderTemplate({
      kind: "general_announcement",
      subject: "Thông báo {{mua}}",
      body: "Chào {{ten_nguoi_nhan}}.",
      values: { mua: "UEHM-S12" }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toEqual(["ten_nguoi_nhan"]);
      expect(result.message).toContain("{{ten_nguoi_nhan}}");
    }
  });

  it("không bao giờ để ô điền lọt vào thư gửi đi", () => {
    // Đây là hợp đồng quan trọng nhất của module: kết quả ok tuyệt đối không
    // còn dấu {{ }} nào, dù mẫu thư viết thế nào.
    const result = renderTemplate({
      kind: "general_announcement",
      subject: "{{mua}}",
      body: "{{ten_nguoi_nhan}} — {{mua}} — {{vai_tro}}",
      values: sampleValues("general_announcement")
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.subject).not.toMatch(/\{\{|\}\}/);
      expect(result.body).not.toMatch(/\{\{|\}\}/);
    }
  });

  it("coi null, undefined và chuỗi rỗng là như nhau — đều là thiếu", () => {
    for (const empty of [null, undefined, "", "   "]) {
      const result = renderTemplate({
        kind: "general_announcement",
        subject: "Thông báo",
        body: "Chào {{ten_nguoi_nhan}}.",
        values: { ten_nguoi_nhan: empty }
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.missing).toEqual(["ten_nguoi_nhan"]);
    }
  });

  it("chặn cả ô khai báo không bắt buộc khi nó đã được dùng mà rỗng", () => {
    // `required: false` chỉ nói "thư không nhất thiết phải dùng ô này". Đã dùng
    // rồi thì phải có gì để điền — không ai được nhận bức thư có chỗ trống.
    const result = renderTemplate({
      kind: "general_announcement",
      subject: "Thông báo",
      body: "Chào {{ten_nguoi_nhan}} ({{vai_tro}}).",
      values: { ten_nguoi_nhan: "Nguyễn Văn A", vai_tro: "" }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toEqual(["vai_tro"]);
  });

  it("báo đủ mọi ô thiếu trong một lần, để người soạn sửa một lượt", () => {
    const result = renderTemplate({
      kind: "general_announcement",
      subject: "{{mua}}",
      body: "Chào {{ten_nguoi_nhan}}.",
      values: {}
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing.sort()).toEqual(["mua", "ten_nguoi_nhan"]);
  });

  it("nhận cả số, để điền được một con số đếm", () => {
    const result = renderTemplate({
      kind: "general_announcement",
      subject: "Thông báo",
      body: "Chào {{ten_nguoi_nhan}}.",
      values: { ten_nguoi_nhan: 12 }
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body).toBe("Chào 12.");
  });

  it("mọi loại thư xem trước được bằng giá trị mẫu của chính nó", () => {
    for (const kind of TEMPLATE_KINDS) {
      const spec = TEMPLATE_SPECS[kind];
      const body = spec.placeholders.map((row) => placeholderToken(row.key)).join(" ");
      const result = renderTemplate({
        kind,
        subject: "Xem trước",
        body,
        values: sampleValues(kind)
      });
      expect(result.ok).toBe(true);
    }
  });
});

describe("nhận dạng giá trị", () => {
  it("isTemplateKind chỉ nhận đúng các loại đã khai báo", () => {
    expect(isTemplateKind("general_announcement")).toBe(true);
    expect(isTemplateKind("mentee_selected")).toBe(false);
    expect(isTemplateKind(null)).toBe(false);
  });

  it("isTemplateStatus khớp với ràng buộc trong database", () => {
    expect(["draft", "approved", "archived"].every(isTemplateStatus)).toBe(true);
    expect(isTemplateStatus("sent")).toBe(false);
  });

  it("placeholderToken tạo ra đúng dạng mà extractPlaceholders đọc lại được", () => {
    expect(extractPlaceholders(placeholderToken("mua"))).toEqual(["mua"]);
  });
});
