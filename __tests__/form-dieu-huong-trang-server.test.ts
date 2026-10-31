/**
 * Điều hướng trang của Form tùy chỉnh — máy chủ, trên bản giả PostgREST. Khẳng định chính lệnh ghi: lỗi
 * đường đi không ghi gì; form đang công khai vẫn lưu được nếu không tệ hơn trước; lần gửi chỉ ghi câu của
 * nhánh cuối dù trình duyệt gửi cả dữ liệu nhánh cũ đang giữ tạm.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, fakeClient } from "./support/fake-postgrest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn(), getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendCustomFormReceipt: vi.fn(async () => ({ ok: true, skipped: false })) }));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { saveCustomForm, setCustomFormStatus, submitPublicCustomForm } from "@/lib/custom-forms";
import type { CustomFormSavePayload } from "@/lib/custom-form-action-types";

const db = createFakeDb();
const FORM = "11111111-2222-4333-8444-555555555555";
const CODE = "a1b2c3d4e5f6";
const NOW = Date.parse("2026-10-15T12:00:00Z");

const field = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, label: `Câu ${id}`, help: "", required: type !== "page_break", hidden: false, options: [] as string[], ...extra });
// Câu Có/Không bắt buộc, cả hai lựa chọn nhảy qua trang “Lạc”: dạng form cũ có thể đang chạy.
const LEGACY_DEAD = [
  field("f_askaaaaa", "yes_no", { options: ["Có", "Không"], branches: { yes: "f_brkbbbbb", no: "f_brkbbbbb" } }),
  field("f_brkaaaaa", "page_break", { label: "Lạc" }),
  field("f_aaaaaaaa", "short_text"),
  field("f_brkbbbbb", "page_break", { label: "Cuối" }),
  field("f_bbbbbbbb", "short_text")
];
const OK_FORM = [
  field("f_askaaaaa", "single_choice", { options: ["A", "B"], optionTargets: { A: "f_brkaaaaa", B: "f_brkbbbbb" } }),
  field("f_brkaaaaa", "page_break", { label: "A", nextPage: "__end" }),
  field("f_aaaaaaaa", "short_text"),
  field("f_brkbbbbb", "page_break", { label: "B" }),
  field("f_bbbbbbbb", "short_text")
];
const DEAD_NEW = OK_FORM.map((f) => (f.id === "f_askaaaaa" ? { ...f, optionTargets: { A: "f_brkbbbbb", B: "f_brkbbbbb" } } : f));

function seed(status: string, fields: unknown[]) {
  db.tables.custom_forms = [
    { id: FORM, public_code: CODE, title: "Thử", description: "", program_id: null, status, opens_at: null, closes_at: null, thank_you: "", one_per_email: false, fields, created_at: "2026-10-15T10:00:00Z", updated_at: "2026-10-15T10:00:00Z" }
  ];
  db.tables.custom_form_responses = [];
  db.tables.outbound_emails = [];
  db.tables.programs = [];
}
const payload = (fields: unknown[]): CustomFormSavePayload => ({ title: "Thử", description: "", programId: "", thankYou: "", onePerEmail: false, autoReply: false, autoReplySubject: "", autoReplyBody: "", opensAt: "", closesAt: "", fields });
const formWrites = () => db.writes.filter((w) => w.table === "custom_forms");

beforeEach(() => {
  vi.clearAllMocks();
  db.reset();
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fakeClient(db) as any);
  vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "admin-1", role: "support_team", status: "active", email: "a@x.vn" } as any);
});

describe("lưu và công khai", () => {
  it("đích trỏ tới trang đã xoá: không ghi gì, kể cả form nháp", async () => {
    seed("draft", OK_FORM);
    const result = await saveCustomForm(FORM, payload(OK_FORM.filter((f) => f.id !== "f_brkbbbbb")));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("không còn trên form");
    expect(formWrites()).toEqual([]);
  });
  it("nháp có trang không ai tới vẫn lưu được; công khai thì bị chặn và không đổi trạng thái", async () => {
    seed("draft", OK_FORM);
    expect((await saveCustomForm(FORM, payload(DEAD_NEW))).ok).toBe(true);
    db.writes.length = 0;
    db.tables.custom_forms[0].fields = DEAD_NEW;
    const result = await setCustomFormStatus(FORM, "published");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("không có đường tới");
    expect(formWrites()).toEqual([]);
  });
  it("form đang công khai: trang lạc mới không ghi; trang lạc đã có từ trước vẫn lưu được", async () => {
    seed("published", OK_FORM);
    expect((await saveCustomForm(FORM, payload(DEAD_NEW))).message).toContain("không có đường tới");
    expect(formWrites()).toEqual([]);
    seed("published", LEGACY_DEAD);
    expect((await saveCustomForm(FORM, payload(LEGACY_DEAD.map((f) => (f.id === "f_bbbbbbbb" ? { ...f, label: "Sửa chính tả" } : f))))).ok).toBe(true);
    expect(formWrites()).toHaveLength(1);
  });
  it("định nghĩa ghi xuống giữ optionTargets và nextPage", async () => {
    seed("draft", []);
    expect((await saveCustomForm(FORM, payload(OK_FORM))).ok).toBe(true);
    const written = formWrites()[0].rows[0].fields as Array<Record<string, unknown>>;
    expect(written[0].optionTargets).toEqual({ A: "f_brkaaaaa", B: "f_brkbbbbb" });
    expect(written[1].nextPage).toBe("__end");
  });
});

describe("gửi form", () => {
  it("chỉ ghi câu của nhánh cuối, dữ liệu nhánh cũ đang giữ tạm không xuống database", async () => {
    seed("published", OK_FORM);
    const result = await submitPublicCustomForm(CODE, { values: { f_askaaaaa: "B", f_aaaaaaaa: "nhánh cũ", f_bbbbbbbb: "nhánh mới" }, consent: true, trap: "" }, NOW);
    expect(result.ok).toBe(true);
    const row = db.writes.find((w) => w.table === "custom_form_responses")!.rows[0];
    expect(row.answers).toEqual({ f_askaaaaa: "B", f_bbbbbbbb: "nhánh mới" });
  });
  it("câu bắt buộc của nhánh đang đi vẫn bắt buộc, không ghi gì", async () => {
    seed("published", OK_FORM);
    const result = await submitPublicCustomForm(CODE, { values: { f_askaaaaa: "B", f_aaaaaaaa: "nhánh cũ" }, consent: true, trap: "" }, NOW);
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveProperty("f_bbbbbbbb");
    expect(db.writes.filter((w) => w.table === "custom_form_responses")).toEqual([]);
  });
});
