import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";
import { loginAction } from "@/app/login/actions";
import { findAdminUserForAuthUser } from "@/lib/admin-auth";
import * as adminAuth from "@/lib/admin-auth";
import * as supabaseServer from "@/lib/supabase-server";
import { redirect } from "next/navigation";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: vi.fn(),
  getSupabaseServiceRoleEnvStatus: () => ({ SUPABASE_SERVICE_ROLE_KEY: "ok" })
}));

vi.mock("@/lib/admin-auth", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    getSupabaseAuthClientForPasswordSignIn: vi.fn(),
    clearAuthCookies: vi.fn(),
    setAuthCookies: vi.fn()
  };
});

/**
 * Production `redirect()` never returns — it throws a control-flow exception
 * that Next's server-action runtime converts into a navigation. Mocking it as a
 * plain no-op `vi.fn()` lets execution fall through the end of the action and
 * would hide a regression that moved the call inside a try/catch. We therefore
 * reproduce the real semantics with a NEXT_REDIRECT sentinel: a test that
 * expects a successful login must observe a rejection, which is what proves the
 * redirect escaped uncaught.
 */
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    const error = new Error("NEXT_REDIRECT") as Error & { digest: string };
    error.digest = `NEXT_REDIRECT;push;${url};307;`;
    throw error;
  })
}));

const UNAUTHORIZED_MESSAGE = "Sai email hoặc mật khẩu";
const INVALID_CREDENTIALS_MESSAGE = "Sai email hoặc mật khẩu";

type StageOp = "select" | "update";

/**
 * One recorded PostgREST query stage. Each stage owns its OWN stub functions —
 * there is deliberately no shared `queryMock` standing in for several stages,
 * so an assertion about the UPDATE cannot be satisfied by calls that actually
 * belong to the initial read.
 */
type QueryStage = {
  table: string;
  op: StageOp;
  /** payload handed to `.update()`; undefined for reads */
  payload: unknown;
  /** columns handed to the entry `.select()` */
  columns?: string;
  select: Mock;
  eq: Mock;
  or: Mock;
  limit: Mock;
  is: Mock;
  ilike: Mock;
  maybeSingle: Mock;
};

function createServiceClientMock() {
  const stages: QueryStage[] = [];
  const results: unknown[] = [];

  const newStage = (table: string, op: StageOp, payload: unknown) => {
    const builder: any = {};
    const stage = { table, op, payload } as QueryStage;

    // `ilike` có mặt vì đường participant dò email không phân biệt hoa thường.
    for (const name of ["select", "eq", "or", "limit", "is", "ilike"] as const) {
      const fn = vi.fn((..._args: unknown[]) => builder);
      stage[name] = fn;
      builder[name] = fn;
    }
    const maybeSingle = vi.fn(() => builder);
    stage.maybeSingle = maybeSingle;
    builder.maybeSingle = maybeSingle;

    stages.push(stage);

    // Resolve with the result queued for THIS stage's position. A missing entry
    // surfaces as an explicit failure instead of silently reusing another
    // stage's result.
    builder.then = (onFulfilled: any, onRejected: any) => {
      const index = stages.indexOf(stage);
      if (index >= results.length) {
        return Promise.reject(
          new Error(`No mock result queued for query stage #${index} (${op} ${table})`)
        ).then(onFulfilled, onRejected);
      }
      return Promise.resolve(results[index]).then(onFulfilled, onRejected);
    };

    return { builder, stage };
  };

  const from = vi.fn((table: string) => ({
    select: vi.fn((columns: string) => {
      const { builder, stage } = newStage(table, "select", undefined);
      stage.columns = columns;
      return builder;
    }),
    update: vi.fn((payload: unknown) => newStage(table, "update", payload).builder)
  }));

  return {
    client: { from },
    from,
    stages,
    updateStages: () => stages.filter((stage) => stage.op === "update"),
    queue: (...values: unknown[]) => {
      results.push(...values);
    }
  };
}

