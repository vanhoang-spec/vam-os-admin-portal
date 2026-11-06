import { beforeEach, describe, expect, it, vi } from "vitest";

import { BATCH_ID, SEASON_CODE, SEASON_ID, menteeProfileRow, mentorProfileRow, personRow, uuid } from "./support/participant-export-fixture";
import { columnValues, readSheet } from "./support/xlsx-read";

/**
 * VAM00025 — đường tải /api/exports/participant-profiles chạy THẬT qua lib/participant-export và các hàm đọc của
 * lib/data (cùng hàm trang /mentors, /mentees dùng), chỉ thay Supabase bằng bản giả. Bản giả giữ đúng ngữ nghĩa
 * PostgREST: sắp theo khoá, cắt theo limit, và tự cắt ở 1000 dòng như db-max-rows — một phép đọc không phân trang sẽ
 * thiếu người ngay trong test, không chỉ trên production.
 */

type Row = Record<string, unknown>;
type Seen = { table: string; cols: string };

const SERVER_ROW_CAP = 1000;

const mocks = vi.hoisted(() => ({
  admin: null as null | { id: string; role: string; status: "active"; email: string; full_name: string | null; auth_user_id: string | null },
  canOperate: true,
  scopeError: null as string | null,
  scopeThrows: false,
  seasonFailure: null as null | "denied" | "invalid" | "broken",
  seasonCalls: [] as unknown[],
  failTable: null as string | null,
  tables: {} as Record<string, Row[]>,
  seen: [] as Seen[]
}));

class Query {
  private cols = "*";
  private filters: Array<[string, string, unknown]> = [];
  private orders: string[] = [];
  private limitN = Infinity;
  private rangeFrom = 0;
  private rangeTo = Infinity;
  private single_ = false;
  constructor(private table: string) {}
  select(cols: string) { this.cols = cols; return this; }
  eq(column: string, value: unknown) { this.filters.push(["eq", column, value]); return this; }
  neq(column: string, value: unknown) { this.filters.push(["neq", column, value]); return this; }
  in(column: string, values: unknown[]) { this.filters.push(["in", column, values]); return this; }
  gt(column: string, value: unknown) { this.filters.push(["gt", column, value]); return this; }
  order(column: string, _options?: unknown) { this.orders.push(column); return this; }
  limit(n: number) { this.limitN = n; return this; }
  range(from: number, to: number) { this.rangeFrom = from; this.rangeTo = to; return this; }
  single() { this.single_ = true; return this; }
  maybeSingle() { this.single_ = true; return this; }
  then(resolve: (value: { data: unknown; error: { message: string } | null }) => unknown, reject?: (reason: unknown) => unknown) {
    return Promise.resolve(this.run()).then(resolve, reject);
  }
  private run() {
    mocks.seen.push({ table: this.table, cols: this.cols });
    if (mocks.failTable === this.table) return { data: null, error: { message: `${this.table} unavailable` } };
    let rows = [...(mocks.tables[this.table] ?? [])];
    for (const [kind, column, value] of this.filters) {
      if (kind === "eq") rows = rows.filter((r) => r[column] === value);
      if (kind === "neq") rows = rows.filter((r) => r[column] !== value);
      if (kind === "in") rows = rows.filter((r) => (value as unknown[]).includes(r[column]));
      if (kind === "gt") rows = rows.filter((r) => String(r[column]) > String(value));
    }
    if (this.orders.length) {
      rows.sort((a, b) => {
        for (const key of this.orders) {
          const diff = String(a[key]).localeCompare(String(b[key]));
          if (diff) return diff;
        }
        return 0;
      });
    }
    rows = rows.slice(this.rangeFrom, this.rangeTo + 1).slice(0, Math.min(this.limitN, SERVER_ROW_CAP));
    const wanted = this.cols.split(",").map((c) => c.trim()).filter(Boolean);
    const projected = this.cols.includes("*") ? rows.map((r) => ({ ...r })) : rows.map((r) => Object.fromEntries(wanted.map((c) => [c, r[c] ?? null])));
    if (this.single_) return { data: projected[0] ?? null, error: null };
    return { data: projected, error: null };
  }
}

vi.mock("server-only", () => ({}));
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: <T,>(fn: T) => fn }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: async () => mocks.admin }));
vi.mock("@/lib/season-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/season-context")>();
  return {
    ...actual,
    resolveSeasonContext: async (explicit?: unknown) => {
      mocks.seasonCalls.push(explicit);
      if (mocks.seasonFailure === "denied") throw new actual.SeasonAccessDeniedError();
      if (mocks.seasonFailure === "invalid") throw new actual.SeasonContextError();
      if (mocks.seasonFailure === "broken") throw new Error("catalog unavailable");
      return {
        currentProgramId: uuid(1, 9),
        selectedSeasonId: SEASON_ID,
        selectedSeasonCode: SEASON_CODE,
        availableSeasons: [],
        effectiveScope: { allowedSeasonIds: [SEASON_ID] }
      };
    }
  };
});
vi.mock("@/lib/program-scope", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/program-scope")>()),
  getAdminScopeContext: async () => {
    if (mocks.scopeThrows) throw new Error("scope unavailable");
    return { adminUser: null, authUserId: null, globalRole: null, isSuperAdmin: false, programScopes: [], scopeError: mocks.scopeError };
  },
  canOperateSeason: async () => mocks.canOperate
}));
vi.mock("@/lib/supabase-server", () => {
  const client = { from: (table: string) => new Query(table) };
  return { getSupabaseServiceRoleClient: () => client, getSupabaseServerClient: async () => client };
});

