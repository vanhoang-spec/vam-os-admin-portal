/**
 * Form tùy chỉnh — phần thuần (BTC 15/10/2026).
 *
 * Luật ở đây chạy cả trên trình duyệt lẫn máy chủ, nên sai một chỗ là sai hai nơi:
 *   - định nghĩa trường gửi từ trình tạo form được kiểm và chép sạch (thuộc tính lạ bị bỏ);
 *   - từng loại trường nhận đúng định dạng BTC chốt: MSSV 8–12 chữ số, CCCD đúng 12, ngày DD/MM/YYYY
 *     có thật, SĐT 10 số (+84 đổi về 0), email, link http(s), lựa chọn trong danh sách;
 *   - bắt buộc thiếu thì báo; tùy chọn bỏ trống thì không lưu; trường ẩn, khối tiêu đề, mã lạ không
 *     nhận dữ liệu;
 *   - form đã có câu trả lời: không xoá / không đổi loại / không bỏ lựa chọn của câu cũ.
 */
import { describe, expect, it } from "vitest";
import { buildCustomFormReceiptEmail } from "@/lib/email-core";
import {
  CUSTOM_FORM_DRAFT_TTL_MS,
  customFormDraftKey,
  parseDraft,
  serializeDraft,
  FILE_LINK_HINT,
  FIELD_FORMAT_HINTS,
  isQuestion,
  splitPages,
  checkDefinitionRules,
  checkLockedChanges,
  dedupeKeyFor,
  defaultFields,
  formAvailability,
  isCustomFormCode,
  parseFieldDefinitions,
  parseFormSettings,
  publishBlocker,
  responseColumns,
  answerText,
  validateAnswers,
  type CustomFormField
} from "@/lib/custom-form-core";

const f = (id: string, type: CustomFormField["type"], extra: Partial<CustomFormField> = {}): CustomFormField => ({
  id,
  type,
  label: `Câu ${id}`,
  help: "",
  required: true,
  hidden: false,
  options: [],
  ...extra
});
const answer = (field: CustomFormField, ...values: string[]) => validateAnswers([field], () => values);

describe("1. định nghĩa trường từ trình tạo form", () => {
  it("chép sạch: thuộc tính lạ bị bỏ, chữ được cắt khoảng trắng, khối tiêu đề không bao giờ bắt buộc", () => {
    const parsed = parseFieldDefinitions([
      { id: "f_aaaaaaaa", type: "short_text", label: "  Họ và tên ", help: " ", required: true, hidden: false, options: ["x"], evil: "<script>" },
      { id: "f_bbbbbbbb", type: "section", label: "Phần 2", required: true },
      { id: "f_cccccccc", type: "dropdown", label: "Khoa", options: [" Kinh tế ", "", "Luật"] }
    ]);
    expect(parsed).toEqual({
      ok: true,
      fields: [
        { id: "f_aaaaaaaa", type: "short_text", label: "Họ và tên", help: "", required: true, hidden: false, options: [] },
        { id: "f_bbbbbbbb", type: "section", label: "Phần 2", help: "", required: false, hidden: false, options: [] },
        { id: "f_cccccccc", type: "dropdown", label: "Khoa", help: "", required: false, hidden: false, options: ["Kinh tế", "Luật"] }
      ]
    });
  });

  it.each([
    ["không phải mảng", { a: 1 }, "Danh sách trường"],
    ["mã trường sai dạng", [{ id: "abc", type: "short_text", label: "x" }], "mã trường"],
    ["mã trường trùng", [{ id: "f_aaaaaaaa", type: "email", label: "x" }, { id: "f_aaaaaaaa", type: "phone", label: "y" }], "mã trường"],
    ["loại lạ", [{ id: "f_aaaaaaaa", type: "file_upload", label: "x" }], "loại trường"],
    ["chưa có câu hỏi", [{ id: "f_aaaaaaaa", type: "short_text", label: "   " }], "chưa có nội dung"],
    ["câu chọn không có lựa chọn", [{ id: "f_aaaaaaaa", type: "single_choice", label: "x", options: ["", " "] }], "ít nhất một lựa chọn"],
    ["lựa chọn trùng (không phân biệt hoa thường)", [{ id: "f_aaaaaaaa", type: "multi_choice", label: "x", options: ["Có", "có"] }], "bị trùng"],
    ["quá 60 trường", Array.from({ length: 61 }, (_, i) => ({ id: `f_${String(i).padStart(8, "a")}`, type: "short_text", label: "x" })), "tối đa 60"]
  ])("từ chối: %s", (_name, raw, message) => {
    const parsed = parseFieldDefinitions(raw);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain(message);
  });

  it("form mới có sẵn Họ và tên, Email, Số điện thoại — đều bắt buộc, mã khác nhau, qua được kiểm tra", () => {
    const fields = defaultFields();
    expect(fields.map((x) => [x.type, x.label, x.required])).toEqual([
      ["short_text", "Họ và tên", true],
      ["email", "Email", true],
      ["phone", "Số điện thoại", true]
    ]);
    expect(parseFieldDefinitions(fields).ok).toBe(true);
    expect(checkDefinitionRules(fields, { onePerEmail: true })).toBeNull();
  });

  it("mã form công khai: chữ thường và số, 10–16 ký tự", () => {
    expect(isCustomFormCode("a1b2c3d4e5f6")).toBe(true);
    expect(isCustomFormCode("A1B2C3D4E5F6")).toBe(false);
    expect(isCustomFormCode("abc")).toBe(false);
    expect(isCustomFormCode("a1b2c3d4e5f6'; drop")).toBe(false);
  });
});

