import PizZip from "pizzip";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dataset, uuid } from "./support/mentee-offline-export-fixture";

const SEASON = uuid(1, 1);

type Row = Record<string, unknown>;
type Seen = { table: string; cols: string; filters: Array<[string, string, unknown]> };

const mocks = vi.hoisted(() => ({
  admin: null as null | { id: string; role: string; status: "active"; email: string; full_name: string | null; auth_user_id: string | null },
  canOperate: true,
  scopeThrows: false,
  tables: {} as Record<string, Row[]>,
  seen: [] as Seen[]
}));

class Query {
  private cols = "";
  private filters: Array<[string, string, unknown]> = [];
  private orderKey: string | null = null;
  private limitN = Infinity;
  private single_ = false;
  constructor(private table: string) {}
  select(cols: string) { this.cols = cols; return this; }
  eq(column: string, value: unknown) { this.filters.push(["eq", column, value]); return this; }
  neq(column: string, value: unknown) { this.filters.push(["neq", column, value]); return this; }
  in(column: string, values: unknown[]) { this.filters.push(["in", column, values]); return this; }
  gt(column: string, value: unknown) { this.filters.push(["gt", column, value]); return this; }
  // Giữ đúng ngữ nghĩa của PostgREST: sắp theo khoá, cắt theo limit. Một bản giả nuốt order/limit sẽ xanh cả khi mã đọc thiếu trang.
  order(column: string, _options?: unknown) { this.orderKey = column; return this; }
  limit(n: number) { this.limitN = n; return this; }
  single() { this.single_ = true; return this; }
  then(resolve: (value: { data: unknown; error: { message: string } | null }) => unknown, reject?: (reason: unknown) => unknown) {
    return Promise.resolve(this.run()).then(resolve, reject);
  }
  private run() {
    mocks.seen.push({ table: this.table, cols: this.cols, filters: [...this.filters] });
    let rows = [...(mocks.tables[this.table] ?? [])];
    for (const [kind, column, value] of this.filters) {
      if (kind === "eq") rows = rows.filter((r) => r[column] === value);
      if (kind === "neq") rows = rows.filter((r) => r[column] !== value);
      if (kind === "in") rows = rows.filter((r) => (value as unknown[]).includes(r[column]));
      if (kind === "gt") rows = rows.filter((r) => String(r[column]) > String(value));
    }
    if (this.orderKey) {
      const key = this.orderKey;
      rows.sort((a, b) => String(a[key]).localeCompare(String(b[key])));
    }
    rows = rows.slice(0, this.limitN);
    const wanted = this.cols.split(",").map((c) => c.trim()).filter(Boolean);
    const projected = this.cols.includes("*") ? rows : rows.map((r) => Object.fromEntries(wanted.map((c) => [c, r[c] ?? null])));
    if (this.single_) return { data: projected[0] ?? null, error: projected[0] ? null : { message: "no rows" } };
    return { data: projected, error: null };
  }
}
vi.mock("server-only", () => ({}));
// Một số module đọc dữ liệu dùng React.cache của máy chủ; ngoài Next nó không tồn tại.
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: <T,>(fn: T) => fn }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: async () => mocks.admin }));
vi.mock("@/lib/program-scope", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/program-scope")>()),
  getAdminScopeContext: async () => {
    if (mocks.scopeThrows) throw new Error("scope unavailable");
    return {};
  },
  canOperateSeason: async () => mocks.canOperate
}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: () => ({ from: (table: string) => new Query(table) }) }));

import * as routeModule from "@/app/api/exports/mentee-offline/route";
import { getMenteeOfflineExportOptions } from "@/lib/mentee-offline-export";

const adminAs = (role: string) => ({ id: uuid(7, 3), role, status: "active" as const, email: "a@example.test", full_name: "A", auth_user_id: null });