import { GET } from "@/app/api/exports/participant-profiles/route";

const adminAs = (role: string) => ({ id: uuid(7, 7), role, status: "active" as const, email: "a@example.test", full_name: "A", auth_user_id: null });

function membership(n: number, role: "mentor" | "mentee", status = "active", seasonId = SEASON_ID): Row {
  return { id: uuid(n, role === "mentor" ? 6 : 8), person_id: uuid(n, 3), role, status, season_id: seasonId };
}

/** Ba mentor chính thức + một mentor đã rút (không thuộc danh sách) + hai mentee chính thức. */
function loadFixture() {
  mocks.tables = {
    seasons: [{ id: SEASON_ID, code: SEASON_CODE, name: "Mùa 12", program_id: uuid(1, 9) }],
    intake_batches: [{ id: BATCH_ID, season_id: SEASON_ID, code: "S12-MENTOR-01", name: "Đợt 1", is_active: true }],
    person_season_memberships: [
      membership(1, "mentor"),
      membership(2, "mentor", "completed"),
      membership(3, "mentor"),
      membership(4, "mentor", "withdrawn"),
      membership(11, "mentee"),
      membership(12, "mentee")
    ],
    people: [
      personRow(1, { member_code: "UEHR0002" }),
      personRow(2, { member_code: "UEHC0001" }),
      personRow(3, { member_code: "UEHR0003" }),
      personRow(4, { member_code: "UEHR0004", full_name: "Mentor Đã Rút" }),
      personRow(11, { member_code: "UEHE0001" }),
      personRow(12, { member_code: "UEHE0002" })
    ],
    mentor_profiles: [
      mentorProfileRow(1, { bio_url: "https://drive.example.test/cv-1.pdf", admin_notes: "Không được ra file", intake_batch_id: BATCH_ID }),
      mentorProfileRow(2),
      mentorProfileRow(3),
      mentorProfileRow(4)
    ],
    mentee_profiles: [menteeProfileRow(11, { mssv: "00000000011" }), menteeProfileRow(12)],
    industries: [{ id: "i1", code: "FIN", name: "Tài chính", is_active: true }],
    mentor_industries: [{ mentor_profile_id: uuid(1, 4), industry_id: "i1" }],
    function_areas: [],
    mentor_function_areas: [],
    mentor_program_participations: [],
    programs: []
  };
}

const call = (query: string) => GET(new Request(`https://test/api/exports/participant-profiles?${query}`));

beforeEach(() => {
  mocks.admin = adminAs("admin");
  mocks.canOperate = true;
  mocks.scopeError = null;
  mocks.scopeThrows = false;
  mocks.seasonFailure = null;
  mocks.seasonCalls = [];
  mocks.failTable = null;
  mocks.seen = [];
  loadFixture();
});

describe("cổng tải: kiểm ở máy chủ, không đủ quyền thì không đọc dữ liệu nào", () => {
  it("chưa đăng nhập: 401", async () => {
    mocks.admin = null;
    const response = await call(`role=mentor&season=${SEASON_CODE}`);
    expect(response.status).toBe(401);
    expect(mocks.seen).toEqual([]);
    expect(mocks.seasonCalls).toEqual([]);
  });

  it("Support team xem được danh sách nhưng KHÔNG tải được; mentor, reviewer cũng vậy", async () => {
    for (const role of ["support_team", "mentor", "reviewer", "viewer"]) {
      mocks.admin = adminAs(role);
      const response = await call(`role=mentee&season=${SEASON_CODE}`);
      expect(response.status, role).toBe(403);
    }
    expect(mocks.seen).toEqual([]);
    expect(mocks.seasonCalls).toEqual([]);
  });

  it("đúng vai trò nhưng không có quyền vận hành mùa: 403, không đọc gì", async () => {
    mocks.canOperate = false;
    const response = await call(`role=mentor&season=${SEASON_CODE}`);
    expect(response.status).toBe(403);
    expect(mocks.seen).toEqual([]);
  });

  it("không đọc được phạm vi (lỗi hoặc ném lỗi): từ chối, không đọc gì — lỗi hạ tầng không thành quyền", async () => {
    mocks.scopeError = "admin_scope_access unreadable";
    expect((await call(`role=mentor&season=${SEASON_CODE}`)).status).toBe(403);
    mocks.scopeError = null;
    mocks.scopeThrows = true;
    expect((await call(`role=mentor&season=${SEASON_CODE}`)).status).toBe(403);
    expect(mocks.seen).toEqual([]);
  });

  it("mùa không được cấp / mùa sai / không đọc được danh mục mùa: từ chối, không đọc gì", async () => {
    mocks.seasonFailure = "denied";
    expect((await call("role=mentor")).status).toBe(403);
    mocks.seasonFailure = "invalid";
    expect((await call("role=mentor&season=UEHM-S99")).status).toBe(400);
    mocks.seasonFailure = "broken";
    expect((await call("role=mentor")).status).toBe(500);
    expect(mocks.seen).toEqual([]);
  });

  it("vai trò lạ hoặc thiếu: 400, không đoán", async () => {
    expect((await call("role=admin")).status).toBe(400);
    expect((await call("")).status).toBe(400);
    expect(mocks.seen).toEqual([]);
  });
});