describe("2. cài đặt form", () => {
  const base = { title: "Tuyển mentee Job Shadowing", description: "", programId: "", thankYou: "", onePerEmail: true, opensAt: null, closesAt: null };
  it("tiêu đề bắt buộc; giờ đóng phải sau giờ mở; chương trình phải là mã hợp lệ", () => {
    expect(parseFormSettings({ ...base, title: "  " })).toMatchObject({ ok: false });
    expect(parseFormSettings({ ...base, opensAt: "2026-10-16T01:00:00.000Z", closesAt: "2026-10-16T01:00:00.000Z" })).toMatchObject({ ok: false, error: "Giờ đóng phải sau giờ mở." });
    expect(parseFormSettings({ ...base, programId: "khong-phai-uuid" })).toMatchObject({ ok: false });
    expect(parseFormSettings({ ...base, programId: "673f5d85-38f6-413c-b377-928be8c8720f" })).toMatchObject({ ok: true, settings: { programId: "673f5d85-38f6-413c-b377-928be8c8720f" } });
  });

  it("“Mỗi email chỉ gửi một lần” cần một trường Email bắt buộc đang hiện", () => {
    const email = f("f_emailaaa", "email");
    expect(checkDefinitionRules([f("f_nameaaaa", "short_text")], { onePerEmail: true })).toContain("cần một trường Email bắt buộc");
    expect(checkDefinitionRules([{ ...email, hidden: true }], { onePerEmail: true })).not.toBeNull();
    expect(checkDefinitionRules([{ ...email, required: false }], { onePerEmail: true })).not.toBeNull();
    expect(checkDefinitionRules([email], { onePerEmail: true })).toBeNull();
    expect(checkDefinitionRules([f("f_nameaaaa", "short_text")], { onePerEmail: false })).toBeNull();
  });

  it("công khai cần ít nhất một câu hỏi đang hiện (khối tiêu đề không tính)", () => {
    expect(publishBlocker([f("f_sectaaaa", "section")])).not.toBeNull();
    expect(publishBlocker([f("f_nameaaaa", "short_text", { hidden: true })])).not.toBeNull();
    expect(publishBlocker([f("f_nameaaaa", "short_text")])).toBeNull();
  });
});

