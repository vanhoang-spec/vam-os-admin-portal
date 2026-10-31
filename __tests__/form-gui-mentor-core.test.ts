/**
 * "Tự động gửi Submission cho Mentor" (VAM00011) — phần thuần: luật định nghĩa form, chọn mentor, bảng câu
 * trả lời, và lá thư. Thân thư mang chữ người điền form công khai tự gõ, nên ca thoát HTML soi đúng từng ô.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkDefinitionRules, parseFormSettings, type CustomFormField } from "@/lib/custom-form-core";
import { isOpenMentorSend, mentorAnswerRows, mentorSendStatusLabel, mentorSweepMessage, pickMentor, sampleMentorAnswerRows } from "@/lib/custom-form-mentor-core";
import { buildCustomFormMentorSubmissionEmail } from "@/lib/email-core";
import { outboundEmailKindLabel } from "@/lib/outbound-emails-core";

const f = (id: string, type: CustomFormField["type"], extra: Partial<CustomFormField> = {}): CustomFormField => ({ id, type, label: `Câu ${id}`, help: "", required: true, hidden: false, options: [], ...extra });
const email = f("f_emailaaa", "email");
const name = f("f_nameaaaa", "short_text", { label: "Họ và tên" });
const on = { onePerEmail: false, mentorForward: true, mentorForwardBody: "Nội dung" };

describe("1. luật định nghĩa form", () => {
  it("bật thì cần trường Email bắt buộc, đang hiện", () => {
    expect(checkDefinitionRules([name], on)).toContain("trường Email bắt buộc");
    expect(checkDefinitionRules([{ ...email, required: false }], on)).toContain("trường Email bắt buộc");
    expect(checkDefinitionRules([{ ...email, hidden: true }], on)).toContain("trường Email bắt buộc");
    expect(checkDefinitionRules([email], on)).toBeNull();
  });

  it("bật thì cần nội dung thư", () => {
    expect(checkDefinitionRules([email], { ...on, mentorForwardBody: "   " })).toContain("chưa có nội dung");
  });

  it("không bật cùng form gắn sự kiện", () => {
    expect(checkDefinitionRules([name, email], { ...on, onePerEmail: true, eventId: "e" })).toContain("Form gắn sự kiện chưa dùng được");
  });

  it("tắt thì không luật nào của tính năng này chạy", () => {
    expect(checkDefinitionRules([name], { onePerEmail: false, mentorForward: false, mentorForwardBody: "" })).toBeNull();
  });

  it("Email nằm sau chỗ rẽ nhánh: bị chặn, vì người bị đưa qua trang đó sẽ không được hỏi", () => {
    const branch = f("f_branchaa", "yes_no", { options: ["Có", "Không"], branches: { yes: "f_breakbbb", no: "" } });
    const fields = [branch, f("f_breakaaa", "page_break", { label: "A", required: false }), email, f("f_breakbbb", "page_break", { label: "B", required: false }), name];
    expect(checkDefinitionRules(fields, on)).toContain("trường Email phải nằm trước");
    expect(checkDefinitionRules(fields, { ...on, mentorForward: false })).toBeNull();
  });

  it("parseFormSettings: mặc định tắt, chuẩn hoá tiêu đề và nội dung, kiểm độ dài", () => {
    const base = { title: "F", description: "", programId: "", thankYou: "", onePerEmail: false, opensAt: null, closesAt: null };
    expect(parseFormSettings(base)).toMatchObject({ ok: true, settings: { mentorForward: false, mentorForwardSubject: "", mentorForwardBody: "" } });
    expect(parseFormSettings({ ...base, mentorForward: true, mentorForwardSubject: " A\nB ", mentorForwardBody: "x\r\ny " })).toMatchObject({
      settings: { mentorForward: true, mentorForwardSubject: "A B", mentorForwardBody: "x\ny" }
    });
    expect(parseFormSettings({ ...base, mentorForwardSubject: "x".repeat(201) }).ok).toBe(false);
    expect(parseFormSettings({ ...base, mentorForwardBody: "x".repeat(5001) }).ok).toBe(false);
  });
});

describe("2. chọn mentor", () => {
  it("không có cặp, cặp thiếu mentor: chưa có mentor", () => {
    expect(pickMentor([])).toEqual({ kind: "none" });
    expect(pickMentor([{ id: "m1", mentor_person_id: null }])).toEqual({ kind: "none" });
  });

  it("một mentor; hai dòng cùng mentor vẫn là một, kết quả không theo thứ tự đọc", () => {
    const expected = { kind: "one", matchId: "m1", mentorPersonId: "a" };
    expect(pickMentor([{ id: "m2", mentor_person_id: "a" }, { id: "m1", mentor_person_id: "a" }])).toEqual(expected);
    expect(pickMentor([{ id: "m1", mentor_person_id: "a" }, { id: "m2", mentor_person_id: "a" }])).toEqual(expected);
  });

  it("hai mentor khác nhau: không chọn", () => {
    expect(pickMentor([{ id: "m1", mentor_person_id: "a" }, { id: "m2", mentor_person_id: "b" }])).toEqual({ kind: "many", count: 2 });
  });
});

describe("3. dòng còn việc", () => {
  it("đã gửi và đang gửi không bao giờ mở; lỗi mở tới hết số lần thử; không nhận ra chỉ mở khi BTC bấm", () => {
    expect(isOpenMentorSend({ status: "da_gui" }, true)).toBe(false);
    expect(isOpenMentorSend({ status: "dang_gui" }, true)).toBe(false);
    expect(isOpenMentorSend({ status: "cho_ghep_cap" }, false)).toBe(true);
    expect(isOpenMentorSend({ status: "loi", attempts: 2 }, false)).toBe(true);
    expect(isOpenMentorSend({ status: "loi", attempts: 3 }, false)).toBe(false);
    expect(isOpenMentorSend({ status: "khong_nhan_ra" }, false)).toBe(false);
    expect(isOpenMentorSend({ status: "khong_nhan_ra" }, true)).toBe(true);
  });
});

describe("4. bảng câu trả lời", () => {
  const fields = [name, f("f_hiddenaa", "short_text", { label: "Ẩn", hidden: true }), f("f_sectiona", "section"), f("f_skippeda", "long_text", { label: "Bị bỏ qua" }), f("f_multiaaa", "multi_choice", { label: "Buổi", options: ["Sáng", "Tối"] })];

  it("chỉ câu đang hiện có trả lời, câu chọn nhiều nối lại", () => {
    expect(mentorAnswerRows(fields, { f_nameaaaa: "An", f_hiddenaa: "bí mật", f_multiaaa: ["Sáng", "Tối"] })).toEqual([
      { label: "Họ và tên", value: "An" },
      { label: "Buổi", value: "Sáng; Tối" }
    ]);
  });

  it("bảng cho thư thử không có câu ẩn và không có dữ liệu thật", () => {
    expect(sampleMentorAnswerRows(fields).map((r) => r.label)).toEqual(["Họ và tên", "Bị bỏ qua", "Buổi"]);
  });
});

describe("5. lá thư", () => {
  const input = { formTitle: "Mục tiêu", body: "Kính gửi anh/chị,\n\nDòng 2", menteeName: "Nguyễn Văn An", answers: [{ label: "Mục tiêu", value: "Học\nthêm" }] };

  it("có lời nhắn, tên mentee, bảng câu trả lời; tiêu đề mặc định theo tên form", () => {
    const mail = buildCustomFormMentorSubmissionEmail(input);
    expect(mail.subject).toBe("Câu trả lời của mentee: Mục tiêu");
    expect(mail.html).toContain("<p>Kính gửi anh/chị,</p><p>Dòng 2</p>");
    expect(mail.html).toContain("Nguyễn Văn An");
    expect(mail.html).toContain(">Mục tiêu</th>");
    expect(mail.html).toContain(">Học<br />thêm</td>");
    expect(mail.text).toContain("- Mục tiêu: Học\nthêm");
    expect(mail.html).not.toContain("THƯ THỬ");
  });

  it.each([
    ["câu trả lời", { answers: [{ label: "L", value: '<img src=x onerror="a()">' }] }],
    ["nhãn câu hỏi", { answers: [{ label: "<script>a()</script>", value: "v" }] }],
    ["tên mentee", { menteeName: "<b>An</b>" }],
    ["lời nhắn BTC", { body: "<a href='x'>bấm</a>" }],
    ["tên form", { formTitle: "<i>Form</i>" }]
  ])("thoát HTML ở %s", (_name, over) => {
    const html = buildCustomFormMentorSubmissionEmail({ ...input, ...over }).html;
    expect(html).not.toMatch(/<(img|script|a |b>|i>)/);
    expect(html).toContain("&lt;");
  });

  it("thư thử ghi rõ là thư thử, cả tiêu đề lẫn thân", () => {
    const mail = buildCustomFormMentorSubmissionEmail({ ...input, subject: "Tiêu đề", test: true });
    expect(mail.subject).toContain("Tiêu đề");
    expect(mail.subject).not.toBe("Tiêu đề");
    expect(mail.html).toContain("THƯ THỬ");
  });

  it("xuống dòng trong tiêu đề không chèn được header", () => {
    expect(buildCustomFormMentorSubmissionEmail({ ...input, subject: "A\r\nBcc: x@y.z" }).subject).toBe("A Bcc: x@y.z");
  });
});

describe("6. nhãn và cấu hình", () => {
  it("nhãn trạng thái và loại thư", () => {
    expect(mentorSendStatusLabel("cho_ghep_cap")).toBe("Chờ ghép cặp");
    expect(mentorSendStatusLabel("khong_nhan_ra")).toBe("Không nhận ra mentee");
    expect(mentorSendStatusLabel("la")).toBe("la");
    expect(outboundEmailKindLabel("custom_form_mentor_submission")).toBe("Câu trả lời form tùy chỉnh gửi mentor");
  });

  it("câu báo nói đúng lý do dừng", () => {
    const counts = { sent: 2, waiting: 1, unknown: 0, failed: 0 };
    expect(mentorSweepMessage(counts, null)).toBe("Đã gửi 2 bản, 1 bản còn chờ ghép cặp.");
    expect(mentorSweepMessage(counts, "quota")).toContain("hạn mức");
    expect(mentorSweepMessage(counts, "mail_off")).toContain("tắt gửi thư");
  });

  it("hướng dẫn /forms nói về tính năng", () => {
    const guide = readFileSync("lib/help-guides.ts", "utf8");
    expect(guide).toContain("Tự động gửi Submission cho Mentor");
    expect(guide).toContain("Gửi các bản đang chờ");
  });
});