const authUser = { id: "user-id-1", email: "user@example.com" };

// Factories, not shared constants: findAdminUserForAuthUser mutates the row it
// selects (`row.auth_user_id = user.id`), so a shared object would leak state
// between tests and silently turn a legacy row into a linked one.
const linkedRow = (overrides: Record<string, unknown> = {}) => ({
  id: "admin-1",
  auth_user_id: "user-id-1",
  email: "user@example.com",
  full_name: "Admin One",
  role: "admin",
  status: "active",
  ...overrides
});

const legacyRow = (overrides: Record<string, unknown> = {}) => ({
  id: "admin-1",
  auth_user_id: null,
  email: "user@example.com",
  full_name: "Admin One",
  role: "admin",
  status: "active",
  ...overrides
});

describe("Server-Side Login Flow", () => {
  let mockAuthClient: any;
  let service: ReturnType<typeof createServiceClientMock>;

  const loginFormData = (email = "user@example.com", password = "pass") => {
    const formData = new FormData();
    formData.set("email", email);
    formData.set("password", password);
    return formData;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockAuthClient = {
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({
          data: {
            session: { access_token: "token", refresh_token: "refresh", expires_in: 3600 },
            user: { id: "user-id-1", email: "user@example.com" }
          },
          error: null
        }),
        signOut: vi.fn().mockResolvedValue({ error: null })
      }
    };
    (adminAuth.getSupabaseAuthClientForPasswordSignIn as any).mockReturnValue(mockAuthClient);

    service = createServiceClientMock();
    (supabaseServer.getSupabaseServiceRoleClient as any).mockReturnValue(service.client);
  });

  describe("loginAction — authentication and session control flow", () => {
    it("passes the trimmed, lowercased email to authentication exactly once", async () => {
      service.queue({ data: [linkedRow()], error: null });

      await expect(loginAction({ error: null }, loginFormData("  USER@Example.COM  ", "pass"))).rejects.toThrow(
        "NEXT_REDIRECT"
      );

      expect(mockAuthClient.auth.signInWithPassword).toHaveBeenCalledTimes(1);
      expect(mockAuthClient.auth.signInWithPassword).toHaveBeenCalledWith({
        email: "user@example.com",
        password: "pass"
      });
    });

    it("rejects missing credentials before contacting the auth provider", async () => {
      const res = await loginAction({ error: null }, loginFormData("", ""));

      expect(res.error).toBe("Vui lòng nhập email và mật khẩu.");
      expect(mockAuthClient.auth.signInWithPassword).not.toHaveBeenCalled();
      expect(adminAuth.setAuthCookies).not.toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
    });

    it("authentication failure does not create an authorized session", async () => {
      mockAuthClient.auth.signInWithPassword.mockResolvedValueOnce({
        data: { session: null, user: null },
        error: { status: 400, message: "Invalid login credentials" }
      });

      const res = await loginAction({ error: null }, loginFormData("user@example.com", "wrong"));

      expect(res.error).toBe(INVALID_CREDENTIALS_MESSAGE);
      expect(adminAuth.setAuthCookies).not.toHaveBeenCalled();
      expect(adminAuth.clearAuthCookies).toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
      expect(service.stages).toHaveLength(0);
    });

    it("sets cookies then redirects exactly once, and the redirect is not caught", async () => {
      service.queue({ data: [linkedRow()], error: null });

      // The rejection IS the proof: `redirect()` throws in production, and the
      // action must let that exception propagate rather than convert it into an
      // error state.
      await expect(loginAction({ error: null }, loginFormData())).rejects.toThrow("NEXT_REDIRECT");

      expect(adminAuth.setAuthCookies).toHaveBeenCalledTimes(1);
      expect(adminAuth.setAuthCookies).toHaveBeenCalledWith("token", "refresh", 3600);
      expect(redirect).toHaveBeenCalledTimes(1);
      expect(redirect).toHaveBeenCalledWith("/");
      expect(mockAuthClient.auth.signOut).not.toHaveBeenCalled();
    });

    it("không có dòng nhân sự nào, và cũng không nhận ra trong danh bạ, thì từ chối", async () => {
      // Bốn truy vấn, theo đúng thứ tự mã chạy:
      //   1. đọc admin_users lọc status = active   → rỗng
      //   2. kiểm có dòng admin_users nào không    → rỗng (chưa bao giờ là nhân sự)
      //   3. đọc mối nối danh tính participant     → chưa có
      //   4. dò email trong danh bạ                → không ai
      service.queue(
        { data: [], error: null },
        { data: [], error: null },
        { data: null, error: null },
        { data: [], error: null }
      );

      const res = await loginAction({ error: null }, loginFormData());

      // Lời báo ở đây KHÁC "sai email hoặc mật khẩu", và đó là chủ ý.
      //
      // Người này vừa nhập đúng mật khẩu — họ đã chứng minh mình sở hữu tài
      // khoản. Bảo họ "sai mật khẩu" là đẩy một mentor thật đi đặt lại một mật
      // khẩu vốn không sai gì cả, rồi đặt xong vẫn không vào được.
      //
      // Nó cũng không lộ chuyện của ai: câu trả lời chỉ nói về chính tài khoản
      // mà người gõ vừa chứng minh là của mình.
      expect(res.error).toContain("ban tổ chức");
      expect(res.error).not.toBe(UNAUTHORIZED_MESSAGE);
      expect(mockAuthClient.auth.signOut).toHaveBeenCalledTimes(1);
      expect(adminAuth.clearAuthCookies).toHaveBeenCalled();
      expect(adminAuth.setAuthCookies).not.toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
    });
  });

  describe("findAdminUserForAuthUser — query shape", () => {
    it("reads admin_users filtered to active status, with the ambiguity-detecting limit", async () => {
      service.queue({ data: [linkedRow()], error: null });

      await findAdminUserForAuthUser(authUser as any);

      expect(service.from).toHaveBeenCalledWith("admin_users");
      const [read] = service.stages;
      expect(read.op).toBe("select");
      expect(read.columns).toBe("id,auth_user_id,email,full_name,role,status");
      expect(read.eq).toHaveBeenCalledWith("status", "active");
      expect(read.or).toHaveBeenCalledWith("auth_user_id.eq.user-id-1,email.eq.user@example.com");
      // limit(3), not limit(2): a third row is what makes corruption detectable
      // instead of being truncated away by the limit itself.
      expect(read.limit).toHaveBeenCalledWith(3);
    });

    it("a primary UUID match authorizes without issuing any UPDATE", async () => {
      service.queue({ data: [linkedRow()], error: null });

      const admin = await findAdminUserForAuthUser(authUser as any);

      expect(admin?.id).toBe("admin-1");
      expect(service.stages).toHaveLength(1);
      expect(service.updateStages()).toHaveLength(0);
    });

    it("scopes the legacy-link UPDATE to the exact row id, conditioned on auth_user_id IS NULL, never by email", async () => {
      service.queue({ data: [legacyRow()], error: null }, { data: [{ id: "admin-1" }], error: null });

      const admin = await findAdminUserForAuthUser(authUser as any);
      expect(admin?.auth_user_id).toBe("user-id-1");

      const [read, update] = service.stages;
      // Distinct stages, each with its own stubs — the UPDATE assertions below
      // cannot be satisfied by calls belonging to the read.
      expect(service.stages).toHaveLength(2);
      expect(update).not.toBe(read);
      expect(update.op).toBe("update");
      expect(update.table).toBe("admin_users");

      // The write payload carries the authenticated UUID and nothing else.
      expect(update.payload).toEqual({ auth_user_id: "user-id-1" });
      expect(Object.keys(update.payload as object)).toEqual(["auth_user_id"]);

      // Scoped by primary row id only. The regression being guarded against is
      // the removed `.eq("email", ...)` mass-update.
      expect(update.eq).toHaveBeenCalledWith("id", "admin-1");
      expect(update.eq.mock.calls.map((call) => call[0])).toEqual(["id"]);
      expect(update.eq).not.toHaveBeenCalledWith("email", expect.anything());

      // Conditional write: only claims a row that is still unlinked.
      expect(update.is).toHaveBeenCalledWith("auth_user_id", null);

      // Returning clause, so the affected-row count is inspected not assumed.
      expect(update.select).toHaveBeenCalledWith("id");
    });

    it("re-reads the same exact row id after a zero-row update", async () => {
      service.queue(
        { data: [legacyRow()], error: null },
        { data: [], error: null },
        { data: { auth_user_id: "user-id-1" }, error: null }
      );

      const admin = await findAdminUserForAuthUser(authUser as any);
      expect(admin?.auth_user_id).toBe("user-id-1");

      expect(service.stages).toHaveLength(3);
      const [read, update, reRead] = service.stages;
      expect(new Set([read, update, reRead]).size).toBe(3);
      expect(reRead.op).toBe("select");
      expect(reRead.table).toBe("admin_users");
      expect(reRead.columns).toBe("auth_user_id");
      expect(reRead.eq).toHaveBeenCalledWith("id", "admin-1");
      expect(reRead.maybeSingle).toHaveBeenCalledTimes(1);
    });
  });

  describe("findAdminUserForAuthUser — ambiguity fails closed", () => {
    it("rejects two active legacy rows sharing one normalized email, without issuing an UPDATE", async () => {
      service.queue({
        data: [
          legacyRow({ id: "admin-1", role: "viewer" }),
          legacyRow({ id: "admin-2", role: "super_admin" })
        ],
        error: null
      });

      await expect(findAdminUserForAuthUser(authUser as any)).rejects.toThrow(/ambiguous admin identity/);

      // Critical: no row was linked, so no privilege was granted from an
      // arbitrarily chosen row.
      expect(service.updateStages()).toHaveLength(0);
      expect(service.stages).toHaveLength(1);
    });

    it("rejects two active rows linked to the same authenticated UUID", async () => {
      service.queue({
        data: [
          linkedRow({ id: "admin-1", role: "viewer" }),
          linkedRow({ id: "admin-2", role: "super_admin" })
        ],
        error: null
      });

      await expect(findAdminUserForAuthUser(authUser as any)).rejects.toThrow(/ambiguous admin identity/);
      expect(service.updateStages()).toHaveLength(0);
    });

    it("still prefers the linked row when one linked and one legacy row coexist", async () => {
      service.queue({
        data: [
          legacyRow({ id: "admin-2", role: "viewer" }),
          linkedRow({ id: "admin-1", role: "super_admin" })
        ],
        error: null
      });

      const admin = await findAdminUserForAuthUser(authUser as any);

      expect(admin?.id).toBe("admin-1");
      expect(admin?.role).toBe("super_admin");
      expect(service.updateStages()).toHaveLength(0);
    });

    it("denies a row that is linked to a different auth user and shares the email", async () => {
      service.queue({
        data: [linkedRow({ auth_user_id: "someone-else" })],
        error: null
      });

      const admin = await findAdminUserForAuthUser(authUser as any);

      expect(admin).toBeNull();
      expect(service.updateStages()).toHaveLength(0);
    });
  });

  describe("findAdminUserForAuthUser — database and race failures fail closed", () => {
    it("initial read error rejects, and loginAction signs out without redirecting", async () => {
      service.queue({ data: null, error: { message: "DB read error" } });
      await expect(findAdminUserForAuthUser(authUser as any)).rejects.toThrow("DB read error");

      service = createServiceClientMock();
      (supabaseServer.getSupabaseServiceRoleClient as any).mockReturnValue(service.client);
      service.queue({ data: null, error: { message: "DB read error" } });

      const res = await loginAction({ error: null }, loginFormData());

      expect(res.error).toBe(UNAUTHORIZED_MESSAGE);
      expect(mockAuthClient.auth.signOut).toHaveBeenCalledTimes(1);
      expect(adminAuth.clearAuthCookies).toHaveBeenCalled();
      expect(adminAuth.setAuthCookies).not.toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
    });

    it("update error rejects, and loginAction signs out without redirecting", async () => {
      service.queue({ data: [legacyRow()], error: null }, { data: null, error: { message: "DB write error" } });

      const res = await loginAction({ error: null }, loginFormData());

      expect(res.error).toBe(UNAUTHORIZED_MESSAGE);
      expect(mockAuthClient.auth.signOut).toHaveBeenCalledTimes(1);
      expect(adminAuth.clearAuthCookies).toHaveBeenCalled();
      expect(adminAuth.setAuthCookies).not.toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
    });

    it("different-UUID race rejects, and loginAction signs out without redirecting", async () => {
      service.queue(
        { data: [legacyRow()], error: null },
        { data: [], error: null },
        { data: { auth_user_id: "different-user-id" }, error: null }
      );

      const res = await loginAction({ error: null }, loginFormData());

      expect(res.error).toBe(UNAUTHORIZED_MESSAGE);
      expect(mockAuthClient.auth.signOut).toHaveBeenCalledTimes(1);
      expect(adminAuth.setAuthCookies).not.toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
    });

    it("null re-read rejects, and loginAction signs out without redirecting", async () => {
      service.queue(
        { data: [legacyRow()], error: null },
        { data: [], error: null },
        { data: null, error: null }
      );

      const res = await loginAction({ error: null }, loginFormData());

      expect(res.error).toBe(UNAUTHORIZED_MESSAGE);
      expect(mockAuthClient.auth.signOut).toHaveBeenCalledTimes(1);
      expect(adminAuth.setAuthCookies).not.toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
    });

    it("malformed re-read without an auth_user_id rejects", async () => {
      service.queue(
        { data: [legacyRow()], error: null },
        { data: [], error: null },
        { data: { auth_user_id: null }, error: null }
      );

      await expect(findAdminUserForAuthUser(authUser as any)).rejects.toThrow("identity link conflict");
    });

    it("re-read error rejects", async () => {
      service.queue(
        { data: [legacyRow()], error: null },
        { data: [], error: null },
        { data: null, error: { message: "re-read failed" } }
      );

      await expect(findAdminUserForAuthUser(authUser as any)).rejects.toThrow("re-read failed");
    });

    it("a missing service-role client rejects instead of silently degrading", async () => {
      (supabaseServer.getSupabaseServiceRoleClient as any).mockReturnValue(null);

      const res = await loginAction({ error: null }, loginFormData());

      expect(res.error).toBe(UNAUTHORIZED_MESSAGE);
      expect(mockAuthClient.auth.signOut).toHaveBeenCalledTimes(1);
      expect(adminAuth.setAuthCookies).not.toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
    });
  });

  describe("ineligible administrators are not authorized", () => {
    // The active-status gate is enforced in SQL, so the meaningful assertion is
    // that the predicate is actually applied to the read. Each ineligible status
    // is then exercised through the DB honouring that filter (empty result set).
    for (const status of ["invited", "suspended", "inactive"] as const) {
      it(`một quản trị viên ${status} bị lọc khỏi phép đọc active và bị từ chối`, async () => {
        // Truy vấn thứ hai TRẢ VỀ MỘT DÒNG: người này CÓ trong admin_users,
        // chỉ là không ở trạng thái hoạt động. Đó chính là thứ chặn họ khỏi
        // rơi xuống đường participant.
        service.queue(
          { data: [], error: null },
          { data: [{ id: "admin-1" }], error: null }
        );

        const res = await loginAction({ error: null }, loginFormData());

        const [read] = service.stages;
        expect(read.eq).toHaveBeenCalledWith("status", "active");
        expect(read.eq).not.toHaveBeenCalledWith("status", status);

        expect(res.error).toBe(UNAUTHORIZED_MESSAGE);
        expect(mockAuthClient.auth.signOut).toHaveBeenCalledTimes(1);
        expect(adminAuth.setAuthCookies).not.toHaveBeenCalled();
        expect(redirect).not.toHaveBeenCalled();
      });
    }
  });

  describe("nhân sự bị khoá KHÔNG rơi xuống đường participant", () => {
    // Thu hồi quyền nhân sự của một người rồi lặng lẽ đưa cho họ một cánh cửa
    // khác trong cùng phiên đó là điều người bấm nút đình chỉ không hề biết
    // mình vừa làm. findAdminUserForAuthUser lọc sẵn status = active nên nó
    // trả về null giống hệt nhau cho "chưa bao giờ là nhân sự" và "đã bị
    // khoá" — phép kiểm tồn tại là thứ tách hai trường hợp ấy ra.
    it("dừng lại ngay khi thấy có dòng admin_users, KHÔNG dò danh bạ", async () => {
      service.queue(
        { data: [], error: null },
        { data: [{ id: "admin-1" }], error: null }
      );

      const res = await loginAction({ error: null }, loginFormData());

      expect(res.error).toBe(UNAUTHORIZED_MESSAGE);
      expect(adminAuth.setAuthCookies).not.toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();

      // Đúng hai truy vấn. Có truy vấn thứ ba nghĩa là đã bắt đầu dò danh bạ
      // — tức là đã bước vào đường participant.
      expect(service.stages).toHaveLength(2);
      for (const stage of service.stages) {
        expect(stage.table).toBe("admin_users");
      }
    });

    it("đọc hỏng ở phép kiểm tồn tại thì TỪ CHỐI, không đoán là chưa từng là nhân sự", async () => {
      // Fail-closed. Coi một lỗi đọc là "không có dòng nào" nghĩa là một sự cố
      // hạ tầng mở ra đúng cánh cửa mà phép kiểm này sinh ra để đóng.
      service.queue(
        { data: [], error: null },
        { data: null, error: { message: "DB read error" } }
      );

      const res = await loginAction({ error: null }, loginFormData());

      expect(res.error).toBeTruthy();
      expect(adminAuth.setAuthCookies).not.toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
    });
  });

  describe("error messages stay generic", () => {
    it("lỗi hạ tầng và dữ liệu hỏng nói y hệt nhau, và không lộ gì bên trong", async () => {
      service.queue(
        { data: [], error: null },
        { data: [], error: null },
        { data: null, error: null },
        { data: [], error: null }
      );
      const noMatch = await loginAction({ error: null }, loginFormData());

      service = createServiceClientMock();
      (supabaseServer.getSupabaseServiceRoleClient as any).mockReturnValue(service.client);
      service.queue({ data: null, error: { message: "DB read error" } });
      const dbError = await loginAction({ error: null }, loginFormData());

      service = createServiceClientMock();
      (supabaseServer.getSupabaseServiceRoleClient as any).mockReturnValue(service.client);
      service.queue({
        data: [
          legacyRow({ id: "admin-1" }),
          legacyRow({ id: "admin-2" })
        ],
        error: null
      });
      const ambiguous = await loginAction({ error: null }, loginFormData());

      // Tính chất phải giữ: "database hỏng" và "dữ liệu nhân sự nhập nhằng"
      // KHÔNG phân biệt được với nhau, và không lời nào để lộ gì bên trong.
      expect(dbError.error).toBe(UNAUTHORIZED_MESSAGE);
      expect(ambiguous.error).toBe(UNAUTHORIZED_MESSAGE);
      expect(dbError.error).not.toContain("DB read error");
      expect(ambiguous.error).not.toContain("admin_users");

      // "Không phải nhân sự, và cũng không nhận ra trong danh bạ" thì nói
      // khác — xem lời giải thích ở ca trên. Nhưng nó vẫn không được nhắc tới
      // tên bảng hay lời lỗi của database.
      expect(noMatch.error).not.toContain("admin_users");
      expect(noMatch.error).not.toContain("people");
      expect(noMatch.error).not.toContain("DB read error");
    });
  });
});