describe("3. kiểm câu trả lời theo loại trường", () => {
  it.each([
    ["email", "  Ten.Ho@Gmail.COM ", "ten.ho@gmail.com"],
    ["phone", "0912 345 678", "0912345678"],
    ["phone", "+84912345678", "0912345678"],
    ["phone", "84912345678", "0912345678"],
    ["student_id", "31241028261", "31241028261"],
    ["student_id", "12345678", "12345678"],
    ["citizen_id", "0792 0400 1234", "079204001234"],
    ["date", "05/09/2004", "05/09/2004"],
    ["date", "29/02/2024", "29/02/2024"],
    ["number", "3,5", "3,5"],
    ["url", "https://drive.google.com/file/d/abc", "https://drive.google.com/file/d/abc"]
  ] as const)("%s nhận “%s” → “%s”", (type, input, expected) => {
    expect(answer(f("f_xxxxxxxx", type), input)).toEqual({ ok: true, answers: { f_xxxxxxxx: expected }, errors: {} });
  });

  it.each([
    ["email", "ten@", "Email chưa đúng"],
    ["phone", "091234567", "10 chữ số"],
    ["phone", "1912345678", "10 chữ số"],
    ["student_id", "1234567", "8–12"],
    ["student_id", "1234567890123", "8–12"],
    ["student_id", "3124A028261", "8–12"],
    ["citizen_id", "07920400123", "12 chữ số"],
    ["citizen_id", "0792040012345", "12 chữ số"],
    ["date", "31/02/2026", "ngày có thật"],
    ["date", "2004-09-05", "DD/MM/YYYY"],
    ["date", "5/9/2004", "DD/MM/YYYY"],
    ["number", "ba", "con số"],
    ["url", "javascript:alert(1)", "http"],
    ["url", "drive.google.com/abc", "http"]
  ] as const)("%s từ chối “%s”", (type, input, message) => {
    const result = answer(f("f_xxxxxxxx", type), input);
    expect(result.ok).toBe(false);
    expect(result.answers).toEqual({});
    expect(result.errors.f_xxxxxxxx).toContain(message);
  });

  it("chữ ngắn gộp xuống dòng; đoạn văn giữ xuống dòng; cả hai có trần độ dài", () => {
    expect(answer(f("f_xxxxxxxx", "short_text"), " Nguyễn\nVăn A ").answers.f_xxxxxxxx).toBe("Nguyễn Văn A");
    expect(answer(f("f_xxxxxxxx", "long_text"), "Dòng 1\r\nDòng 2").answers.f_xxxxxxxx).toBe("Dòng 1\nDòng 2");
    expect(answer(f("f_xxxxxxxx", "short_text"), "x".repeat(501)).ok).toBe(false);
    expect(answer(f("f_xxxxxxxx", "long_text"), "x".repeat(5001)).ok).toBe(false);
  });

  it("lựa chọn: chỉ nhận đúng các lựa chọn đã tạo; chọn nhiều bỏ trùng, giữ thứ tự của form", () => {
    const single = f("f_xxxxxxxx", "single_choice", { options: ["Có", "Không"] });
    const multi = f("f_yyyyyyyy", "multi_choice", { options: ["Sáng", "Chiều", "Tối"] });
    const drop = f("f_zzzzzzzz", "dropdown", { options: ["UEH", "FTU"] });
    expect(answer(single, "Có").answers).toEqual({ f_xxxxxxxx: "Có" });
    expect(answer(single, "Có thể").ok).toBe(false);
    expect(answer(drop, "BK").ok).toBe(false);
    expect(answer(multi, "Tối", "Sáng", "Tối").answers).toEqual({ f_yyyyyyyy: ["Sáng", "Tối"] });
    expect(answer(multi, "Sáng", "Đêm").ok).toBe(false);
  });

  it("bắt buộc thiếu thì báo đúng câu; tùy chọn bỏ trống thì không lưu gì", () => {
    expect(answer(f("f_xxxxxxxx", "short_text"), "   ").errors).toEqual({ f_xxxxxxxx: "Vui lòng điền mục này." });
    expect(answer(f("f_xxxxxxxx", "multi_choice", { options: ["A"] })).errors).toEqual({ f_xxxxxxxx: "Vui lòng chọn ít nhất một lựa chọn." });
    expect(answer(f("f_xxxxxxxx", "dropdown", { options: ["A"] }), "").errors).toEqual({ f_xxxxxxxx: "Vui lòng chọn một lựa chọn." });
    expect(answer(f("f_xxxxxxxx", "citizen_id", { required: false }), "")).toEqual({ ok: true, answers: {}, errors: {} });
    // Tùy chọn nhưng đã điền thì vẫn phải đúng định dạng.
    expect(answer(f("f_xxxxxxxx", "citizen_id", { required: false }), "123").ok).toBe(false);
  });

  it("trường ẩn, khối tiêu đề và mã lạ không nhận dữ liệu — kể cả khi trình duyệt cố gửi", () => {
    const fields = [f("f_nameaaaa", "short_text"), f("f_hiddenaa", "short_text", { hidden: true }), f("f_sectaaaa", "section")];
    const sent: Record<string, string[]> = { f_nameaaaa: ["An"], f_hiddenaa: ["lén gửi"], f_sectaaaa: ["x"], f_strangea: ["y"] };
    const read = (id: string) => sent[id] ?? [];
    expect(validateAnswers(fields, read)).toEqual({ ok: true, answers: { f_nameaaaa: "An" }, errors: {} });
  });
});

