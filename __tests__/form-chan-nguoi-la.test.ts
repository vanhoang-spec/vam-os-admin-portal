/**
 * Chặn người chưa có trên hệ thống ở form tùy chỉnh (VAM00009 mục 4.2): cổng nằm trong submitPublicCustomForm,
 * trước mọi lệnh ghi. Hỏng đọc database thì không cho qua.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  people: [] as Array<Record<string, unknown>>,
  apps: [] as Array<Record<string, unknown>>,
  form: {} as Record<string, unknown>,
  failApps: false,
  inserts: [] as unknown[],
  ilike: [] as string[]
}));

function chain(result: () => { data: unknown; error: unknown }, extra: Record<string, unknown> = {}) {
  const node: Record<string, unknown> = { ...extra };
  for (const name of ["select", "eq", "in", "limit", "ilike"]) {
    node[name] = (...args: unknown[]) => {
      if (name === "ilike") db.ilike.push(String(args[1]));
      return node;
    };
  }
  node.maybeSingle = async () => result();
  node.then = (resolve: (v: unknown) => void) => resolve(result());
  return node;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServerClient: vi.fn(),
  getSupabaseServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === "custom_forms") return chain(() => ({ data: db.form, error: null }));
      if (table === "people") return chain(() => ({ data: db.people, error: null }));
      if (table === "seasons") return chain(() => ({ data: { id: "s12" }, error: null }));
      if (table === "applications") return chain(() => (db.failApps ? { data: null, error: { message: "down" } } : { data: db.apps, error: null }));
      if (table === "custom_form_responses") {
        return { insert: async (row: unknown) => { db.inserts.push(row); return { error: null }; } };
      }
      throw new Error(`bảng lạ ${table}`);
    }
  })
}));
vi.mock("@/lib/email", () => ({ sendCustomFormReceipt: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/custom-form-event", async (original) => ({
  ...(await original<typeof import("@/lib/custom-form-event")>()),
  submitEventLinkedForm: vi.fn()
}));

import { KNOWN_PERSON_MESSAGE } from "@/lib/custom-form-gate";
import { submitPublicCustomForm } from "@/lib/custom-forms";

const CODE = "a1b2c3d4e5f6";
const FIELDS = [
  { id: "f_nameaaaa", type: "short_text", label: "Họ và tên", help: "", required: true, hidden: false, options: [] },
  { id: "f_emailaaa", type: "email", label: "Email", help: "", required: true, hidden: false, options: [] }
];
const submit = (name: string, email: string) =>
  submitPublicCustomForm(CODE, { values: { f_nameaaaa: name, f_emailaaa: email }, consent: true, trap: "" });

beforeEach(() => {
  db.form = { id: "form-1", status: "published", fields: FIELDS, require_known_person: true, one_per_email: false, registration_limit: null, event_id: null };
  db.people = [{ id: "p1", full_name: "Nguyễn Văn An", email_primary: "An@Gmail.com" }];
  db.apps = [{ id: "a1" }];
  db.failApps = false;
  db.inserts = [];
  db.ilike = [];
});

describe("cổng người đã có trên hệ thống", () => {
  it("đúng email, họ tên (khác dấu, khác hoa thường), có đơn đã duyệt của mùa: ghi", async () => {
    const out = await submit("nguyen van an", "an@gmail.com");
    expect(out.ok).toBe(true);
    expect(db.inserts).toHaveLength(1);
  });
  it("email có thật nhưng họ tên khác: chặn, đúng nguyên văn, không ghi", async () => {
    const out = await submit("Trần Thị Bình", "an@gmail.com");
    expect(out).toMatchObject({ ok: false, message: KNOWN_PERSON_MESSAGE });
    expect(KNOWN_PERSON_MESSAGE).toBe("Thông tin của bạn chưa có trên hệ thống. Vui lòng liên hệ BTC để được hỗ trợ.");
    expect(db.inserts).toHaveLength(0);
  });
  it("không có email trong people: chặn", async () => {
    db.people = [];
    expect((await submit("Nguyễn Văn An", "la@gmail.com")).ok).toBe(false);
    expect(db.inserts).toHaveLength(0);
  });
  it("có người nhưng không có đơn đã duyệt của mùa: chặn", async () => {
    db.apps = [];
    expect(await submit("Nguyễn Văn An", "an@gmail.com")).toMatchObject({ ok: false, message: KNOWN_PERSON_MESSAGE });
    expect(db.inserts).toHaveLength(0);
  });
  it("lỗi đọc database: KHÔNG cho qua, và không báo nhầm là chưa có trên hệ thống", async () => {
    db.failApps = true;
    const out = await submit("Nguyễn Văn An", "an@gmail.com");
    expect(out.ok).toBe(false);
    expect(out.message).not.toBe(KNOWN_PERSON_MESSAGE);
    expect(db.inserts).toHaveLength(0);
  });
  it("ký tự đại diện trong email không mở rộng được phép so khớp", async () => {
    await submit("Nguyễn Văn An", "a_n@gmail.com");
    expect(db.ilike[0]).toContain(String.fromCharCode(92) + "_");
  });
  it("tắt tùy chọn: người ngoài vẫn gửi được, không đọc people", async () => {
    db.form = { ...db.form, require_known_person: false };
    db.people = [];
    expect((await submit("Người Ngoài", "la@gmail.com")).ok).toBe(true);
    expect(db.inserts).toHaveLength(1);
    expect(db.ilike).toHaveLength(0);
  });
});

describe("máy chủ kiểm theo đường rẽ nhánh", () => {
  const BRANCHED = [
    { id: "f_askaaaaa", type: "yes_no", label: "Hỏi", help: "", required: true, hidden: false, options: ["Có", "Không"], branches: { yes: "", no: "__end" } },
    { id: "f_brkaaaaa", type: "page_break", label: "Trang sau", help: "", required: false, hidden: false, options: [] },
    { id: "f_morerrrr", type: "short_text", label: "Thêm", help: "", required: true, hidden: false, options: [] }
  ];
  beforeEach(() => {
    db.form = { ...db.form, fields: BRANCHED, require_known_person: false };
  });
  it("trang bị bỏ qua: câu bắt buộc không chặn, câu còn sót không được ghi", async () => {
    const out = await submitPublicCustomForm(CODE, { values: { f_askaaaaa: "Không", f_morerrrr: "còn sót" }, consent: true, trap: "" });
    expect(out.ok).toBe(true);
    expect((db.inserts[0] as { answers: unknown }).answers).toEqual({ f_askaaaaa: "Không" });
  });
  it("đi qua trang đó thì câu bắt buộc vẫn bắt buộc", async () => {
    const out = await submitPublicCustomForm(CODE, { values: { f_askaaaaa: "Có" }, consent: true, trap: "" });
    expect(out.ok).toBe(false);
    expect(out.errors).toHaveProperty("f_morerrrr");
    expect(db.inserts).toHaveLength(0);
  });
});
