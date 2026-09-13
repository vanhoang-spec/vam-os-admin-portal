/**
 * Kích hoạt tài khoản nhân sự: không đòi xác nhận email, và KHÔNG tước quyền.
 *
 * ---------------------------------------------------------------------------
 * HAI LỖI CÓ THẬT, CÙNG MỘT NÚT
 * ---------------------------------------------------------------------------
 * 1. Nút Kích hoạt từng đòi `email_confirmed_at`. 13/09/2026 chị Thảo đặt mật
 *    khẩu xong, đăng nhập đúng mật khẩu 6 lần và lần nào cũng bị đẩy ra, vì tài
 *    khoản còn nằm ở `invited` chờ một cú bấm mà không ai biết là cần.
 *
 * 2. Nút đó gọi `vam062_admin_mutation_atomic` với payload trần
 *    `{ status: "active" }`. Không nêu phạm vi thì hàm SQL rơi vào nhánh TẮT MỌI
 *    phạm vi đang bật — nên kích hoạt xong, người đó đăng nhập được mà không còn
 *    quyền ở mùa nào. Lỗi này được phát hiện khi đọc hàm SQL, trước khi ai bấm.
 *
 * Phân loại: DIRECT PRODUCTION TESTS — gọi thẳng `setManagedAdminUserStatus`.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: vi.fn(),
  getSupabaseServiceRoleEnvStatus: vi.fn(() => ({
    envName: "SUPABASE_SERVICE_ROLE_KEY", loaded: true, usesPublicPrefix: false, sameAsAnonKey: false
  }))
}));
vi.mock("@/lib/account-auth-ownership", () => ({
  findExactAuthUsers: vi.fn(),
  resolveAuthOwnership: vi.fn()
}));
vi.mock("@/lib/email", () => ({ sendStaffInvite: vi.fn() }));
vi.mock("@/lib/public-url", () => ({ getPublicOrigin: vi.fn(async () => "https://os.example.org") }));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { setManagedAdminUserStatus } from "@/lib/admin-users";

const ADMIN_ID = "44444444-4444-4444-8444-444444444444";
const AUTH_ID = "33333333-3333-4333-8333-333333333333";
const ACTOR = "55555555-5555-4555-8555-555555555555";
const PROGRAM = "11111111-1111-4111-8111-111111111111";
const SEASON = "22222222-2222-4222-8222-222222222222";

const ROW = { role: "core_team", status: "invited", auth_user_id: AUTH_ID };
const SCOPE = { program_id: PROGRAM, season_id: SEASON, role: "operations" };

function makeClient(opts: {
  row?: Record<string, unknown>;
  scopes?: Array<Record<string, unknown>>;
  scopeError?: boolean;
} = {}) {
  const rpc = vi.fn(async (_name: string, _args: Record<string, any>) => ({ data: null, error: null }));
  const getUserById = vi.fn(async () => ({ data: { user: { id: AUTH_ID, email_confirmed_at: null } }, error: null }));
  const scopeFilters: Array<[string, unknown]> = [];
  const tables: string[] = [];
  const from = vi.fn((table: string) => {
    tables.push(table);
    const chain: any = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        if (table === "admin_scope_access") scopeFilters.push([column, value]);
        return chain;
      },
      neq: () => chain,
      order: () => chain,
      maybeSingle: async () => ({ data: opts.row ?? ROW, error: null }),
      limit: async () => opts.scopeError
        ? { data: null, error: { code: "42501", message: "denied" } }
        : { data: opts.scopes ?? [SCOPE], error: null }
    };
    return chain;
  });
  return { client: { from, rpc, auth: { admin: { getUserById } } }, rpc, getUserById, scopeFilters, tables };
}

function use(opts: Parameters<typeof makeClient>[0] = {}) {
  const fake = makeClient(opts);
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake.client as never);
  return fake;
}

const payloadOf = (fake: ReturnType<typeof makeClient>) => fake.rpc.mock.calls[0]?.[1]?.p_payload;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: ACTOR, role: "super_admin", status: "active" } as never);
});

describe("1. kích hoạt không còn chờ xác nhận email", () => {
  it("người đã mời, CHƯA xác nhận email: kích hoạt được, không hỏi Supabase", async () => {
    const fake = use();

    const result = await setManagedAdminUserStatus(ADMIN_ID, "active");

    expect(result.ok).toBe(true);
    expect(fake.getUserById).not.toHaveBeenCalled();
    expect(fake.rpc).toHaveBeenCalledWith("vam062_admin_mutation_atomic", expect.objectContaining({
      p_operation: "status",
      p_target_admin_user_id: ADMIN_ID
    }));
  });

  it("người đã mời mà chưa liên kết Auth: từ chối, không gọi hàm SQL", async () => {
    const fake = use({ row: { ...ROW, auth_user_id: null } });

    const result = await setManagedAdminUserStatus(ADMIN_ID, "active");

    expect(result.ok).toBe(false);
    expect(fake.rpc).not.toHaveBeenCalled();
  });
});

describe("2. kích hoạt KHÔNG được tắt quyền đang có", () => {
  it("nêu đích danh một phạm vi đang bật của đúng người này", async () => {
    const fake = use();

    await setManagedAdminUserStatus(ADMIN_ID, "active");

    expect(payloadOf(fake)).toEqual({
      status: "active",
      program_id: PROGRAM,
      season_id: SEASON,
      scope_role: "operations"
    });
    // Đọc đúng người, đúng các phạm vi ĐANG BẬT — không phải phạm vi bất kỳ.
    expect(fake.scopeFilters).toContainEqual(["user_id", AUTH_ID]);
    expect(fake.scopeFilters).toContainEqual(["status", "active"]);
  });

  it("nhiều phạm vi: bỏ qua phạm vi không nêu được đích danh, lấy phạm vi đầu tiên có đủ program/season", async () => {
    const fake = use({
      scopes: [
        { program_id: null, season_id: null, role: "read" },
        SCOPE,
        { program_id: PROGRAM, season_id: "99999999-9999-4999-8999-999999999999", role: "review" }
      ]
    });

    await setManagedAdminUserStatus(ADMIN_ID, "active");

    expect(payloadOf(fake)).toMatchObject({ program_id: PROGRAM, season_id: SEASON, scope_role: "operations" });
  });

  it("có phạm vi đang bật nhưng không nêu được đích danh: dừng, không gọi hàm SQL", async () => {
    const fake = use({ scopes: [{ program_id: null, season_id: null, role: "read" }] });

    const result = await setManagedAdminUserStatus(ADMIN_ID, "active");

    expect(result.ok).toBe(false);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("đọc bảng phạm vi hỏng: dừng, không gọi hàm SQL — không để lỗi hạ tầng thành mất quyền", async () => {
    const fake = use({ scopeError: true });

    const result = await setManagedAdminUserStatus(ADMIN_ID, "active");

    expect(result.ok).toBe(false);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("không có phạm vi nào đang bật: gọi trần là an toàn — nhánh tắt không còn gì để tắt", async () => {
    const fake = use({ scopes: [] });

    const result = await setManagedAdminUserStatus(ADMIN_ID, "active");

    expect(result.ok).toBe(true);
    expect(payloadOf(fake)).toEqual({ status: "active" });
  });
});

describe("3. tạm khóa giữ nguyên hành vi cũ", () => {
  it("tạm khóa gửi payload trần — tắt mọi phạm vi là đúng ý khi khoá, và không đọc bảng phạm vi", async () => {
    const fake = use({ row: { ...ROW, status: "active" } });

    const result = await setManagedAdminUserStatus(ADMIN_ID, "inactive");

    expect(result.ok).toBe(true);
    expect(payloadOf(fake)).toEqual({ status: "inactive" });
    expect(fake.tables).not.toContain("admin_scope_access");
  });
});

describe("4. vì sao phải nêu phạm vi", () => {
  it("hàm SQL gọi không kèm phạm vi sẽ tắt MỌI phạm vi đang bật, kể cả khi kích hoạt", () => {
    // Nếu một migration sau sửa nhánh này, test đỏ để nhắc xem lại activationPayload
    // — lúc đó cách nêu phạm vi có thể không còn cần.
    const sql = readFileSync("supabase/migrations/20260913150000_admin_user_provisioning_rpcs.sql", "utf8");
    const statusBranch = sql.slice(sql.indexOf("elsif p_operation in ('status','remove')"), sql.indexOf("unsupported operation"));
    expect(statusBranch).toContain("update public.admin_scope_access set status='inactive' where user_id=v_auth and status='active';");
  });
});
