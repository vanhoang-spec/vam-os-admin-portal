/**
 * Danh mục chữ trên form nộp đơn, phép tính lưu, và bộ đọc định dạng chữ.
 *
 * Những cách nó hỏng mà không ai thấy, và bộ test canh:
 *   - chữ mặc định lệch bản đã duyệt — form đổi chữ mà không ai sửa gì;
 *   - chữ mặc định chưa ở dạng chuẩn hoá — một lần bấm lưu không sửa gì cũng ghi;
 *   - lưu đè bản người khác vừa sửa;
 *   - sửa về mặc định mà lưu một bản sao — lần sau đổi mặc định, khối đó không đổi theo;
 *   - một ngày như 20.09.2026 bị biến thành số điện thoại bấm được.
 */
import { describe, expect, it } from "vitest";
import {
  APPLICATION_FORM_TEXT_GROUPS,
  APPLICATION_FORM_TEXT_KEYS,
  APPLICATION_FORM_TEXT_SLOTS,
  DEFAULT_APPLICATION_FORM_TEXTS as D,
  MENTEE_SUPPORT_CONTACTS,
  applicationFormTextSlot,
  normalizeFormText,
  parseRichInline,
  parseRichText,
  planFormTextSave,
  resolveApplicationFormTexts,
  validateFormText
} from "@/lib/application-form-text-core";
import { MENTOR_SUPPORT_CONTACTS } from "@/lib/mentor-intake-content";

const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const lines = (...rows: string[]) => rows.join(LF);
const slotOf = (key: string) => applicationFormTextSlot(key)!;

describe("1. danh mục", () => {
  it("mỗi khoá đúng một khối, thuộc một nhóm có thật", () => {
    expect(APPLICATION_FORM_TEXT_SLOTS.map((entry) => entry.key)).toEqual([...APPLICATION_FORM_TEXT_KEYS]);
    const groups = new Set(APPLICATION_FORM_TEXT_GROUPS.map((group) => group.id));
    for (const entry of APPLICATION_FORM_TEXT_SLOTS) expect(groups.has(entry.group), entry.key).toBe(true);
    for (const group of Array.from(groups)) {
      expect(APPLICATION_FORM_TEXT_SLOTS.some((entry) => entry.group === group), group).toBe(true);
    }
  });

  it("khoá khớp hình dạng mà CHECK của migration nhận", () => {
    for (const key of APPLICATION_FORM_TEXT_KEYS) expect(key).toMatch(/^[a-z][a-z0-9_.]{2,79}$/);
  });

  it("chữ mặc định là bản đã duyệt", () => {
    expect(D["mentor.header.title"]).toBe("Đơn đăng ký mentor");
    expect(D["mentee.header.title"]).toBe("Đơn đăng ký mentee");
    expect(D["mentor.profile.heading"]).toBe("Chân dung Mentor mà UEH Mentoring đang tìm kiếm");
    expect(D["mentee.profile.heading"]).toBe("Chân dung Mentee chúng tôi tìm kiếm");
    expect(D["mentor.process.step1_note"]).toBe("Lưu ý: Chương trình nhận đăng ký Mentor mới Mùa 12 đến hết ngày **19/09/2026**.");
    expect(D["mentor.process.step3_title"]).toBe("Bước 3 – Tham dự Mentor Orientation");
    expect(D["mentor.process.step2_note"]).toBe("");
    expect(D["mentor.process.step3_note"]).toBe("");
  });

  it("danh bạ mặc định lấy đúng từ danh bạ đã duyệt, đủ tên, số, email", () => {
    for (const contact of MENTOR_SUPPORT_CONTACTS) {
      expect(D["mentor.contacts.list"]).toContain(`- **${contact.name}** — ${contact.role}`);
      if ("phone" in contact && contact.phone) expect(D["mentor.contacts.list"]).toContain(contact.phone);
      if ("email" in contact && contact.email) expect(D["mentor.contacts.list"]).toContain(contact.email);
    }
    for (const contact of MENTEE_SUPPORT_CONTACTS) {
      expect(D["mentee.contacts.list"]).toContain(`- **${contact.name}** — ${contact.role} — ${contact.phone}`);
    }
  });

  it("mọi chữ mặc định tự hợp lệ và đã ở dạng chuẩn hoá", () => {
    for (const entry of APPLICATION_FORM_TEXT_SLOTS) {
      expect(validateFormText(entry, entry.defaultText), entry.key).toBeNull();
      expect(normalizeFormText(entry.defaultText, entry.kind), entry.key).toBe(entry.defaultText);
    }
  });
});

