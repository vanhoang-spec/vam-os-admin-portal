/**
 * Form tùy chỉnh ↔ Sự kiện — máy chủ (đề xuất VAM00008, 30/10/2026), trên bản giả PostgREST.
 *
 * Khẳng định CHÍNH các lệnh ghi:
 *   - gửi lần đầu → một đăng ký sự kiện (qua hàm khoá chỗ), một câu trả lời nối sang nó, một thư xác
 *     nhận kèm vé của SỰ KIỆN; không có thư tự động của form;
 *   - gửi lại cùng email + cùng họ tên → cập nhật bản cũ, không đăng ký mới, không gửi lại thư/QR,
 *     không chạm trạng thái chỗ/vé;
 *   - cùng email + khác họ tên → không ghi đè gì, chỉ một dòng cảnh báo; người điền thấy lời cảm ơn;
 *   - đăng ký cũ đã huỷ → xin lại chỗ;
 *   - email đã đăng ký bằng form Sự kiện → cùng tên thì nhận về form này, khác tên thì cảnh báo;
 *   - sự kiện đủ chỗ / form đủ giới hạn / sự kiện huỷ → báo đúng câu, không ghi câu trả lời;
 *   - lưu form: sự kiện thu phí không gắn được, đổi sự kiện khi đã có câu trả lời bị chặn.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, fakeClient } from "./support/fake-postgrest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn(), getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendCustomFormReceipt: vi.fn(async () => ({ ok: true, skipped: false })) }));
vi.mock("@/lib/events", () => ({ issueTicketAndConfirm: vi.fn(async () => undefined) }));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { sendCustomFormReceipt } from "@/lib/email";
import { issueTicketAndConfirm } from "@/lib/events";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { saveCustomForm, submitPublicCustomForm } from "@/lib/custom-forms";
import { EVENT_FORM_MESSAGES, sameName } from "@/lib/custom-form-event";
import { parseFormSettings } from "@/lib/custom-form-core";

const db = createFakeDb();
const FORM = "11111111-2222-4333-8444-555555555555";
const EVENT = "aaaaaaaa-2222-4333-8444-555555555555";
const CODE = "a1b2c3d4e5f6";
const NOW = Date.parse("2026-10-30T05:00:00Z");
const THANKS = "Cảm ơn bạn!";
const field = (id: string, type: string, label: string, extra: Record<string, unknown> = {}) => ({ id, type, label, help: "", required: true, hidden: false, options: [], ...extra });
const FIELDS = [field("f_nameaaaa", "short_text", "Họ và tên"), field("f_mailaaaa", "email", "Email"), field("f_telaaaaa", "phone", "Số điện thoại", { required: false })];

let rpcCalls: Array<{ fn: string; args: any }> = [];
let regSeq = 0;
const SEATS = new Set(["registered", "pending_review", "confirmed"]);

/** Mô phỏng hàm khoá chỗ của migration 20261030120000, trên bảng giả. */
function rpc(fn: string, args: any) {
  rpcCalls.push({ fn, args });
  if (fn === "vam_custom_form_insert_response") {
    const rows = db.tables.custom_form_responses.filter((r: any) => r.form_id === args.p_form_id);
    if (args.p_row.dedupe_key && rows.some((r: any) => r.dedupe_key === args.p_row.dedupe_key)) return { data: { status: "duplicate" }, error: null };
    if (args.p_limit != null && rows.length >= args.p_limit) return { data: { status: "full" }, error: null };
    db.tables.custom_form_responses.push({ id: `resp-${rows.length + 1}`, form_id: args.p_form_id, ...args.p_row });
    return { data: { status: "inserted" }, error: null };
  }
  const event = db.tables.events.find((e: any) => e.id === args.p_event_id);
  if (!event || event.status === "cancelled") return { data: { status: "event_closed" }, error: null };
  const email = String(args.p_payload.email).trim().toLowerCase();
  const live = db.tables.event_registrations.filter((r: any) => r.event_id === args.p_event_id && r.registration_status !== "cancelled");
  const existing = live.find((r: any) => r.email.toLowerCase() === email);
  if (existing) return { data: { status: "existing", id: existing.id, full_name: existing.full_name, registration_status: existing.registration_status }, error: null };
  const seats = live.filter((r: any) => SEATS.has(r.registration_status));
  if (args.p_form_limit != null && seats.filter((r: any) => r.custom_form_id === args.p_form_id).length >= args.p_form_limit) return { data: { status: "form_full" }, error: null };
  const full = event.capacity_limit_enabled && seats.length >= event.capacity_limit;
  if (full && !event.waitlist_enabled) return { data: { status: "event_full" }, error: null };
  const status = full ? "waitlisted" : "registered";
  const id = `reg-${++regSeq}`;
  db.tables.event_registrations.push({ ...args.p_payload, id, event_id: args.p_event_id, custom_form_id: args.p_form_id, registration_status: status, email });
  return { data: { status: "inserted", id, registration_status: status }, error: null };
}