function loadFixture(extra?: { count?: number }) {
  const data = dataset();
  mocks.tables = {
    seasons: [{ id: SEASON, code: "UEHM-S12" }],
    mentee_interview_bookings: data.bookings.map((b, i) => ({ id: uuid(i + 1, 4), season_id: SEASON, status: "booked", ...b })),
    interview_sessions: data.sessions.map((s) => ({ season_id: SEASON, ...s })),
    applications: data.applications as unknown as Row[],
    mentee_interview_operations: data.operations as unknown as Row[],
    application_reviews: data.reviews as unknown as Row[],
    admin_users: Array.from(data.staffNames, ([id, full_name]) => ({ id, full_name, email: `${id}@example.test` }))
  };
  if (extra?.count) {
    // Hơn 1000 mentee để chứng minh đọc phân trang không cắt giữa chừng.
    const s = data.sessions[0].id;
    for (let i = 0; i < extra.count; i++) {
      const id = uuid(10_000 + i, 2);
      mocks.tables.mentee_interview_bookings.push({ id: uuid(10_000 + i, 4), season_id: SEASON, status: "booked", application_id: id, session_id: s });
      mocks.tables.applications.push({ id, full_name: `Mentee ${String(i).padStart(4, "0")}`, email_primary: `m${i}@example.test`, phone_primary: null, status: "approved_as_mentee", raw_payload: { major: "Kế toán" } });
    }
  }
}

function post(fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return routeModule.POST(new Request("https://test/api/exports/mentee-offline", { method: "POST", body: form }));
}
const sheetOf = async (response: Response) => new PizZip(await response.arrayBuffer()).file("xl/worksheets/sheet1.xml")!.asText();
const mentee = (table: string) => mocks.seen.filter((s) => s.table === table);

beforeEach(() => {
  mocks.admin = adminAs("admin");
  mocks.canOperate = true;
  mocks.scopeThrows = false;
  mocks.seen = [];
  loadFixture();
});

describe("cổng tải: kiểm ở máy chủ, không đủ quyền thì không đọc gì", () => {
  it("chưa đăng nhập: 401 và không chạm database", async () => {
    mocks.admin = null;
    const response = await post({});
    expect(response.status).toBe(401);
    expect(mocks.seen).toEqual([]);
  });
  it.each(["support_team", "reviewer", "viewer", "mentor", "mentee"])("vai trò %s: 403 và không chạm database", async (role) => {
    mocks.admin = adminAs(role);
    const response = await post({ ids: uuid(1) });
    expect(response.status).toBe(403);
    expect(mocks.seen).toEqual([]);
  });
  it.each(["super_admin", "admin", "core_team"])("vai trò %s được tải", async (role) => {
    mocks.admin = adminAs(role);
    expect((await post({})).status).toBe(200);
  });
  it("đủ vai trò nhưng không có quyền vận hành mùa: 403, chỉ đọc mã mùa, không đọc mentee", async () => {
    mocks.canOperate = false;
    const response = await post({});
    expect(response.status).toBe(403);
    expect(mocks.seen.map((s) => s.table)).toEqual(["seasons"]);
  });
  it("không đọc được phạm vi quyền thì cũng từ chối (lỗi hạ tầng không thành quyền)", async () => {
    mocks.scopeThrows = true;
    const response = await post({});
    expect(response.status).toBe(403);
    expect(mentee("applications")).toEqual([]);
  });
  it("chỉ có POST: GET không tồn tại", () => {
    expect((routeModule as Record<string, unknown>).GET).toBeUndefined();
  });
});

describe("điều kiện từ biểu mẫu", () => {
  it("sai dạng: 400 và không đọc dữ liệu mentee", async () => {
    const bad: Array<Record<string, string>> = [{ ids: "abc" }, { profile_reviewer: "x" }, { interview_result: "approved" }];
    for (const fields of bad) {
      mocks.seen = [];
      const response = await post(fields);
      expect(response.status).toBe(400);
      expect(mocks.seen).toEqual([]);
    }
  });
  it("không mentee nào khớp: 400 kèm lời giải thích, không có file rỗng", async () => {
    const response = await post({ profile_result: "reject" });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Không có mentee nào khớp");
  });
});