describe("2. chuẩn hoá và kiểm", () => {
  it("khối một dòng: xuống dòng thành dấu cách, bỏ khoảng trắng hai đầu", () => {
    expect(normalizeFormText(`  Đơn đăng ký${CR}${LF}  mentor  `, "line")).toBe("Đơn đăng ký mentor");
  });

  it("khối nhiều dòng: một kiểu xuống dòng, bỏ khoảng trắng cuối dòng, gộp dòng trống", () => {
    expect(normalizeFormText(`${LF}Dòng 1   ${CR}${LF}${CR}${LF}${LF}${LF}- A${CR}- B${LF}${LF}`, "rich")).toBe(lines("Dòng 1", "", "- A", "- B"));
  });

  it("khối bắt buộc để trống: báo đúng tên khối; khối tuỳ chọn thì được", () => {
    expect(validateFormText(slotOf("mentor.header.title"), "")).toBe("Tiêu đề không được để trống.");
    expect(validateFormText(slotOf("mentor.process.step1_note"), "")).toBeNull();
  });

  it("dài quá trần: từ chối", () => {
    expect(validateFormText(slotOf("mentor.header.title"), "a".repeat(201))).toBe("Tiêu đề dài quá 200 ký tự.");
    expect(validateFormText(slotOf("mentor.header.title"), "a".repeat(200))).toBeNull();
    expect(validateFormText(slotOf("mentor.header.intro"), "a".repeat(5001))).toBe("Lời mở đầu dài quá 5.000 ký tự.");
  });
});

describe("3. chữ đang hiện", () => {
  it("không có bản sửa nào: đúng chữ mặc định", () => {
    expect(resolveApplicationFormTexts(null)).toEqual(D);
    expect(resolveApplicationFormTexts({})).toEqual(D);
  });

  it("bản đã sửa thắng mặc định, khoá lạ bị bỏ qua", () => {
    const texts = resolveApplicationFormTexts({
      "mentor.process.step1_note": "Hạn nộp dời sang **26/09/2026**.",
      "mentor.header.bogus": "x"
    });
    expect(texts["mentor.process.step1_note"]).toBe("Hạn nộp dời sang **26/09/2026**.");
    expect(Object.keys(texts)).toEqual([...APPLICATION_FORM_TEXT_KEYS]);
  });

  it("khối tuỳ chọn để trống: rỗng — form sẽ ẩn khối đó", () => {
    expect(resolveApplicationFormTexts({ "mentor.process.step1_note": "" })["mentor.process.step1_note"]).toBe("");
  });

  it("một dòng hỏng trong database không làm form hiện khoảng trống: rơi về mặc định", () => {
    const texts = resolveApplicationFormTexts({
      "mentor.header.title": "",
      "mentor.header.eyebrow": "a".repeat(500),
      "mentor.profile.heading": 42
    });
    expect(texts["mentor.header.title"]).toBe(D["mentor.header.title"]);
    expect(texts["mentor.header.eyebrow"]).toBe(D["mentor.header.eyebrow"]);
    expect(texts["mentor.profile.heading"]).toBe(D["mentor.profile.heading"]);
  });
});

