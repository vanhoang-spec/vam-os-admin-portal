/**
 * Form tùy chỉnh — máy chủ (BTC 15/10/2026), trên bản giả PostgREST.
 *
 * Khẳng định CHÍNH các lệnh ghi, không chỉ giá trị trả về:
 *   - cổng quyền fail-closed: không tài khoản, tài khoản ngừng, viewer/reviewer → không đọc, không ghi;
 *   - lưu form: một lệnh update đúng cột, đúng form; định nghĩa sai, luật khoá khi đã có câu trả lời,
 *     form đang công khai mà hết câu hỏi → không ghi gì;
 *   - đổi trạng thái chỉ chạm cột trạng thái; công khai cần form đủ điều kiện;
 *   - gửi công khai: form chưa mở/đã đóng/nháp, thiếu đồng ý, sai định dạng → không ghi; ô bẫy có chữ
 *     → báo đã nhận nhưng không ghi; hợp lệ → đúng một dòng với câu trả lời đã chuẩn hoá; trùng email
 *     → báo đúng ô email; trường ẩn không lộ ra trang công khai, form nháp không lộ tiêu đề.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DAILY_EMAIL_LIMIT } from "@/lib/email-quota-core";
import { createFakeDb, fakeClient } from "./support/fake-postgrest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn(), getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendCustomFormReceipt: vi.fn(async () => ({ ok: true, skipped: false })) }));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { sendCustomFormReceipt } from "@/lib/email";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import {
  createCustomForm,
  getPublicCustomForm,
  listCustomFormResponses,
  listCustomForms,
  saveCustomForm,
  sendCustomFormReceiptTest,
  setCustomFormStatus,
  submitPublicCustomForm
} from "@/lib/custom-forms";
import type { CustomFormSavePayload } from "@/lib/custom-form-action-types";

const db = createFakeDb();
const FORM = "11111111-2222-4333-8444-555555555555";
const CODE = "a1b2c3d4e5f6";
const PROGRAM = "673f5d85-38f6-413c-b377-928be8c8720f";
const NOW = Date.parse("2026-10-15T12:00:00Z");

const field = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, label: `Câu ${id}`, help: "", required: true, hidden: false, options: [], ...extra });
const FIELDS = [
  field("f_nameaaaa", "short_text", { label: "Họ và tên" }),
  field("f_emailaaa", "email", { label: "Email" }),
  field("f_mssvaaaa", "student_id", { label: "MSSV" }),
  field("f_cccdaaaa", "citizen_id", { label: "CCCD", required: false }),
  field("f_dobaaaaa", "date", { label: "Ngày sinh" }),
  field("f_slotaaaa", "multi_choice", { label: "Buổi rảnh", options: ["Sáng", "Chiều", "Tối"] }),
  field("f_secretaa", "short_text", { label: "Ghi chú nội bộ", hidden: true })
];

function seed(status = "published", extra: Record<string, unknown> = {}) {
  db.tables.custom_forms = [
    {
      id: FORM,
      public_code: CODE,
      title: "Tuyển mentee Job Shadowing",
      description: "Giới thiệu",
      program_id: PROGRAM,
      status,
      opens_at: null,
      closes_at: null,
      thank_you: "Cảm ơn bạn!",
      one_per_email: true,
      fields: FIELDS,
      created_at: "2026-10-15T10:00:00Z",
      updated_at: "2026-10-15T10:00:00Z",
      ...extra
    }
  ];
  db.tables.custom_form_responses = [];
  db.tables.outbound_emails = [];
  db.tables.programs = [{ id: PROGRAM, code: "CEP", name: "Career Experience Program" }];
}

const asRole = (role: string | null, status = "active") =>
  vi.mocked(getCurrentAdminUser).mockResolvedValue(role ? ({ id: "admin-1", role, status, email: "a@x.vn" } as any) : null);

const VALID = {
  f_nameaaaa: "  Nguyễn Văn An ",
  f_emailaaa: "An.Nguyen@Gmail.com",
  f_mssvaaaa: "31241028261",
  f_cccdaaaa: "",
  f_dobaaaaa: "05/09/2004",
  f_slotaaaa: ["Tối", "Sáng"],
  f_secretaa: "lén gửi vào trường ẩn",
  f_khonglaa: "mã lạ"
};

beforeEach(() => {
  vi.clearAllMocks();
  db.reset();
  seed();
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fakeClient(db) as any);
  asRole("support_team");
});

describe("1. cổng quyền (fail-closed)", () => {
  it.each([
    ["chưa đăng nhập", null, "active"],
    ["viewer", "viewer", "active"],
    ["reviewer", "reviewer", "active"],
    ["support_team đã ngừng", "support_team", "disabled"]
  ])("%s: không đọc, không ghi gì", async (_name, role, status) => {
    asRole(role, status);
    expect((await listCustomForms()).ok).toBe(false);
    expect((await createCustomForm()).ok).toBe(false);
    expect((await saveCustomForm(FORM, { title: "x" } as CustomFormSavePayload)).ok).toBe(false);
    expect((await setCustomFormStatus(FORM, "closed")).ok).toBe(false);
    expect((await listCustomFormResponses(FORM)).ok).toBe(false);
    expect(db.requests).toEqual([]);
    expect(db.writes).toEqual([]);
  });

  it.each(["support_team", "core_team", "admin", "super_admin"])("%s: xem được danh sách form kèm số câu trả lời và tên chương trình", async (role) => {
    asRole(role);
    db.tables.custom_form_responses = [{ id: "r1", form_id: FORM, answers: {}, created_at: "2026-10-15T11:00:00Z" }];
    const result = await listCustomForms();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.forms.map((f) => [f.title, f.responseCount, f.programName])).toEqual([["Tuyển mentee Job Shadowing", 1, "Career Experience Program"]]);
  });
});

describe("2. tạo, lưu, đổi trạng thái", () => {
  const payload = (over: Partial<CustomFormSavePayload> = {}): CustomFormSavePayload => ({
    title: "Tuyển mentee Job Shadowing 2026",
    description: "Mô tả mới",
    programId: PROGRAM,
    thankYou: "",
    onePerEmail: true,
    autoReply: false,
    autoReplySubject: "",
    autoReplyBody: "",
    opensAt: "2026-10-16T08:00",
    closesAt: "2026-10-20T23:59",
    fields: FIELDS,
    ...over
  });

  it("tạo form: đúng một dòng nháp với ba trường mặc định, ghi người tạo", async () => {
    const result = await createCustomForm();
    expect(result.ok).toBe(true);
    const inserts = db.writes.filter((w) => w.table === "custom_forms");
    expect(inserts).toHaveLength(1);
    expect(inserts[0].kind).toBe("insert");
    expect(inserts[0].rows[0]).toMatchObject({ title: "Form mới", one_per_email: true, created_by: "admin-1", updated_by: "admin-1" });
    expect((inserts[0].rows[0].fields as any[]).map((f) => f.label)).toEqual(["Họ và tên", "Email", "Số điện thoại"]);
  });

  it("lưu: đúng một lệnh update cho đúng form; giờ mở/đóng hiểu theo giờ Việt Nam", async () => {
    db.tables.custom_forms[0].status = "draft";
    const result = await saveCustomForm(FORM, payload());
    expect(result).toEqual({ ok: true, message: "Đã lưu form." });
    const writes = db.writes.filter((w) => w.table === "custom_forms");
    expect(writes).toHaveLength(1);
    expect(writes[0].kind).toBe("update");
    expect(JSON.parse(writes[0].filters)).toEqual([{ kind: "eq", column: "id", value: FORM }]);
    expect(Object.keys(writes[0].rows[0]).sort()).toEqual(
      [
        "auto_reply",
        "auto_reply_body",
        "auto_reply_subject",
        "closes_at",
        "description",
        "event_id",
        "fields",
        "one_per_email",
        "opens_at",
        "program_id",
        "registration_limit",
        "thank_you",
        "title",
        "updated_at",
        "updated_by"
      ].sort()
    );
    expect(writes[0].rows[0]).toMatchObject({
      title: "Tuyển mentee Job Shadowing 2026",
      opens_at: "2026-10-16T01:00:00.000Z",
      closes_at: "2026-10-20T16:59:00.000Z",
      updated_by: "admin-1"
    });
  });

  it("lưu: định nghĩa sai, giờ sai, thiếu Email khi bật một-lần → báo lỗi, KHÔNG ghi gì", async () => {
    expect((await saveCustomForm(FORM, payload({ fields: [{ id: "x", type: "short_text", label: "a" }] }))).ok).toBe(false);
    expect((await saveCustomForm(FORM, payload({ opensAt: "16/10/2026" }))).ok).toBe(false);
    expect((await saveCustomForm(FORM, payload({ fields: [FIELDS[0]] }))).message).toContain("cần một trường Email bắt buộc");
    expect(db.writes).toEqual([]);
  });

  it("form đã có câu trả lời: xoá hay đổi loại câu cũ bị từ chối, KHÔNG ghi; ẩn câu cũ thì lưu được", async () => {
    db.tables.custom_form_responses = [{ id: "r1", form_id: FORM, answers: {}, created_at: "2026-10-15T11:00:00Z" }];
    const without = FIELDS.filter((f) => f.id !== "f_mssvaaaa");
    expect((await saveCustomForm(FORM, payload({ fields: without }))).message).toContain("không xoá được");
    const retyped = FIELDS.map((f) => (f.id === "f_mssvaaaa" ? { ...f, type: "short_text" } : f));
    expect((await saveCustomForm(FORM, payload({ fields: retyped }))).message).toContain("không đổi được loại");
    expect(db.writes).toEqual([]);
    const hidden = FIELDS.map((f) => (f.id === "f_mssvaaaa" ? { ...f, hidden: true } : f));
    expect((await saveCustomForm(FORM, payload({ fields: hidden }))).ok).toBe(true);
    expect(db.writes).toHaveLength(1);
  });

  it("form đang công khai mà ẩn hết câu hỏi: không lưu", async () => {
    const allHidden = FIELDS.map((f) => ({ ...f, hidden: true }));
    expect((await saveCustomForm(FORM, payload({ fields: allHidden, onePerEmail: false }))).message).toContain("chưa có câu hỏi nào");
    expect(db.writes).toEqual([]);
  });

  it("đổi trạng thái: chỉ chạm cột trạng thái; công khai cần câu hỏi; đã có câu trả lời thì không về nháp", async () => {
    db.tables.custom_forms[0].status = "draft";
    expect((await setCustomFormStatus(FORM, "published")).ok).toBe(true);
    const [write] = db.writes;
    expect(Object.keys(write.rows[0]).sort()).toEqual(["status", "updated_at", "updated_by"]);
    expect(write.rows[0].status).toBe("published");
    expect(JSON.parse(write.filters)).toEqual([{ kind: "eq", column: "id", value: FORM }]);

    db.writes.length = 0;
    db.tables.custom_forms[0].status = "draft";
    db.tables.custom_forms[0].fields = [field("f_sectaaaa", "section")];
    db.tables.custom_forms[0].one_per_email = false;
    expect((await setCustomFormStatus(FORM, "published")).ok).toBe(false);
    expect((await setCustomFormStatus(FORM, "xoa")).ok).toBe(false);
    db.tables.custom_forms[0].status = "published";
    db.tables.custom_form_responses = [{ id: "r1", form_id: FORM, answers: {}, created_at: "2026-10-15T11:00:00Z" }];
    expect((await setCustomFormStatus(FORM, "draft")).message).toContain("không đưa về nháp");
    expect(db.writes).toEqual([]);
  });
});

describe("3. gửi công khai /f/<mã>", () => {
  const submit = (values: Record<string, unknown> = VALID, consent: unknown = true, trap: unknown = "", now = NOW) =>
    submitPublicCustomForm(CODE, { values, consent, trap }, now);
  const responseWrites = () => db.writes.filter((w) => w.table === "custom_form_responses");

  it("hợp lệ: đúng MỘT dòng — câu trả lời đã chuẩn hoá, bỏ trường ẩn và mã lạ, có khoá chặn trùng và lúc đồng ý", async () => {
    const result = await submit();
    expect(result).toEqual({ ok: true, message: "Cảm ơn bạn!", errors: {} });
    const writes = responseWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0].kind).toBe("insert");
    expect(writes[0].rows[0]).toEqual({
      form_id: FORM,
      answers: {
        f_nameaaaa: "Nguyễn Văn An",
        f_emailaaa: "an.nguyen@gmail.com",
        f_mssvaaaa: "31241028261",
        f_dobaaaaa: "05/09/2004",
        f_slotaaaa: ["Sáng", "Tối"]
      },
      dedupe_key: "an.nguyen@gmail.com",
      consent_at: new Date(NOW).toISOString()
    });
    expect(db.writes.filter((w) => w.table !== "custom_form_responses")).toEqual([]);
  });

  it("thiếu bắt buộc / sai định dạng: trả lỗi theo từng ô, KHÔNG ghi", async () => {
    const result = await submit({ ...VALID, f_nameaaaa: "", f_mssvaaaa: "123", f_dobaaaaa: "31/02/2004", f_cccdaaaa: "12" });
    expect(result.ok).toBe(false);
    expect(Object.keys(result.errors).sort()).toEqual(["f_cccdaaaa", "f_dobaaaaa", "f_mssvaaaa", "f_nameaaaa"]);
    expect(responseWrites()).toEqual([]);
  });

  it("chưa tích đồng ý: KHÔNG ghi", async () => {
    expect((await submit(VALID, false)).message).toContain("tích ô đồng ý");
    expect((await submit(VALID, "true")).ok).toBe(false);
    expect(responseWrites()).toEqual([]);
  });

  it("ô bẫy có chữ (máy tự điền): báo như đã nhận nhưng KHÔNG ghi", async () => {
    expect((await submit(VALID, true, "http://spam.example")).ok).toBe(true);
    expect(responseWrites()).toEqual([]);
  });

  it("form nháp, đã đóng, chưa tới giờ mở, quá giờ đóng, mã sai: KHÔNG ghi", async () => {
    seed("draft");
    expect((await submit()).ok).toBe(false);
    seed("closed");
    expect((await submit()).message).toContain("đã đóng");
    seed("published", { opens_at: "2026-10-15T13:00:00Z" });
    expect((await submit()).message).toContain("chưa mở");
    seed("published", { closes_at: "2026-10-15T12:00:00Z" });
    expect((await submit()).message).toContain("đã đóng");
    const before = db.requests.length;
    expect((await submitPublicCustomForm("KHONG-HOP-LE", { values: VALID, consent: true, trap: "" }, NOW)).ok).toBe(false);
    expect(db.requests.length).toBe(before);
    expect(responseWrites()).toEqual([]);
  });

  it("email đã gửi (chỉ mục duy nhất từ chối): báo ngay ở ô Email", async () => {
    db.errors["insert:custom_form_responses"] = { code: "23505", message: "duplicate key value" };
    const result = await submit();
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual({ f_emailaaa: "Email này đã gửi form rồi — mỗi email chỉ gửi một lần." });
  });

  it("tắt “mỗi email một lần”: không có khoá chặn trùng", async () => {
    seed("published", { one_per_email: false });
    await submit();
    expect(responseWrites()[0].rows[0].dedupe_key).toBeNull();
  });

  it("trang công khai: không lộ trường ẩn; form nháp không lộ tiêu đề hay câu hỏi", async () => {
    const open = await getPublicCustomForm(CODE, NOW);
    expect(open.state).toBe("ready");
    if (open.state === "ready") {
      expect(open.availability).toBe("open");
      expect(open.fields.map((f) => f.id)).not.toContain("f_secretaa");
      expect(JSON.stringify(open)).not.toContain("Ghi chú nội bộ");
    }
    seed("draft");
    const draft = await getPublicCustomForm(CODE, NOW);
    expect(draft).toEqual({ state: "ready", availability: "draft", title: "", description: "", fields: [], opensAt: null, closesAt: null });
    expect(await getPublicCustomForm("sai", NOW)).toEqual({ state: "invalid" });
  });
});

describe("3b. thư tự động gửi người điền (BTC 15/10/2026)", () => {
  const BODY = "Chào bạn,\n\nBan tổ chức đã nhận đơn Job Shadowing của bạn.";
  const withReply = (extra: Record<string, unknown> = {}) =>
    seed("published", { auto_reply: true, auto_reply_subject: "Đã nhận đơn Job Shadowing", auto_reply_body: BODY, ...extra });
  const submit = (values: Record<string, unknown> = VALID, consent: unknown = true, trap: unknown = "") =>
    submitPublicCustomForm(CODE, { values, consent, trap }, NOW);
  const sentRows = (n: number, extra: Record<string, unknown> = {}) =>
    Array.from({ length: n }, (_, i) => ({ id: `o${i}`, kind: "mentee_session_invite", status: "sent", created_at: new Date(NOW - 3600_000).toISOString(), related_id: null, ...extra }));

  it("bật thư: sau khi GHI xong, gửi đúng MỘT thư tới email người điền (đã chuẩn hoá), đúng form, đúng chữ BTC soạn", async () => {
    withReply();
    expect((await submit()).ok).toBe(true);
    expect(db.writes.filter((w) => w.table === "custom_form_responses")).toHaveLength(1);
    expect(vi.mocked(sendCustomFormReceipt)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendCustomFormReceipt).mock.calls[0][0]).toEqual({
      toEmail: "an.nguyen@gmail.com",
      formId: FORM,
      formTitle: "Tuyển mentee Job Shadowing",
      subject: "Đã nhận đơn Job Shadowing",
      body: BODY
    });
  });

  it("tắt thư, hay lần gửi không được ghi (sai định dạng, thiếu đồng ý, ô bẫy, trùng email): KHÔNG gửi thư", async () => {
    // Tắt thư nhưng tiêu đề và nội dung vẫn còn (BTC soạn rồi bỏ tick): không được gửi.
    seed("published", { auto_reply: false, auto_reply_subject: "Đã nhận", auto_reply_body: BODY });
    expect((await submit()).ok).toBe(true);
    withReply();
    await submit({ ...VALID, f_mssvaaaa: "1" });
    await submit(VALID, false);
    await submit(VALID, true, "bot");
    db.errors["insert:custom_form_responses"] = { code: "23505", message: "duplicate" };
    await submit();
    expect(vi.mocked(sendCustomFormReceipt)).not.toHaveBeenCalled();
  });

  it("chạm trần chung của hệ thống (chừa 40 thư cho thư khác): bỏ qua thư, câu trả lời VẪN được ghi", async () => {
    withReply();
    db.tables.outbound_emails = sentRows(DAILY_EMAIL_LIMIT - 40);
    expect((await submit()).ok).toBe(true);
    expect(db.writes.filter((w) => w.table === "custom_form_responses")).toHaveLength(1);
    expect(vi.mocked(sendCustomFormReceipt)).not.toHaveBeenCalled();
  });

  it("form đã gửi 300 thư tự động trong 24 giờ: bỏ qua thư; thư của form khác hay quá 24 giờ thì không tính", async () => {
    withReply();
    db.tables.outbound_emails = [
      ...sentRows(299, { kind: "custom_form_receipt", related_id: FORM }),
      ...sentRows(50, { kind: "custom_form_receipt", related_id: "99999999-2222-4333-8444-555555555555" }),
      ...sentRows(50, { kind: "custom_form_receipt", related_id: FORM, created_at: new Date(NOW - 25 * 3600_000).toISOString() })
    ].map((r, i) => ({ ...r, id: `o${i}` }));
    await submit();
    expect(vi.mocked(sendCustomFormReceipt)).toHaveBeenCalledTimes(1);
    vi.mocked(sendCustomFormReceipt).mockClear();
    db.tables.outbound_emails.push({ id: "o-them", kind: "custom_form_receipt", status: "sent", created_at: new Date(NOW - 60_000).toISOString(), related_id: FORM });
    await submit({ ...VALID, f_emailaaa: "khac@x.vn" });
    expect(vi.mocked(sendCustomFormReceipt)).not.toHaveBeenCalled();
  });

  it("gửi thư lỗi hay văng: lần gửi form vẫn thành công", async () => {
    withReply();
    vi.mocked(sendCustomFormReceipt).mockRejectedValueOnce(new Error("mạng"));
    expect(await submit()).toEqual({ ok: true, message: "Cảm ơn bạn!", errors: {} });
  });

  it("lưu: bật thư mà chưa có nội dung, hay chưa có trường Email bắt buộc → KHÔNG ghi; đủ thì ghi đúng ba cột thư", async () => {
    const base = {
      title: "Form",
      description: "",
      programId: "",
      thankYou: "",
      onePerEmail: false,
      opensAt: "",
      closesAt: "",
      fields: FIELDS
    };
    expect((await saveCustomForm(FORM, { ...base, autoReply: true, autoReplySubject: "", autoReplyBody: "  " })).message).toContain("chưa có nội dung");
    expect((await saveCustomForm(FORM, { ...base, autoReply: true, autoReplySubject: "", autoReplyBody: BODY, fields: [FIELDS[0]] })).message).toContain(
      "trường Email bắt buộc"
    );
    expect(db.writes).toEqual([]);
    expect((await saveCustomForm(FORM, { ...base, autoReply: true, autoReplySubject: " Đã nhận ", autoReplyBody: `${BODY}\r\n` })).ok).toBe(true);
    expect(db.writes[0].rows[0]).toMatchObject({ auto_reply: true, auto_reply_subject: "Đã nhận", auto_reply_body: BODY });
  });

  it("gửi thử: tới email của CHÍNH người bấm, đánh dấu thư thử, dùng chữ đang trên trang; không quyền hay thiếu nội dung → không gửi", async () => {
    const result = await sendCustomFormReceiptTest(FORM, { subject: "Tiêu đề nháp", body: "Nội dung nháp" });
    expect(result).toEqual({ ok: true, message: "Đã gửi thư thử tới a@x.vn." });
    expect(vi.mocked(sendCustomFormReceipt).mock.calls[0][0]).toEqual({
      toEmail: "a@x.vn",
      formId: FORM,
      formTitle: "Tuyển mentee Job Shadowing",
      subject: "Tiêu đề nháp",
      body: "Nội dung nháp",
      test: true
    });
    vi.mocked(sendCustomFormReceipt).mockClear();
    expect((await sendCustomFormReceiptTest(FORM, { subject: "", body: "  " })).ok).toBe(false);
    asRole("viewer");
    expect((await sendCustomFormReceiptTest(FORM, { subject: "", body: "x" })).ok).toBe(false);
    expect(vi.mocked(sendCustomFormReceipt)).not.toHaveBeenCalled();
  });
});

describe("4. xem câu trả lời", () => {
  it("mới nhất trước, chỉ của đúng form", async () => {
    db.tables.custom_form_responses = [
      { id: "r1", form_id: FORM, answers: { f_nameaaaa: "Cũ" }, created_at: "2026-10-15T10:00:00Z" },
      { id: "r2", form_id: FORM, answers: { f_nameaaaa: "Mới" }, created_at: "2026-10-15T11:00:00Z" },
      { id: "r3", form_id: "99999999-2222-4333-8444-555555555555", answers: { f_nameaaaa: "Form khác" }, created_at: "2026-10-15T11:30:00Z" }
    ];
    const result = await listCustomFormResponses(FORM);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.responses.map((r) => r.answers.f_nameaaaa)).toEqual(["Mới", "Cũ"]);
  });
});