function seed(extra: Record<string, unknown> = {}, eventExtra: Record<string, unknown> = {}) {
  db.reset();
  rpcCalls = [];
  regSeq = 0;
  db.tables.custom_forms = [
    {
      id: FORM, public_code: CODE, title: "Đăng ký Training", description: "", program_id: null, status: "published",
      opens_at: null, closes_at: null, thank_you: THANKS, one_per_email: true, auto_reply: true, auto_reply_subject: "",
      auto_reply_body: "Đã nhận", fields: FIELDS, event_id: EVENT, registration_limit: null,
      created_at: "2026-10-30T00:00:00Z", updated_at: "2026-10-30T00:00:00Z", ...extra
    }
  ];
  db.tables.events = [
    { id: EVENT, event_name: "Training", starts_at: "2026-11-15T01:00:00Z", status: "active", capacity_limit_enabled: true, capacity_limit: 2,
      waitlist_enabled: false, approval_required: false, series_id: null, ...eventExtra }
  ];
  db.tables.event_registrations = [];
  db.tables.custom_form_responses = [];
  db.tables.custom_form_duplicate_flags = [];
  db.tables.people = [{ id: "p-an", email_primary: "AN@gmail.com" }];
  db.tables.outbound_emails = [];
  db.tables.programs = [];
}

const submit = (name: string, email: string, phone = "0912345678") =>
  submitPublicCustomForm(CODE, { values: { f_nameaaaa: name, f_mailaaaa: email, f_telaaaaa: phone }, consent: true, trap: "" }, NOW);
const writesTo = (table: string) => db.writes.filter((w) => w.table === table);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  seed();
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fakeClient(db, { rpc }) as any);
  vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "admin-1", role: "support_team", status: "active", email: "a@x.vn" } as any);
});

describe("1. gửi lần đầu", () => {
  it("một đăng ký sự kiện + một câu trả lời nối sang nó + một thư/vé của sự kiện; không thư tự động của form", async () => {
    const r = await submit("Nguyễn Văn An", "An@Gmail.com");
    expect(r).toEqual({ ok: true, message: THANKS, errors: {} });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].args).toMatchObject({ p_event_id: EVENT, p_form_id: FORM, p_form_limit: null });
    expect(rpcCalls[0].args.p_payload).toMatchObject({
      email: "an@gmail.com", full_name: "Nguyễn Văn An", phone: "0912345678", linked_person_id: "p-an",
      match_method: "exact_email", registration_source: "public_form", consent_given: true
    });
    expect(db.tables.custom_form_responses).toHaveLength(1);
    expect(db.tables.custom_form_responses[0]).toMatchObject({ form_id: FORM, dedupe_key: "an@gmail.com", event_registration_id: "reg-1" });
    expect(vi.mocked(issueTicketAndConfirm)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(issueTicketAndConfirm).mock.calls[0][0]).toMatchObject({ registrationId: "reg-1", toEmail: "an@gmail.com", pendingApproval: false });
    expect(vi.mocked(sendCustomFormReceipt)).not.toHaveBeenCalled();
  });

  it("vào danh sách chờ → thư báo đang chờ (pendingApproval)", async () => {
    seed({}, { capacity_limit: 0, waitlist_enabled: true });
    await submit("An", "an@gmail.com");
    expect(vi.mocked(issueTicketAndConfirm).mock.calls[0][0]).toMatchObject({ pendingApproval: true });
  });
});