describe("4. form đã có câu trả lời", () => {
  const old = [
    f("f_nameaaaa", "short_text"),
    f("f_choiceaa", "single_choice", { options: ["Có", "Không"] }),
    f("f_sectaaaa", "section")
  ];
  it("sửa chữ câu hỏi, ẩn câu, thêm câu mới, thêm lựa chọn, xoá khối tiêu đề: được", () => {
    const next = [
      { ...old[0], label: "Họ và tên đầy đủ", hidden: true },
      { ...old[1], options: ["Có", "Không", "Chưa chắc"] },
      f("f_newfield", "date")
    ];
    expect(checkLockedChanges(old, next)).toBeNull();
  });
  it("xoá câu cũ, đổi loại, bỏ hay sửa lựa chọn cũ: không được", () => {
    expect(checkLockedChanges(old, [old[1]])).toContain("không xoá được");
    expect(checkLockedChanges(old, [{ ...old[0], type: "long_text" }, old[1]])).toContain("không đổi được loại");
    expect(checkLockedChanges(old, [old[0], { ...old[1], options: ["Có"] }])).toContain("“Không”");
    expect(checkLockedChanges(old, [old[0], { ...old[1], options: ["Có", "Ko"] }])).toContain("“Không”");
  });
});

describe("5. mở / đóng và chặn gửi trùng", () => {
  const at = Date.parse("2026-10-15T12:00:00Z");
  it("nháp, đã đóng, chưa tới giờ mở, quá giờ đóng, đang mở", () => {
    expect(formAvailability({ status: "draft", opensAt: null, closesAt: null }, at)).toBe("draft");
    expect(formAvailability({ status: "closed", opensAt: null, closesAt: null }, at)).toBe("closed");
    expect(formAvailability({ status: "published", opensAt: "2026-10-15T12:00:01Z", closesAt: null }, at)).toBe("not_open");
    expect(formAvailability({ status: "published", opensAt: null, closesAt: "2026-10-15T12:00:00Z" }, at)).toBe("closed");
    expect(formAvailability({ status: "published", opensAt: "2026-10-15T12:00:00Z", closesAt: "2026-10-15T12:00:01Z" }, at)).toBe("open");
    expect(formAvailability({ status: "lạ", opensAt: null, closesAt: null }, at)).toBe("closed");
  });

  it("khoá chặn trùng = email đã chuẩn hoá của trường Email bắt buộc đầu tiên, chỉ khi bật tùy chọn", () => {
    const fields = [f("f_optemail", "email", { required: false }), f("f_mainmail", "email")];
    const answers = { f_optemail: "phu@x.vn", f_mainmail: "chinh@x.vn" };
    expect(dedupeKeyFor(fields, answers, true)).toBe("chinh@x.vn");
    expect(dedupeKeyFor(fields, answers, false)).toBeNull();
  });

  it("cột của bảng câu trả lời: mọi câu hỏi kể cả câu đã ẩn (ghi rõ), không có khối tiêu đề; chọn nhiều nối bằng “; ”", () => {
    expect(responseColumns([f("f_nameaaaa", "short_text"), f("f_sectaaaa", "section"), f("f_hiddenaa", "email", { hidden: true, label: "Email cũ" })])).toEqual([
      { id: "f_nameaaaa", label: "Câu f_nameaaaa" },
      { id: "f_hiddenaa", label: "Email cũ (đã ẩn)" }
    ]);
    expect(answerText(["Sáng", "Tối"])).toBe("Sáng; Tối");
    expect(answerText(undefined)).toBe("");
  });
});