describe("file tải về", () => {
  it("tệp riêng tư đính kèm, đúng loại, tên có mùa và ngày", async () => {
    const response = await post({});
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toContain("spreadsheetml.sheet");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="mentee-phong-van-truc-tiep-S12-\d{8}\.xlsx"$/);
  });
  it("chọn một số mentee thì đúng những bạn đó, và điều kiện lọc áp thêm (giao nhau)", async () => {
    const some = await sheetOf(await post({ ids: `${uuid(1)},${uuid(2)}` }));
    expect(some).toContain("Nguyễn Văn An");
    expect(some).toContain("Trần Thị Bình");
    expect(some).not.toContain("Đặng Chi");
    const narrowed = await sheetOf(await post({ ids: `${uuid(1)},${uuid(2)}`, profile_result: "waitlist" }));
    expect(narrowed).toContain("Trần Thị Bình");
    expect(narrowed).not.toContain("Nguyễn Văn An");
  });
  it("điều kiện kết hợp áp cùng lúc ở máy chủ", async () => {
    const both = await sheetOf(await post({ profile_reviewer: uuid(2, 7), interview_result: "needs_review" }));
    expect(both).toContain("Trần Thị Bình");
    expect(both).not.toContain("Nguyễn Văn An");
    expect((await post({ profile_reviewer: uuid(1, 7), interview_result: "needs_review" })).status).toBe(400);
  });
  it("không lấy phiếu đã huỷ: người đánh giá cũ không lọt vào file", async () => {
    const sheet = await sheetOf(await post({ ids: uuid(1) }));
    expect(sheet).toContain("Lê Hoà");
    expect(sheet).not.toContain("Người Cũ");
    expect(sheet).not.toContain("ghi chú của người cũ");
    expect(mentee("application_reviews").every((s) => s.filters.some(([kind, column, value]) => kind === "neq" && column === "status" && value === "cancelled"))).toBe(true);
  });
  it("đơn đăng ký chỉ được đọc cho đúng những mentee xuất, và chỉ một lần", async () => {
    await post({ ids: `${uuid(1)},${uuid(2)}` });
    // Một lần đọc phân trang = trang đầu + một lần hỏi tiếp rỗng (có gt); đếm các lần mở đầu.
    const withPayload = mocks.seen.filter((s) => s.cols.includes("raw_payload") && !s.filters.some(([kind]) => kind === "gt"));
    expect(withPayload).toHaveLength(1);
    const ids = withPayload[0].filters.find(([kind, column]) => kind === "in" && column === "id")?.[2] as string[];
    expect([...ids].sort()).toEqual([uuid(1), uuid(2)].sort());
  });
  it("hơn 1000 mentee vẫn xuất đủ, không bị cắt ở trang đầu", async () => {
    loadFixture({ count: 1100 });
    mocks.seen = [];
    const response = await post({});
    expect(response.status).toBe(200);
    const sheet = await sheetOf(response);
    // 3 mentee mẫu + 1100 bạn thêm = 1103 dòng dữ liệu, cộng hai dòng tiêu đề.
    expect(sheet).toContain('<row r="1105">');
    expect(sheet).not.toContain('<row r="1106">');
    expect(sheet).toContain("Mentee 1099");
    expect(mentee("mentee_interview_bookings").length).toBeGreaterThan(1);
  });
});

describe("trang chọn mentee: danh sách nhẹ", () => {
  it("không có SĐT, câu trả lời đơn hay nhận xét, và không đọc đơn đăng ký chi tiết", async () => {
    const result = await getMenteeOfflineExportOptions();
    expect(result.ok).toBe(true);
    const json = JSON.stringify(result);
    for (const secret of ["0900000001", "Tài chính", "31241000001", "Hồ sơ tốt", "https://drive.example.test"]) expect(json).not.toContain(secret);
    expect(mocks.seen.some((s) => s.cols.includes("raw_payload"))).toBe(false);
  });
  it("không đủ quyền thì trả lỗi 403, không có dòng nào", async () => {
    mocks.admin = adminAs("support_team");
    expect(await getMenteeOfflineExportOptions()).toMatchObject({ ok: false, status: 403 });
    expect(mocks.seen).toEqual([]);
  });
});