describe("2. gửi lại (luật trùng của đề xuất)", () => {
  it("cùng email + cùng họ tên (khác dấu/hoa) → cập nhật bản cũ; không đăng ký mới, không gửi lại thư, không chạm trạng thái", async () => {
    await submit("Nguyễn Văn An", "an@gmail.com");
    vi.mocked(issueTicketAndConfirm).mockClear();
    db.writes.length = 0;
    const r = await submit("nguyen van  AN", "an@gmail.com", "0987654321");
    expect(r).toEqual({ ok: true, message: EVENT_FORM_MESSAGES.updated, errors: {} });
    expect(rpcCalls).toHaveLength(1);
    expect(vi.mocked(issueTicketAndConfirm)).not.toHaveBeenCalled();
    const regUpdates = writesTo("event_registrations");
    expect(regUpdates).toHaveLength(1);
    expect(Object.keys(regUpdates[0].rows[0]).sort()).toEqual(["full_name", "phone", "updated_at"]);
    const respUpdates = writesTo("custom_form_responses");
    expect(respUpdates.map((w) => w.kind)).toEqual(["update"]);
    expect(respUpdates[0].rows[0].answers).toMatchObject({ f_telaaaaa: "0987654321" });
    expect(db.tables.custom_form_responses).toHaveLength(1);
  });

  it("cùng email + KHÁC họ tên → không ghi đè gì, một cảnh báo cho BTC, người điền thấy lời cảm ơn", async () => {
    await submit("Nguyễn Văn An", "an@gmail.com");
    db.writes.length = 0;
    const r = await submit("Trần Thị Bình", "an@gmail.com");
    expect(r).toEqual({ ok: true, message: THANKS, errors: {} });
    expect(writesTo("event_registrations")).toEqual([]);
    expect(writesTo("custom_form_responses")).toEqual([]);
    expect(db.tables.custom_form_duplicate_flags).toHaveLength(1);
    expect(db.tables.custom_form_duplicate_flags[0]).toMatchObject({
      form_id: FORM, submitted_name: "Trần Thị Bình", submitted_email: "an@gmail.com", existing_name: "Nguyễn Văn An",
      existing_response_id: db.tables.custom_form_responses[0].id, event_registration_id: "reg-1"
    });
  });

  it("cùng họ tên, khác email → là người khác: đăng ký thứ hai", async () => {
    await submit("Nguyễn Văn An", "an@gmail.com");
    await submit("Nguyễn Văn An", "an2@gmail.com");
    expect(db.tables.event_registrations).toHaveLength(2);
    expect(db.tables.custom_form_duplicate_flags).toEqual([]);
  });

  it("đăng ký cũ đã bị huỷ → gửi lại là xin lại chỗ, câu trả lời nối sang đăng ký mới, có thư mới", async () => {
    await submit("An", "an@gmail.com");
    db.tables.event_registrations[0].registration_status = "cancelled";
    vi.mocked(issueTicketAndConfirm).mockClear();
    const r = await submit("An", "an@gmail.com");
    expect(r.ok).toBe(true);
    expect(rpcCalls).toHaveLength(2);
    expect(db.tables.custom_form_responses).toHaveLength(1);
    expect(writesTo("custom_form_responses").at(-1)!.rows[0]).toMatchObject({ event_registration_id: "reg-2" });
    expect(vi.mocked(issueTicketAndConfirm)).toHaveBeenCalledTimes(1);
  });
});

describe("3. email đã đăng ký bằng form Sự kiện", () => {
  beforeEach(() => {
    db.tables.event_registrations.push({ id: "reg-ev", event_id: EVENT, email: "an@gmail.com", full_name: "Nguyễn Văn An", registration_status: "confirmed", custom_form_id: null });
  });

  it("cùng tên → nhận về form này, cập nhật, ghi câu trả lời; không thư mới", async () => {
    const r = await submit("Nguyễn Văn An", "an@gmail.com");
    expect(r.message).toBe(EVENT_FORM_MESSAGES.updated);
    expect(db.tables.event_registrations).toHaveLength(1);
    expect(db.tables.event_registrations[0]).toMatchObject({ custom_form_id: FORM, registration_status: "confirmed" });
    expect(db.tables.custom_form_responses[0]).toMatchObject({ event_registration_id: "reg-ev" });
    expect(vi.mocked(issueTicketAndConfirm)).not.toHaveBeenCalled();
  });

  it("khác tên → cảnh báo, không ghi câu trả lời, không chạm đăng ký", async () => {
    db.writes.length = 0;
    const r = await submit("Người Khác", "an@gmail.com");
    expect(r.message).toBe(THANKS);
    expect(db.tables.custom_form_responses).toEqual([]);
    expect(writesTo("event_registrations")).toEqual([]);
    expect(db.tables.custom_form_duplicate_flags[0]).toMatchObject({ event_registration_id: "reg-ev", existing_name: "Nguyễn Văn An" });
  });
});