describe("6. ô tải file = gửi link; ngắt trang (BTC 15/10/2026)", () => {
  it("“Tải file (gửi link)”: nhận link http(s), từ chối thứ khác; dưới ô có sẵn hướng dẫn bật chia sẻ công khai", () => {
    const file = f("f_cvaaaaaa", "file_link");
    expect(answer(file, "https://drive.google.com/file/d/abc/view?usp=sharing").answers).toEqual({ f_cvaaaaaa: "https://drive.google.com/file/d/abc/view?usp=sharing" });
    expect(answer(file, "C:\\Users\\cv.pdf").ok).toBe(false);
    expect(answer(file, "javascript:alert(1)").ok).toBe(false);
    expect(FIELD_FORMAT_HINTS.file_link).toBe(FILE_LINK_HINT);
    expect(FILE_LINK_HINT).toContain("Bất kỳ ai có đường liên kết");
  });

  it("ngắt trang: không phải câu hỏi, để trống tiêu đề được, không bao giờ bắt buộc, không nhận dữ liệu", () => {
    const parsed = parseFieldDefinitions([{ id: "f_breakaaa", type: "page_break", label: "", required: true }]);
    expect(parsed).toEqual({ ok: true, fields: [{ id: "f_breakaaa", type: "page_break", label: "", help: "", required: false, hidden: false, options: [] }] });
    expect(isQuestion({ type: "page_break" })).toBe(false);
    expect(validateAnswers([f("f_breakaaa", "page_break")], () => ["x"])).toEqual({ ok: true, answers: {}, errors: {} });
    // Câu thường vẫn phải có nội dung.
    expect(parseFieldDefinitions([{ id: "f_aaaaaaaa", type: "short_text", label: "" }]).ok).toBe(false);
  });

  it("chia trang: tiêu đề của ngắt trang là của trang SAU; ngắt ở đầu/cuối, liền nhau hay đang ẩn không sinh trang rỗng", () => {
    const name = f("f_nameaaaa", "short_text");
    const mail = f("f_emailaaa", "email");
    const cv = f("f_cvaaaaaa", "file_link");
    const brk = (id: string, label = "", extra: Partial<CustomFormField> = {}) => f(id, "page_break", { label, required: false, ...extra });
    expect(splitPages([name, mail])).toMatchObject([{ title: "", help: "", fields: [name, mail] }]);
    expect(splitPages([name, brk("f_brk1aaaa", "Hồ sơ", { help: "Gửi link CV" }), cv])).toMatchObject([
      { title: "", help: "", fields: [name] },
      { title: "Hồ sơ", help: "Gửi link CV", fields: [cv] }
    ]);
    expect(splitPages([brk("f_brk0aaaa", "Mở đầu"), name, brk("f_brk1aaaa"), brk("f_brk2aaaa", "Trang 2"), mail, brk("f_brk3aaaa")])).toMatchObject([
      { title: "Mở đầu", help: "", fields: [name] },
      { title: "Trang 2", help: "", fields: [mail] }
    ]);
    expect(splitPages([name, brk("f_brk1aaaa", "Ẩn", { hidden: true }), mail])).toMatchObject([{ title: "", help: "", fields: [name, mail] }]);
    expect(splitPages([])).toMatchObject([{ title: "", help: "", fields: [] }]);
  });
});

