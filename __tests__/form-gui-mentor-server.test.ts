/**
 * "Tự động gửi Submission cho Mentor" (VAM00011) — luồng máy chủ, trên bản giả PostgREST.
 *
 * Tính năng này đưa dữ liệu mentee ra khỏi hệ thống, nên hai loại lời hứa nặng ngang nhau:
 *   - đúng người: chỉ mentor của cặp active, đúng mùa, của người có đúng email đó; mơ hồ thì không gửi;
 *   - đúng số lần: chạy lại, chạy song song, đổi mentor đều không có lá thứ hai;
 * và tắt tính năng thì không một lệnh nào chạm tới bảng mới. Khẳng định chính các lệnh ghi và lời gọi gửi
 * thư, không chỉ giá trị trả về.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DAILY_EMAIL_LIMIT } from "@/lib/email-quota-core";
import { createFakeDb, fakeClient } from "./support/fake-postgrest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn(), getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/email", () => ({
  sendCustomFormReceipt: vi.fn(async () => ({ ok: true, skipped: false })),
  sendCustomFormMentorSubmission: vi.fn(async () => ({ ok: true, skipped: false }))
}));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { sendCustomFormMentorSubmission } from "@/lib/email";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { runMentorForwardSweep } from "@/lib/custom-form-mentor";
import { MENTOR_SEND_BATCH, MENTOR_SEND_MAX_ATTEMPTS } from "@/lib/custom-form-mentor-core";
import { listCustomFormMentorSends, saveCustomForm, sendCustomFormMentorTest, sendPendingMentorForwards, submitPublicCustomForm } from "@/lib/custom-forms";
import type { CustomFormSavePayload } from "@/lib/custom-form-action-types";

const db = createFakeDb();
const mail = vi.mocked(sendCustomFormMentorSubmission);
const FORM = "11111111-2222-4333-8444-555555555555";
const CODE = "a1b2c3d4e5f6";
const SEASON = "aaaaaaaa-0000-4000-8000-000000000001";
const OLD_SEASON = "aaaaaaaa-0000-4000-8000-000000000002";
const MENTEE = "bbbbbbbb-0000-4000-8000-000000000001";
const OTHER_MENTEE = "bbbbbbbb-0000-4000-8000-000000000002";
const MENTOR = "cccccccc-0000-4000-8000-000000000001";
const OTHER_MENTOR = "cccccccc-0000-4000-8000-000000000002";
const NOW = Date.parse("2026-11-01T05:00:00Z");
const ENABLED_AT = "2026-11-01T01:00:00.000Z";

const field = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, label: `Câu ${id}`, help: "", required: true, hidden: false, options: [], ...extra });
const FIELDS = [
  field("f_nameaaaa", "short_text", { label: "Họ và tên" }),
  field("f_emailaaa", "email", { label: "Email" }),
  field("f_goalaaaa", "long_text", { label: "Mục tiêu" }),
  field("f_secretaa", "short_text", { label: "Ghi chú nội bộ", hidden: true, required: false })
];
const SEND = "custom_form_mentor_sends";

function seed(extra: Record<string, unknown> = {}) {
  db.tables.custom_forms = [
    {
      id: FORM,
      public_code: CODE,
      title: "Mục tiêu đầu kỳ",
      status: "published",
      opens_at: null,
      closes_at: null,
      thank_you: "Cảm ơn bạn!",
      one_per_email: true,
      auto_reply: false,
      fields: FIELDS,
      event_id: null,
      registration_limit: null,
      require_known_person: false,
      mentor_forward: true,
      mentor_forward_subject: "Mentee của anh/chị vừa gửi form",
      mentor_forward_body: "Kính gửi anh/chị,",
      mentor_forward_since: ENABLED_AT,
      created_at: "2026-10-30T10:00:00Z",
      updated_at: "2026-10-30T10:00:00Z",
      ...extra
    }
  ];
  db.tables.custom_form_responses = [];
  db.tables[SEND] = [];
  db.tables.outbound_emails = [];
  db.tables.seasons = [{ id: SEASON, code: "UEHM-S12" }];
  db.tables.people = [
    { id: MENTEE, full_name: "Nguyễn Văn An", email_primary: "an.nguyen@gmail.com" },
    { id: OTHER_MENTEE, full_name: "Nguyễn Văn An", email_primary: "an.khac@gmail.com" },
    { id: MENTOR, full_name: "Trần Mentor", email_primary: "mentor@vam.vn" },
    { id: OTHER_MENTOR, full_name: "Lê Mentor Khác", email_primary: "mentor.khac@vam.vn" }
  ];
  db.tables.matches = [];
}

const pair = (mentee: string, mentor: string, extra: Record<string, unknown> = {}) => {
  const row = { id: `match-${db.tables.matches.length + 1}`, season_id: SEASON, mentee_person_id: mentee, mentor_person_id: mentor, status: "active", ...extra };
  db.tables.matches.push(row);
  return row;
};
const submit = (email = "An.Nguyen@Gmail.com", name = "Nguyễn Văn An") =>
  submitPublicCustomForm(CODE, { values: { f_nameaaaa: name, f_emailaaa: email, f_goalaaaa: "Học phân tích dữ liệu", f_secretaa: "lén" }, consent: true, trap: "" }, NOW);
const sends = () => db.tables[SEND];
const sendWrites = () => db.writes.filter((w) => w.table === SEND);
const responseRow = (id: string, created = "2026-11-01T02:00:00.000Z") => ({
  id,
  form_id: FORM,
  created_at: created,
  answers: { f_nameaaaa: "Nguyễn Văn An", f_emailaaa: "an.nguyen@gmail.com", f_goalaaaa: "Mục tiêu", f_secretaa: "cũ" }
});
const sendRow = (id: string, responseId: string, extra: Record<string, unknown> = {}) => ({
  id,
  response_id: responseId,
  form_id: FORM,
  mentee_email: "an.nguyen@gmail.com",
  mentee_person_id: MENTEE,
  mentor_person_id: null,
  match_id: null,
  status: "cho_ghep_cap",
  attempts: 0,
  last_error: null,
  claimed_at: null,
  sent_at: null,
  ...extra
});
const queued = (extra: Record<string, unknown> = {}) => {
  db.tables.custom_form_responses.push(responseRow("r-1"));
  db.tables[SEND].push(sendRow("s-1", "r-1", extra));
};
const asRole = (role: string | null) => vi.mocked(getCurrentAdminUser).mockResolvedValue(role ? ({ id: "admin-1", role, status: "active", email: "btc@vam.vn" } as any) : null);

beforeEach(() => {
  vi.clearAllMocks();
  db.reset();
  seed();
  mail.mockResolvedValue({ ok: true, skipped: false } as any);
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fakeClient(db) as any);
  asRole("support_team");
});

describe("1. mentee đã có mentor", () => {
  it("lưu câu trả lời TRƯỚC, rồi gửi đúng mentor kèm câu trả lời, và ghi đã gửi", async () => {
    const match = pair(MENTEE, MENTOR);
    const result = await submit();
    expect(result.ok).toBe(true);
    expect(mail).toHaveBeenCalledTimes(1);
    const sent = mail.mock.calls[0][0];
    expect(sent).toMatchObject({ toEmail: "mentor@vam.vn", sendId: sends()[0].id, formId: FORM, subject: "Mentee của anh/chị vừa gửi form", body: "Kính gửi anh/chị,", menteeName: "Nguyễn Văn An" });
    expect(sent.answers).toEqual([
      { label: "Họ và tên", value: "Nguyễn Văn An" },
      { label: "Email", value: "an.nguyen@gmail.com" },
      { label: "Mục tiêu", value: "Học phân tích dữ liệu" }
    ]);
    expect(sends()).toHaveLength(1);
    expect(sends()[0]).toMatchObject({ status: "da_gui", mentee_person_id: MENTEE, mentor_person_id: MENTOR, match_id: match.id, claimed_at: null });
    expect(sends()[0].sent_at).toBeTruthy();
    const order = db.writes.map((w) => w.table);
    expect(order.indexOf("custom_form_responses")).toBeLessThan(order.indexOf(SEND));
  });

  it("chiếm dòng TRƯỚC khi gửi: lúc thư đi, dòng đang ở dang_gui", async () => {
    pair(MENTEE, MENTOR);
    let during = "";
    mail.mockImplementation(async () => {
      during = sends()[0].status;
      return { ok: true, skipped: false } as any;
    });
    await submit();
    expect(during).toBe("dang_gui");
  });

  it("form có giới hạn số đăng ký (ghi qua RPC): vẫn gửi theo id RPC trả về", async () => {
    seed({ registration_limit: 10 });
    pair(MENTEE, MENTOR);
    db.tables.custom_form_responses.push(responseRow("r-rpc"));
    const rpc = vi.fn(async () => ({ data: { status: "inserted", id: "r-rpc" }, error: null }));
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fakeClient(db, { rpc }) as any);
    expect((await submit()).ok).toBe(true);
    expect(sends()[0]).toMatchObject({ response_id: "r-rpc", status: "da_gui" });
  });
});

describe("2. mentee chưa có mentor, ghép cặp sau đó", () => {
  it("lưu 'Chờ ghép cặp', chưa gửi; ghép xong quét thì gửi đúng bản đã lưu tới mentor mới", async () => {
    expect((await submit()).ok).toBe(true);
    expect(mail).not.toHaveBeenCalled();
    expect(sends()[0]).toMatchObject({ status: "cho_ghep_cap", mentee_person_id: MENTEE });
    expect(sends()[0].mentor_person_id ?? null).toBeNull();

    const stored = db.tables.custom_form_responses[0];
    stored.created_at = "2026-11-01T04:00:00.000Z";
    pair(MENTEE, MENTOR);
    const result = await runMentorForwardSweep(NOW + 3600_000);
    expect(result).toMatchObject({ ok: true, counts: { sent: 1 } });
    expect(mail).toHaveBeenCalledTimes(1);
    expect(mail.mock.calls[0][0]).toMatchObject({ toEmail: "mentor@vam.vn", sendId: sends()[0].id });
    expect(mail.mock.calls[0][0].answers).toContainEqual({ label: "Mục tiêu", value: "Học phân tích dữ liệu" });
    expect(sends()[0]).toMatchObject({ status: "da_gui", mentor_person_id: MENTOR });
  });

  it("quét hai lần không gửi trùng, và lần sau không ghi gì lên dòng đã gửi", async () => {
    queued();
    pair(MENTEE, MENTOR);
    await runMentorForwardSweep(NOW);
    const before = sendWrites().length;
    const again = await runMentorForwardSweep(NOW + 1000);
    expect(mail).toHaveBeenCalledTimes(1);
    expect(again.counts).toMatchObject({ sent: 0 });
    expect(sendWrites()).toHaveLength(before);
  });

  it("hai lượt quét chạy song song: chỉ một lượt chiếm được, một lá thư", async () => {
    queued();
    pair(MENTEE, MENTOR);
    const [a, b] = await Promise.all([runMentorForwardSweep(NOW), runMentorForwardSweep(NOW)]);
    expect(mail).toHaveBeenCalledTimes(1);
    expect(a.counts.sent + b.counts.sent).toBe(1);
  });

  it("đang gửi mà lượt khác chạy: lượt đó không gửi lại", async () => {
    queued();
    pair(MENTEE, MENTOR);
    let inner: Awaited<ReturnType<typeof runMentorForwardSweep>> | null = null;
    mail.mockImplementationOnce(async () => {
      inner = await runMentorForwardSweep(NOW);
      return { ok: true, skipped: false } as any;
    });
    await runMentorForwardSweep(NOW);
    expect(mail).toHaveBeenCalledTimes(1);
    expect(inner).toMatchObject({ counts: { sent: 0 } });
  });

  it("chưa có cặp: quét không ghi gì, không tạo việc giả", async () => {
    queued();
    const before = sendWrites().length;
    const result = await runMentorForwardSweep(NOW);
    expect(result.counts.waiting).toBe(1);
    expect(sendWrites()).toHaveLength(before);
    expect(mail).not.toHaveBeenCalled();
  });

  it("đã gửi rồi mentee đổi mentor: mentor mới KHÔNG nhận lại (lựa chọn đã ghi trong PR)", async () => {
    queued({ status: "da_gui", mentor_person_id: MENTOR, sent_at: ENABLED_AT });
    pair(MENTEE, OTHER_MENTOR);
    await runMentorForwardSweep(NOW);
    expect(mail).not.toHaveBeenCalled();
    expect(sends()[0].mentor_person_id).toBe(MENTOR);
  });

  it("bản đang chờ mang đúng câu trả lời của nó, không lẫn bản khác", async () => {
    db.tables.custom_form_responses.push(responseRow("r-1", "2026-11-01T02:00:00.000Z"));
    db.tables.custom_form_responses.push({ ...responseRow("r-2", "2026-11-01T03:00:00.000Z"), answers: { f_goalaaaa: "Bản của người khác", f_nameaaaa: "Khác" } });
    db.tables[SEND].push(sendRow("s-1", "r-1"), sendRow("s-2", "r-2", { mentee_person_id: OTHER_MENTEE, mentee_email: "an.khac@gmail.com" }));
    pair(MENTEE, MENTOR);
    pair(OTHER_MENTEE, OTHER_MENTOR);
    await runMentorForwardSweep(NOW);
    expect(mail).toHaveBeenCalledTimes(2);
    const to = (email: string) => mail.mock.calls.map((c) => c[0]).find((c) => c.toEmail === email);
    expect(to("mentor@vam.vn")).toMatchObject({ sendId: "s-1" });
    expect(to("mentor@vam.vn")?.answers).toContainEqual({ label: "Mục tiêu", value: "Mục tiêu" });
    expect(to("mentor.khac@vam.vn")).toMatchObject({ sendId: "s-2" });
    expect(to("mentor.khac@vam.vn")?.answers).toContainEqual({ label: "Mục tiêu", value: "Bản của người khác" });
  });
});

describe("3. đúng mentor, không bao giờ mentor khác", () => {
  it("trùng tên với mentee đã ghép cặp: email khác thì KHÔNG nhận mentor của người kia", async () => {
    pair(OTHER_MENTEE, OTHER_MENTOR);
    await submit("nguoi.la@gmail.com", "Nguyễn Văn An");
    expect(mail).not.toHaveBeenCalled();
    expect(sends()[0].status).toBe("khong_nhan_ra");
    expect(sends()[0].mentee_person_id ?? null).toBeNull();
    expect(sends()[0].mentor_person_id ?? null).toBeNull();
  });

  it("cặp ở mùa khác, cặp đã kết thúc: không tính", async () => {
    pair(MENTEE, OTHER_MENTOR, { season_id: OLD_SEASON });
    pair(MENTEE, OTHER_MENTOR, { status: "dropped" });
    await submit();
    expect(mail).not.toHaveBeenCalled();
    expect(sends()[0].status).toBe("cho_ghep_cap");
  });

  it("cặp active của mùa cũ không lọt vào lượt quét", async () => {
    queued();
    pair(MENTEE, OTHER_MENTOR, { season_id: OLD_SEASON });
    await runMentorForwardSweep(NOW);
    expect(mail).not.toHaveBeenCalled();
  });

  it("ký tự đại diện trong email không khớp nhầm người khác", async () => {
    db.tables.people.push({ id: "p-wild", full_name: "X", email_primary: "a_b@vam.vn" }, { id: "p-axb", full_name: "Y", email_primary: "axb@vam.vn" });
    pair("p-axb", OTHER_MENTOR);
    await submit("a_b@vam.vn", "X");
    expect(mail).not.toHaveBeenCalled();
    expect(sends()[0].mentee_person_id).toBe("p-wild");
  });

  it("hai hồ sơ cùng email: không đoán, ghi không nhận ra", async () => {
    db.tables.people.push({ id: "p-dup", full_name: "Trùng", email_primary: "AN.NGUYEN@gmail.com" });
    pair(MENTEE, MENTOR);
    await submit();
    expect(mail).not.toHaveBeenCalled();
    expect(sends()[0].status).toBe("khong_nhan_ra");
    expect(sends()[0].last_error).toContain("nhiều hồ sơ");
  });

  it("mentee có hai mentor active: không gửi cho ai, BTC thấy lỗi; sửa cặp xong thì đi đúng mentor", async () => {
    const stale = pair(MENTEE, OTHER_MENTOR);
    pair(MENTEE, MENTOR);
    await submit();
    expect(mail).not.toHaveBeenCalled();
    expect(sends()[0].status).toBe("loi");
    expect(sends()[0].last_error).toContain("2 mentor");
    stale.status = "dropped";
    db.tables.custom_form_responses[0].created_at = "2026-11-01T04:00:00.000Z";
    await runMentorForwardSweep(NOW);
    expect(mail).toHaveBeenCalledTimes(1);
    expect(mail.mock.calls[0][0].toEmail).toBe("mentor@vam.vn");
  });

  it("mentor chưa có email: ghi lỗi, không gửi", async () => {
    db.tables.people.find((p) => p.id === MENTOR).email_primary = null;
    pair(MENTEE, MENTOR);
    await submit();
    expect(mail).not.toHaveBeenCalled();
    expect(sends()[0]).toMatchObject({ status: "loi", last_error: "Mentor chưa có email trên hệ thống." });
  });

  it("câu đã ẩn không vào thư, kể cả với câu trả lời lưu trước lúc ẩn", async () => {
    queued();
    pair(MENTEE, MENTOR);
    await runMentorForwardSweep(NOW);
    expect(JSON.stringify(mail.mock.calls[0][0].answers)).not.toContain("Ghi chú nội bộ");
    expect(JSON.stringify(mail.mock.calls[0][0].answers)).not.toContain("cũ");
  });
});

describe("4. lỗi không làm hỏng lần gửi form, và không gửi bừa", () => {
  it("nhà cung cấp báo lỗi: form vẫn nhận, dòng Lỗi; quét thử lại rồi thành công", async () => {
    pair(MENTEE, MENTOR);
    mail.mockResolvedValueOnce({ ok: false, skipped: false, reason: "Brevo 500" } as any);
    const result = await submit();
    expect(result).toMatchObject({ ok: true, message: "Cảm ơn bạn!" });
    expect(db.tables.custom_form_responses).toHaveLength(1);
    expect(sends()[0]).toMatchObject({ status: "loi", attempts: 1, last_error: "Brevo 500", claimed_at: null });
    db.tables.custom_form_responses[0].created_at = "2026-11-01T04:00:00.000Z";
    await runMentorForwardSweep(NOW);
    expect(mail).toHaveBeenCalledTimes(2);
    expect(sends()[0].status).toBe("da_gui");
  });

  it("hàm gửi ném lỗi: form vẫn nhận, dòng không kẹt ở đang gửi", async () => {
    pair(MENTEE, MENTOR);
    mail.mockRejectedValueOnce(new Error("mạng"));
    expect((await submit()).ok).toBe(true);
    expect(sends()[0]).toMatchObject({ status: "loi", attempts: 1 });
  });

  it("lỗi quá số lần thử thì dừng tự gửi", async () => {
    queued({ status: "loi", attempts: MENTOR_SEND_MAX_ATTEMPTS, last_error: "x" });
    pair(MENTEE, MENTOR);
    await runMentorForwardSweep(NOW);
    expect(mail).not.toHaveBeenCalled();
  });

  it.each(["matches", "people", "seasons"])("đọc %s lỗi lúc gửi form: form vẫn nhận, không gửi thư", async (table) => {
    pair(MENTEE, MENTOR);
    db.errors[table] = { message: "hỏng" };
    expect((await submit()).ok).toBe(true);
    expect(mail).not.toHaveBeenCalled();
    expect(sends()[0].status === "da_gui").toBe(false);
  });

  it("đọc cặp lỗi lúc quét: lượt báo lỗi, không gửi, dòng còn nguyên để lần sau", async () => {
    queued();
    pair(MENTEE, MENTOR);
    db.errors.matches = { message: "hỏng" };
    const result = await runMentorForwardSweep(NOW);
    expect(result.ok).toBe(false);
    expect(mail).not.toHaveBeenCalled();
    expect(sends()[0].status).toBe("cho_ghep_cap");
  });

  it("ghi dòng theo dõi lỗi: form vẫn nhận; lượt quét nhặt lại nhờ mốc bật", async () => {
    pair(MENTEE, MENTOR);
    db.errors[`insert:${SEND}`] = { message: "hỏng" };
    expect((await submit()).ok).toBe(true);
    expect(mail).not.toHaveBeenCalled();
    delete db.errors[`insert:${SEND}`];
    db.tables.custom_form_responses[0].created_at = "2026-11-01T04:00:00.000Z";
    await runMentorForwardSweep(NOW);
    expect(mail).toHaveBeenCalledTimes(1);
    expect(sends()[0].status).toBe("da_gui");
  });

  it("câu trả lời TRƯỚC mốc bật không bao giờ bị lượt quét nhặt lên", async () => {
    db.tables.custom_form_responses.push(responseRow("r-cu", "2026-10-31T23:59:00.000Z"));
    pair(MENTEE, MENTOR);
    await runMentorForwardSweep(NOW);
    expect(mail).not.toHaveBeenCalled();
    expect(sendWrites()).toEqual([]);
  });

  it("chiếm dòng lỗi: không gửi", async () => {
    pair(MENTEE, MENTOR);
    db.errors[`update:${SEND}`] = { message: "hỏng" };
    expect((await submit()).ok).toBe(true);
    expect(mail).not.toHaveBeenCalled();
  });

  it("môi trường tắt thư: dòng về như cũ, không ghi đã gửi", async () => {
    queued();
    pair(MENTEE, MENTOR);
    mail.mockResolvedValue({ ok: true, skipped: true, reason: "tắt" } as any);
    const result = await runMentorForwardSweep(NOW);
    expect(result.stop).toBe("mail_off");
    expect(sends()[0]).toMatchObject({ status: "cho_ghep_cap", claimed_at: null, sent_at: null });
  });

  it("tiến trình chết giữa chừng, sổ thư ghi đã gửi: chốt đã gửi, không gửi lại", async () => {
    queued({ status: "dang_gui", claimed_at: new Date(NOW - 3600_000).toISOString(), mentor_person_id: MENTOR });
    db.tables.outbound_emails.push({ id: "o1", kind: "custom_form_mentor_submission", related_id: "s-1", status: "sent", created_at: new Date(NOW).toISOString() });
    pair(MENTEE, MENTOR);
    await runMentorForwardSweep(NOW);
    expect(mail).not.toHaveBeenCalled();
    expect(sends()[0]).toMatchObject({ status: "da_gui", claimed_at: null });
  });

  it("tiến trình chết giữa chừng, không rõ thư đi chưa: dừng ở Lỗi cho BTC, không tự gửi lại", async () => {
    queued({ status: "dang_gui", claimed_at: new Date(NOW - 3600_000).toISOString() });
    pair(MENTEE, MENTOR);
    await runMentorForwardSweep(NOW);
    await runMentorForwardSweep(NOW + 1000);
    expect(mail).not.toHaveBeenCalled();
    expect(sends()[0]).toMatchObject({ status: "loi", attempts: MENTOR_SEND_MAX_ATTEMPTS });
  });

  it("dòng đang gửi chưa quá hạn: không đụng", async () => {
    queued({ status: "dang_gui", claimed_at: new Date(NOW - 60_000).toISOString() });
    pair(MENTEE, MENTOR);
    await runMentorForwardSweep(NOW);
    expect(sends()[0].status).toBe("dang_gui");
  });
});

describe("5. hạn mức", () => {
  const sentRows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `o${i}`, kind: "x", status: "sent", created_at: new Date(NOW - 60_000).toISOString() }));

  it("sát trần chung: không gửi, dòng còn chờ để lượt sau", async () => {
    queued();
    pair(MENTEE, MENTOR);
    db.tables.outbound_emails = sentRows(DAILY_EMAIL_LIMIT - 40);
    const result = await runMentorForwardSweep(NOW);
    expect(result.stop).toBe("quota");
    expect(mail).not.toHaveBeenCalled();
    expect(sends()[0].status).toBe("cho_ghep_cap");
  });

  it("không đếm được thư đã gửi: coi như hết hạn mức", async () => {
    queued();
    pair(MENTEE, MENTOR);
    db.errors.outbound_emails = { message: "hỏng" };
    await runMentorForwardSweep(NOW);
    expect(mail).not.toHaveBeenCalled();
  });

  it("chạm trần riêng của form: không gửi", async () => {
    queued();
    pair(MENTEE, MENTOR);
    for (let i = 0; i < 300; i += 1) db.tables[SEND].push(sendRow(`done-${i}`, `rr-${i}`, { status: "da_gui", sent_at: new Date(NOW - 60_000).toISOString() }));
    await runMentorForwardSweep(NOW);
    expect(mail).not.toHaveBeenCalled();
  });

  it("một lượt gửi tối đa MENTOR_SEND_BATCH thư, phần còn lại để lượt sau", async () => {
    for (let i = 0; i < MENTOR_SEND_BATCH + 5; i += 1) {
      db.tables.custom_form_responses.push(responseRow(`r-${i}`));
      db.tables[SEND].push(sendRow(`s-${i}`, `r-${i}`));
    }
    pair(MENTEE, MENTOR);
    const result = await runMentorForwardSweep(NOW);
    expect(mail).toHaveBeenCalledTimes(MENTOR_SEND_BATCH);
    expect(result.stop).toBe("batch");
  });
});

describe("6. tắt tính năng", () => {
  beforeEach(() => seed({ mentor_forward: false, mentor_forward_since: null }));

  it("gửi form không chạm bảng theo dõi, không tra người hay cặp", async () => {
    pair(MENTEE, MENTOR);
    expect((await submit()).ok).toBe(true);
    expect(mail).not.toHaveBeenCalled();
    expect(sendWrites()).toEqual([]);
    expect(db.requests.filter((r) => [SEND, "matches", "people", "seasons"].includes(r.table))).toEqual([]);
  });

  it("form có giới hạn đăng ký (RPC trả id): tắt vẫn không chạm bảng theo dõi", async () => {
    seed({ mentor_forward: false, mentor_forward_since: null, registration_limit: 10 });
    pair(MENTEE, MENTOR);
    const rpc = vi.fn(async () => ({ data: { status: "inserted", id: "r-rpc" }, error: null }));
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fakeClient(db, { rpc }) as any);
    expect((await submit()).ok).toBe(true);
    expect(mail).not.toHaveBeenCalled();
    expect(sendWrites()).toEqual([]);
  });

  it("bản đang chờ không gửi nữa, cả cron lẫn nút bấm", async () => {
    queued();
    pair(MENTEE, MENTOR);
    expect(await runMentorForwardSweep(NOW)).toMatchObject({ ok: true, counts: { sent: 0 } });
    const button = await sendPendingMentorForwards(FORM);
    expect(button.ok).toBe(false);
    expect(button.message).toContain("đang tắt");
    expect(mail).not.toHaveBeenCalled();
    expect(sends()[0].status).toBe("cho_ghep_cap");
  });
});

describe("7. form gắn sự kiện", () => {
  it("cờ bật lọt vào form gắn sự kiện: lượt quét bỏ qua, không gửi", async () => {
    seed({ event_id: "99999999-2222-4333-8444-555555555555" });
    queued();
    pair(MENTEE, MENTOR);
    await runMentorForwardSweep(NOW);
    expect(mail).not.toHaveBeenCalled();
  });
});

describe("8. lưu form và mốc bật", () => {
  const payload = (over: Partial<CustomFormSavePayload> = {}): CustomFormSavePayload =>
    ({
      title: "Form",
      description: "",
      programId: "",
      thankYou: "",
      onePerEmail: true,
      autoReply: false,
      autoReplySubject: "",
      autoReplyBody: "",
      opensAt: "",
      closesAt: "",
      fields: FIELDS,
      mentorForward: true,
      mentorForwardSubject: "Tiêu đề",
      mentorForwardBody: "Nội dung",
      ...over
    }) as CustomFormSavePayload;
  const patch = () => db.writes.filter((w) => w.table === "custom_forms" && w.kind === "update").at(-1)?.rows[0];

  it("bật lần đầu đặt mốc mới; lưu tiếp giữ mốc; tắt xoá mốc", async () => {
    seed({ mentor_forward: false, mentor_forward_since: null });
    expect((await saveCustomForm(FORM, payload())).ok).toBe(true);
    expect(patch()).toMatchObject({ mentor_forward: true, mentor_forward_subject: "Tiêu đề", mentor_forward_body: "Nội dung" });
    expect(patch().mentor_forward_since).toBeTruthy();
    seed({ mentor_forward: true, mentor_forward_since: ENABLED_AT });
    await saveCustomForm(FORM, payload());
    expect(patch().mentor_forward_since).toBe(ENABLED_AT);
    await saveCustomForm(FORM, payload({ mentorForward: false }));
    expect(patch()).toMatchObject({ mentor_forward: false, mentor_forward_since: null });
  });

  it("gửi lên không có tùy chọn = tắt (mặc định TẮT)", async () => {
    seed({ mentor_forward: false, mentor_forward_since: null });
    const { mentorForward: _a, mentorForwardSubject: _b, mentorForwardBody: _c, ...old } = payload();
    await saveCustomForm(FORM, old as CustomFormSavePayload);
    expect(patch()).toMatchObject({ mentor_forward: false, mentor_forward_since: null });
  });

  it("bật mà thiếu nội dung, thiếu Email, hoặc gắn sự kiện: không ghi gì", async () => {
    seed({ mentor_forward: false, mentor_forward_since: null });
    expect((await saveCustomForm(FORM, payload({ mentorForwardBody: "  " }))).ok).toBe(false);
    expect((await saveCustomForm(FORM, payload({ onePerEmail: false, fields: [FIELDS[0]] }))).ok).toBe(false);
    expect((await saveCustomForm(FORM, payload({ eventId: "99999999-2222-4333-8444-555555555555" }))).ok).toBe(false);
    expect(db.writes.filter((w) => w.table === "custom_forms")).toEqual([]);
  });
});

describe("9. cổng quyền của nút bấm, thư thử, trạng thái", () => {
  it.each([null, "viewer", "reviewer"])("%s: không quét, không đọc, không gửi", async (role) => {
    asRole(role);
    queued();
    pair(MENTEE, MENTOR);
    expect((await sendPendingMentorForwards(FORM)).ok).toBe(false);
    expect((await listCustomFormMentorSends(FORM)).ok).toBe(false);
    expect((await sendCustomFormMentorTest(FORM, { subject: "", body: "x" })).ok).toBe(false);
    expect(mail).not.toHaveBeenCalled();
    expect(db.requests).toEqual([]);
    expect(db.writes).toEqual([]);
  });

  it("nút bấm gửi các bản chờ và xét lại bản không nhận ra sau khi BTC sửa email; cron thì không", async () => {
    db.tables.custom_form_responses.push(responseRow("r-1"));
    db.tables[SEND].push(sendRow("s-1", "r-1", { status: "khong_nhan_ra", mentee_person_id: null, last_error: "Email không khớp hồ sơ nào trên hệ thống." }));
    pair(MENTEE, MENTOR);
    await runMentorForwardSweep(NOW);
    expect(mail).not.toHaveBeenCalled();
    const result = await sendPendingMentorForwards(FORM);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Đã gửi 1 bản");
    expect(mail).toHaveBeenCalledTimes(1);
    expect(sends()[0]).toMatchObject({ status: "da_gui", mentee_person_id: MENTEE, last_error: null });
  });

  it("thư thử đi tới người bấm, chữ giữ chỗ, không chạm sổ gửi và không có câu đã ẩn", async () => {
    const result = await sendCustomFormMentorTest(FORM, { subject: "T", body: "N" });
    expect(result.ok).toBe(true);
    const sent = mail.mock.calls[0][0];
    expect(sent).toMatchObject({ toEmail: "btc@vam.vn", test: true, subject: "T", body: "N" });
    expect(sent.sendId).toBeUndefined();
    expect(sent.answers.map((a) => a.label)).toEqual(["Họ và tên", "Email", "Mục tiêu"]);
    expect(sendWrites()).toEqual([]);
  });

  it("bảng trạng thái có tên mentor", async () => {
    queued({ status: "da_gui", mentor_person_id: MENTOR, sent_at: ENABLED_AT });
    const result = await listCustomFormMentorSends(FORM);
    expect(result).toEqual({ ok: true, data: [{ responseId: "r-1", status: "da_gui", mentorName: "Trần Mentor", sentAt: ENABLED_AT, lastError: null }] });
  });
});