describe("4. hết chỗ / sự kiện đóng", () => {
  it("sự kiện đủ chỗ → đúng câu báo, không ghi câu trả lời, không thư", async () => {
    await submit("A", "a@x.vn");
    await submit("B", "b@x.vn");
    const r = await submit("C", "c@x.vn");
    expect(r).toEqual({ ok: false, message: EVENT_FORM_MESSAGES.eventFull, errors: {} });
    expect(db.tables.custom_form_responses).toHaveLength(2);
    expect(vi.mocked(issueTicketAndConfirm)).toHaveBeenCalledTimes(2);
  });

  it("giới hạn riêng của form đủ → câu báo của form", async () => {
    seed({ registration_limit: 1 });
    await submit("A", "a@x.vn");
    expect(rpcCalls[0].args.p_form_limit).toBe(1);
    expect((await submit("B", "b@x.vn")).message).toBe(EVENT_FORM_MESSAGES.formFull);
  });

  it.each([[{ status: "cancelled" }], [{ fee_required: true }], [{ proof_required_for_registration: true }]])("sự kiện %j → đã đóng đăng ký, không gọi ghi", async (eventExtra) => {
    seed({}, eventExtra);
    const r = await submit("A", "a@x.vn");
    expect(r).toEqual({ ok: false, message: EVENT_FORM_MESSAGES.eventClosed, errors: {} });
    expect(rpcCalls).toEqual([]);
  });
});

describe("5. form độc lập có giới hạn", () => {
  it("đủ giới hạn → câu báo; trùng email → báo đúng ô Email; thư tự động chỉ cho lần ghi được", async () => {
    seed({ event_id: null, registration_limit: 1 });
    expect((await submit("A", "a@x.vn")).ok).toBe(true);
    expect((await submit("A", "a@x.vn")).errors).toHaveProperty("f_mailaaaa");
    expect((await submit("B", "b@x.vn")).message).toBe(EVENT_FORM_MESSAGES.formFull);
    expect(vi.mocked(sendCustomFormReceipt)).toHaveBeenCalledTimes(1);
  });
});

describe("5b. phần thuần", () => {
  it("so họ tên: bỏ dấu/hoa/khoảng trắng; tên rỗng KHÔNG bao giờ là trùng", () => {
    expect(sameName("Nguyễn  Văn An", "nguyen van an")).toBe(true);
    expect(sameName("", "")).toBe(false);
    expect(sameName("   ", "x")).toBe(false);
    expect(sameName("An", "Ân Nguyễn")).toBe(false);
  });

  it("giới hạn số đăng ký: số nguyên 1…100000 hoặc trống", () => {
    const base = { title: "F", description: "", programId: "", thankYou: "", onePerEmail: true, opensAt: null, closesAt: null };
    expect(parseFormSettings({ ...base, registrationLimit: "" })).toMatchObject({ ok: true, settings: { registrationLimit: null } });
    expect(parseFormSettings({ ...base, registrationLimit: "40" })).toMatchObject({ ok: true, settings: { registrationLimit: 40 } });
    for (const bad of ["0", "-1", "2.5", "abc", "100001"]) expect(parseFormSettings({ ...base, registrationLimit: bad }).ok).toBe(false);
  });
});

describe("6. lưu form", () => {
  const payload = (over: Record<string, unknown> = {}) => ({
    title: "Đăng ký Training", description: "", programId: "", thankYou: THANKS, onePerEmail: true, autoReply: false,
    autoReplySubject: "", autoReplyBody: "", opensAt: "", closesAt: "", fields: FIELDS, eventId: EVENT, registrationLimit: "", ...over
  });

  it("gắn sự kiện thu phí → báo lý do, không ghi", async () => {
    seed({ event_id: null }, { fee_required: true });
    const r = await saveCustomForm(FORM, payload() as any);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("thu phí");
    expect(writesTo("custom_forms")).toEqual([]);
  });

  it("đã có câu trả lời → không đổi/bỏ sự kiện liên kết được", async () => {
    db.tables.custom_form_responses.push({ id: "r1", form_id: FORM, answers: {}, dedupe_key: "a@x.vn" });
    const r = await saveCustomForm(FORM, payload({ eventId: "" }) as any);
    expect(r).toEqual({ ok: false, message: "Form đã có câu trả lời — không đổi hay bỏ sự kiện liên kết được nữa." });
  });

  it("form gắn sự kiện thiếu ô Họ tên / tắt mỗi-email-một-lần → bị chặn", async () => {
    expect((await saveCustomForm(FORM, payload({ fields: FIELDS.slice(1) }) as any)).message).toContain("Họ và tên");
    expect((await saveCustomForm(FORM, payload({ onePerEmail: false }) as any)).message).toContain("Mỗi email chỉ gửi một lần");
  });

  it("hợp lệ → ghi event_id và giới hạn", async () => {
    const r = await saveCustomForm(FORM, payload({ registrationLimit: "40" }) as any);
    expect(r.ok).toBe(true);
    expect(writesTo("custom_forms")[0].rows[0]).toMatchObject({ event_id: EVENT, registration_limit: 40 });
  });
});