describe("7. thư tự động gửi người điền (BTC 15/10/2026)", () => {
  const email = f("f_emailaaa", "email");
  it("bật thư cần trường Email bắt buộc đang hiện và nội dung thư", () => {
    expect(checkDefinitionRules([f("f_nameaaaa", "short_text")], { onePerEmail: false, autoReply: true, autoReplyBody: "Cảm ơn" })).toContain("trường Email bắt buộc");
    expect(checkDefinitionRules([email], { onePerEmail: false, autoReply: true, autoReplyBody: "   " })).toContain("chưa có nội dung");
    expect(checkDefinitionRules([email], { onePerEmail: false, autoReply: true, autoReplyBody: "Cảm ơn" })).toBeNull();
    expect(checkDefinitionRules([f("f_nameaaaa", "short_text")], { onePerEmail: false, autoReply: false, autoReplyBody: "" })).toBeNull();
  });

  it("cài đặt: tiêu đề một dòng, nội dung giữ xuống dòng, có trần độ dài", () => {
    const base = { title: "Form", description: "", programId: "", thankYou: "", onePerEmail: false, opensAt: null, closesAt: null };
    expect(parseFormSettings({ ...base, autoReply: "on", autoReplySubject: " Đã nhận\nđơn ", autoReplyBody: "Dòng 1\r\nDòng 2 " })).toMatchObject({
      ok: true,
      settings: { autoReply: true, autoReplySubject: "Đã nhận đơn", autoReplyBody: "Dòng 1\nDòng 2" }
    });
    expect(parseFormSettings({ ...base, autoReplySubject: "x".repeat(201) }).ok).toBe(false);
    expect(parseFormSettings({ ...base, autoReplyBody: "x".repeat(5001) }).ok).toBe(false);
    expect(parseFormSettings(base)).toMatchObject({ ok: true, settings: { autoReply: false, autoReplySubject: "", autoReplyBody: "" } });
  });

  it("thư: chữ BTC soạn được thoát HTML, xuống dòng giữ nguyên; tiêu đề trống thì dùng tên form; thư thử ghi rõ", () => {
    const mail = buildCustomFormReceiptEmail({ formTitle: "Tuyển mentee Job Shadowing", subject: "", body: "Chào <b>bạn</b>,\nĐã nhận.\n\nHẹn gặp!" });
    expect(mail.subject).toBe("Đã nhận câu trả lời: Tuyển mentee Job Shadowing");
    expect(mail.html).toContain("Chào &lt;b&gt;bạn&lt;/b&gt;,<br />Đã nhận.");
    expect(mail.html).toContain("<p>Hẹn gặp!</p>");
    expect(mail.html).not.toContain("<b>bạn</b>");
    expect(mail.text).toContain("Chào <b>bạn</b>,\nĐã nhận.\n\nHẹn gặp!");
    expect(mail.text).toContain("Vietnam Alumni Mentoring");
    const test = buildCustomFormReceiptEmail({ formTitle: "Form", subject: "Đã nhận đơn", body: "x", test: true });
    expect(test.subject).toBe("[THƯ THỬ] Đã nhận đơn");
    expect(test.html).toContain("THƯ THỬ.");
    expect(buildCustomFormReceiptEmail({ formTitle: "Form", subject: "Đã nhận đơn", body: "x" }).html).not.toContain("THƯ THỬ");
  });
});