describe("4. phép tính lưu", () => {
  const NOTE = "mentor.process.step1_note";
  const TITLE = "mentor.header.title";

  it("sửa khác mặc định: lưu đúng chữ đã chuẩn hoá, ghi bản trước và sau", () => {
    const plan = planFormTextSave({
      submitted: { [NOTE]: "Hạn nộp dời sang **26/09/2026**.   " },
      expected: { [NOTE]: D[NOTE] },
      overrides: {}
    });
    expect(plan).toEqual({
      ok: true,
      upserts: [{ key: NOTE, body: "Hạn nộp dời sang **26/09/2026**." }],
      deletes: [],
      before: { [NOTE]: D[NOTE] },
      after: { [NOTE]: "Hạn nộp dời sang **26/09/2026**." }
    });
  });

  it("sửa về đúng mặc định: xoá dòng đã sửa, không lưu bản sao của mặc định", () => {
    const plan = planFormTextSave({ submitted: { [NOTE]: D[NOTE] }, expected: { [NOTE]: "Cũ" }, overrides: { [NOTE]: "Cũ" } });
    expect(plan).toMatchObject({ ok: true, upserts: [], deletes: [NOTE], after: { [NOTE]: D[NOTE] } });
  });

  it("không đổi gì: không ghi", () => {
    const plan = planFormTextSave({ submitted: { [TITLE]: D[TITLE] }, expected: { [TITLE]: D[TITLE] }, overrides: {} });
    expect(plan).toEqual({ ok: true, upserts: [], deletes: [], before: {}, after: {} });
  });

  it("khối tuỳ chọn để trống: lưu một dòng rỗng để ẩn khối", () => {
    const plan = planFormTextSave({ submitted: { [NOTE]: "" }, expected: { [NOTE]: D[NOTE] }, overrides: {} });
    expect(plan).toMatchObject({ ok: true, upserts: [{ key: NOTE, body: "" }], deletes: [] });
  });

  it("người khác vừa sửa: không ghi gì, kể cả khối khác trong cùng lượt", () => {
    const plan = planFormTextSave({
      submitted: { [TITLE]: "Đơn mentor", [NOTE]: "Bản của tôi" },
      expected: { [TITLE]: D[TITLE], [NOTE]: D[NOTE] },
      overrides: { [NOTE]: "Bản người khác vừa lưu" }
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.message).toContain("Bước 1 · Khung lưu ý vàng");
  });

  it("thiếu chữ màn hình đã hiện: từ chối", () => {
    expect(planFormTextSave({ submitted: { [TITLE]: "Mới" }, expected: {}, overrides: {} }).ok).toBe(false);
  });

  it("khoá lạ gửi kèm bị bỏ qua", () => {
    const plan = planFormTextSave({
      submitted: { consent_data_storage: "on", MENTOR_ACTIVE_READING_V1: "x", [TITLE]: D[TITLE] },
      expected: { [TITLE]: D[TITLE] },
      overrides: {}
    });
    expect(plan).toEqual({ ok: true, upserts: [], deletes: [], before: {}, after: {} });
  });

  it("một khối không hợp lệ thì cả lượt không ghi", () => {
    const plan = planFormTextSave({
      submitted: { [NOTE]: "Mới", [TITLE]: "   " },
      expected: { [NOTE]: D[NOTE], [TITLE]: D[TITLE] },
      overrides: {}
    });
    expect(plan).toEqual({ ok: false, message: "Tiêu đề không được để trống." });
  });

  it("so chữ màn hình đã hiện theo dạng chuẩn hoá — CRLF của trình duyệt không bị tính là người khác sửa", () => {
    const key = "mentee.profile.body";
    const browserCopy = D[key].split(LF).join(CR + LF);
    const plan = planFormTextSave({ submitted: { [key]: browserCopy }, expected: { [key]: browserCopy }, overrides: {} });
    expect(plan).toEqual({ ok: true, upserts: [], deletes: [], before: {}, after: {} });
  });
});

describe("5. định dạng chữ", () => {
  it("**chữ đậm**", () => {
    expect(parseRichInline("hết ngày **19/09/2026** nhé")).toEqual([
      { kind: "text", text: "hết ngày ", strong: false },
      { kind: "text", text: "19/09/2026", strong: true },
      { kind: "text", text: " nhé", strong: false }
    ]);
  });

  it("dấu ** lẻ: giữ nguyên là chữ thường", () => {
    expect(parseRichInline("5 ** 3")).toEqual([{ kind: "text", text: "5 ** 3", strong: false }]);
  });

  it("email và số điện thoại thành đường dẫn", () => {
    const tokens = parseRichInline("Gọi 0905.376.392 hoặc thư luongquocvihcm12@gmail.com.");
    expect(tokens).toContainEqual({ kind: "link", text: "0905.376.392", href: "tel:0905376392", strong: false });
    expect(tokens).toContainEqual({
      kind: "link",
      text: "luongquocvihcm12@gmail.com",
      href: "mailto:luongquocvihcm12@gmail.com",
      strong: false
    });
    expect(tokens[tokens.length - 1]).toEqual({ kind: "text", text: ".", strong: false });
  });

  it.each(["AGENDA – 20.09.2026 & 27.09.2026", "hạn 19/09/2026", "Giá vé: 10.000 - 20.000 VNĐ", "04.10.2026"])(
    "không biến ngày hay số tiền thành số điện thoại: %s",
    (text) => {
      expect(parseRichInline(text).every((token) => token.kind === "text")).toBe(true);
    }
  );

  it("đoạn, xuống dòng trong đoạn, gạch đầu dòng", () => {
    const blocks = parseRichText(lines("Dòng 1", "Dòng 2", "", "- A", "• B", "Đoạn sau"));
    expect(blocks.map((block) => block.kind)).toEqual(["paragraph", "list", "paragraph"]);
    expect(blocks[0].kind === "paragraph" && blocks[0].lines.length).toBe(2);
    expect(blocks[1].kind === "list" && blocks[1].items.map((item) => item.map((token) => token.text).join(""))).toEqual([
      "A",
      "B"
    ]);
  });

  it("chữ trông như HTML chỉ là chữ", () => {
    expect(parseRichText("<script>alert(1)</script>")).toEqual([
      { kind: "paragraph", lines: [[{ kind: "text", text: "<script>alert(1)</script>", strong: false }]] }
    ]);
  });

  it("rỗng: không có khối nào", () => {
    expect(parseRichText("")).toEqual([]);
    expect(parseRichText(`${LF}${LF}`)).toEqual([]);
  });
});