describe("file tải về", () => {
  it("Admin: .xlsx một sheet, không lưu cache, tên file theo vai trò và mùa", async () => {
    const response = await call(`role=mentor&season=${SEASON_CODE}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="ho-so-mentor-S12-\d{8}\.xlsx"$/);
    const sheet = readSheet(await response.arrayBuffer());
    expect(sheet.sheetNames).toEqual(["Mentor"]);
  });

  it("dùng đúng mùa trang gửi kèm", async () => {
    await call(`role=mentor&season=${SEASON_CODE}`);
    expect(mocks.seasonCalls).toEqual([SEASON_CODE]);
  });

  it("đúng tập danh sách đang hiện: thành viên chính thức của mùa (active/completed), mỗi người một lần, xếp theo mã", async () => {
    const sheet = readSheet(await (await call(`role=mentor&season=${SEASON_CODE}`)).arrayBuffer());
    expect(columnValues(sheet, "Mã thành viên")).toEqual(["UEHC0001", "UEHR0002", "UEHR0003"]);
    expect(columnValues(sheet, "Họ và tên")).not.toContain("Mentor Đã Rút");
    expect(columnValues(sheet, "Liên kết hồ sơ (Bio / CV)")).toEqual([null, "https://drive.example.test/cv-1.pdf", null]);
    expect(columnValues(sheet, "Ngành nghề (danh mục)")).toEqual([null, "Tài chính", null]);
    expect(columnValues(sheet, "Đợt tuyển")).toEqual([null, "S12-MENTOR-01", null]);
    expect(sheet.headers).not.toContain("Ghi chú admin");
    expect(sheet.sheetXml).not.toContain("Không được ra file");
  });

  it("nút Mentee xuất đúng mentee, không lẫn mentor", async () => {
    const sheet = readSheet(await (await call(`role=mentee&season=${SEASON_CODE}`)).arrayBuffer());
    expect(sheet.sheetNames).toEqual(["Mentee"]);
    expect(columnValues(sheet, "Mã thành viên")).toEqual(["UEHE0001", "UEHE0002"]);
    expect(columnValues(sheet, "MSSV")).toEqual(["00000000011", null]);
    // Mentee không đọc danh mục ngành của mentor.
    expect(mocks.seen.some((s) => s.table === "mentor_industries")).toBe(false);
  });

  it("đọc hồ sơ và người bằng select * (mọi cột), không liệt kê cột tay", async () => {
    await call(`role=mentor&season=${SEASON_CODE}`);
    const profileReads = mocks.seen.filter((s) => s.table === "mentor_profiles" && s.cols !== "person_id" && !s.cols.startsWith("person_id,"));
    expect(profileReads.length).toBeGreaterThan(0);
    for (const read of profileReads) expect(read.cols).toBe("*");
    const peopleReads = mocks.seen.filter((s) => s.table === "people");
    expect(peopleReads.length).toBeGreaterThan(0);
    for (const read of peopleReads) expect(read.cols).toBe("*");
  });

  it("đọc thiếu một bảng thì báo lỗi, KHÔNG xuất file thiếu người", async () => {
    for (const table of ["people", "mentor_profiles", "person_season_memberships", "mentor_industries"]) {
      mocks.failTable = table;
      const response = await call(`role=mentor&season=${SEASON_CODE}`);
      expect(response.status, table).toBe(500);
      expect(response.headers.get("Content-Disposition"), table).toBeNull();
    }
  });

  it("hơn 1000 mentee: đọc phân trang đến hết, không ai bị cắt, không ai lặp", async () => {
    const count = 1205;
    for (let i = 0; i < count; i++) {
      const n = 1000 + i;
      mocks.tables.person_season_memberships.push(membership(n, "mentee"));
      mocks.tables.people.push(personRow(n, { member_code: `UEHE${String(n + 1000).padStart(4, "0")}` }));
      mocks.tables.mentee_profiles.push(menteeProfileRow(n));
    }
    const sheet = readSheet(await (await call(`role=mentee&season=${SEASON_CODE}`)).arrayBuffer());
    const codes = columnValues(sheet, "Mã thành viên");
    expect(codes).toHaveLength(count + 2);
    expect(new Set(codes).size).toBe(count + 2);
    expect(codes).toContain("UEHE2000");
    expect(codes).toContain(`UEHE${String(1000 + count - 1 + 1000)}`);
    // Không dòng nào mất họ tên: người cũng được đọc đủ, không chỉ hồ sơ.
    expect(columnValues(sheet, "Họ và tên").filter((name) => !name)).toEqual([]);
  });
});