describe("8. lưu nháp trên máy người điền (BTC 15/10/2026)", () => {
  const NOW = Date.parse("2026-10-15T13:00:00Z");
  const fields = [
    f("f_nameaaaa", "short_text"),
    f("f_slotaaaa", "multi_choice", { options: ["Sáng", "Chiều", "Tối"] }),
    f("f_khoaaaaa", "dropdown", { options: ["UEH", "FTU"] }),
    f("f_hiddenaa", "short_text", { hidden: true }),
    f("f_sectaaaa", "section")
  ];
  const draft = (values: Record<string, unknown>, extra: Record<string, unknown> = {}) => JSON.stringify({ v: 1, savedAt: NOW - 60_000, page: 2, values, ...extra });

  it("ghi: chỉ các ô đã điền; đọc lại đúng nguyên giá trị, trang, giờ lưu", () => {
    const raw = serializeDraft({ f_nameaaaa: "An", f_slotaaaa: [], f_khoaaaaa: " " }, 1, NOW);
    expect(JSON.parse(raw)).toEqual({ v: 1, savedAt: NOW, page: 1, values: { f_nameaaaa: "An" } });
    expect(parseDraft(fields, raw, NOW + 1000)).toEqual({ values: { f_nameaaaa: "An" }, page: 1, savedAt: NOW });
  });

  it("đọc là LỌC: bỏ câu không còn trên form, câu đang ẩn, khối tiêu đề, sai kiểu, lựa chọn đã bị bỏ; chọn nhiều giữ thứ tự form", () => {
    const parsed = parseDraft(
      fields,
      draft({
        f_nameaaaa: ["không phải chữ"],
        f_slotaaaa: ["Tối", "Đêm", "Sáng"],
        f_khoaaaaa: "BK",
        f_hiddenaa: "lén",
        f_sectaaaa: "x",
        f_daxoaaaa: "câu đã xoá"
      }),
      NOW
    );
    expect(parsed).toEqual({ values: { f_slotaaaa: ["Sáng", "Tối"] }, page: 2, savedAt: NOW - 60_000 });
    expect(parseDraft(fields, draft({ f_nameaaaa: "x".repeat(6000) }), NOW)!.values.f_nameaaaa).toHaveLength(5000);
  });

  it("không mở lại: rỗng, hỏng, sai phiên bản, quá 14 ngày, giờ lưu ở tương lai, hay không còn câu nào khớp", () => {
    expect(parseDraft(fields, null, NOW)).toBeNull();
    expect(parseDraft(fields, "{hỏng", NOW)).toBeNull();
    expect(parseDraft(fields, draft({ f_nameaaaa: "An" }, { v: 2 }), NOW)).toBeNull();
    expect(parseDraft(fields, draft({ f_nameaaaa: "An" }, { savedAt: NOW - CUSTOM_FORM_DRAFT_TTL_MS - 1 }), NOW)).toBeNull();
    expect(parseDraft(fields, draft({ f_nameaaaa: "An" }, { savedAt: NOW - CUSTOM_FORM_DRAFT_TTL_MS + 1000 }), NOW)).not.toBeNull();
    expect(parseDraft(fields, draft({ f_nameaaaa: "An" }, { savedAt: NOW + 120_000 }), NOW)).toBeNull();
    expect(parseDraft(fields, draft({ f_daxoaaaa: "x" }), NOW)).toBeNull();
    expect(parseDraft(fields, JSON.stringify([1, 2]), NOW)).toBeNull();
  });

  it("mỗi form một chỗ lưu; bản xem thử của ban tổ chức lưu riêng", () => {
    expect(customFormDraftKey("a1b2c3d4e5f6")).toBe("vam-form-nhap:a1b2c3d4e5f6");
    expect(customFormDraftKey("a1b2c3d4e5f6", true)).toBe("vam-form-nhap:a1b2c3d4e5f6:xem-thu");
  });
});
