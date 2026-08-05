import { describe, expect, it, vi, beforeEach } from "vitest";
import { loginAction } from "@/app/login/actions";
import { findAdminUserForAuthUser } from "@/lib/admin-auth";
import * as adminAuth from "@/lib/admin-auth";
import * as supabaseServer from "@/lib/supabase-server";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: vi.fn(),
  getSupabaseServiceRoleEnvStatus: () => ({ SUPABASE_SERVICE_ROLE_KEY: "ok" }),
}));

vi.mock("@/lib/admin-auth", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    getSupabaseAuthClientForPasswordSignIn: vi.fn(),
    clearAuthCookies: vi.fn(),
    setAuthCookies: vi.fn(),
  };
});

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

describe("Server-Side Login Flow", () => {
  let mockAuthClient: any;
  let mockServiceClient: any;
  let queryMock: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAuthClient = {
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({
          data: { session: { access_token: "token", refresh_token: "refresh", expires_in: 3600 }, user: { id: "user-id-1", email: "user@example.com" } },
          error: null,
        }),
        signOut: vi.fn(),
      }
    };
    (adminAuth.getSupabaseAuthClientForPasswordSignIn as any).mockReturnValue(mockAuthClient);

    queryMock = vi.fn();
    const createQueryBuilder = () => {
      const builder: any = new Promise((resolve, reject) => {
        Promise.resolve(queryMock()).then(resolve).catch(reject);
      });
      builder.select = vi.fn(() => builder);
      builder.eq = vi.fn(() => builder);
      builder.or = vi.fn(() => builder);
      builder.limit = vi.fn(() => builder);
      builder.is = vi.fn(() => builder);
      builder.maybeSingle = vi.fn(() => builder);
      return builder;
    };

    mockServiceClient = {
      from: vi.fn(() => ({
        select: vi.fn(() => createQueryBuilder()),
        update: vi.fn(() => createQueryBuilder()),
      }))
    };
    (supabaseServer.getSupabaseServiceRoleClient as any).mockReturnValue(mockServiceClient);
  });

  describe("loginAction", () => {
    it("authentication receives the trimmed/lowercase email once", async () => {
      const formData = new FormData();
      formData.set("email", "  USER@Example.COM  ");
      formData.set("password", "pass");
      
      // Mock findAdminUserForAuthUser via mocking the service client to return a valid row
      queryMock.mockResolvedValueOnce({ data: [{ id: "admin-1", auth_user_id: "user-id-1", email: "user@example.com", status: "active" }], error: null });
      
      await loginAction({ error: null }, formData);
      
      expect(mockAuthClient.auth.signInWithPassword).toHaveBeenCalledTimes(1);
      expect(mockAuthClient.auth.signInWithPassword).toHaveBeenCalledWith({
        email: "user@example.com",
        password: "pass",
      });
    });

    it("authentication failure does not create an authorized session", async () => {
      const formData = new FormData();
      formData.set("email", "user@example.com");
      formData.set("password", "wrong");
      
      mockAuthClient.auth.signInWithPassword.mockResolvedValueOnce({
        data: { session: null, user: null },
        error: { status: 400, message: "Invalid login credentials" },
      });
      
      const res = await loginAction({ error: null }, formData);
      
      expect(res.error).toBe("Email hoặc mật khẩu chưa đúng. Vui lòng kiểm tra và thử lại.");
      expect(adminAuth.setAuthCookies).not.toHaveBeenCalled();
      expect(adminAuth.clearAuthCookies).toHaveBeenCalled();
      const { redirect } = await import("next/navigation");
      expect(redirect).not.toHaveBeenCalled();
    });

    it("successful flow redirects exactly once", async () => {
      const formData = new FormData();
      formData.set("email", "user@example.com");
      formData.set("password", "pass");
      
      queryMock.mockResolvedValueOnce({ data: [{ id: "admin-1", auth_user_id: "user-id-1", email: "user@example.com", status: "active" }], error: null });
      
      await loginAction({ error: null }, formData);
      
      expect(adminAuth.setAuthCookies).toHaveBeenCalled();
      const { redirect } = await import("next/navigation");
      expect(redirect).toHaveBeenCalledTimes(1);
      expect(redirect).toHaveBeenCalledWith("/operations");
    });
  });

  describe("findAdminUserForAuthUser (identity linking)", () => {
    const user = { id: "user-id-1", email: "user@example.com" };

    it("primary UUID match does not invoke legacy linking", async () => {
      queryMock.mockResolvedValueOnce({ data: [{ id: "admin-1", auth_user_id: "user-id-1", email: "user@example.com", status: "active" }], error: null });
      
      const admin = await findAdminUserForAuthUser(user as any);
      expect(admin).not.toBeNull();
      // select was called, update was not (queryMock called exactly once)
      expect(queryMock).toHaveBeenCalledTimes(1);
    });

    it("unique null legacy row is linked conditionally and succeeds", async () => {
      queryMock.mockResolvedValueOnce({ data: [{ id: "admin-1", auth_user_id: null, email: "user@example.com", status: "active" }], error: null });
      queryMock.mockResolvedValueOnce({ data: [{ id: "admin-1" }], error: null }); // update returning data
      
      const admin = await findAdminUserForAuthUser(user as any);
      expect(admin).not.toBeNull();
      expect(queryMock).toHaveBeenCalledTimes(2);
    });

    it("update database error signs out and does not redirect (in loginAction)", async () => {
      queryMock.mockResolvedValueOnce({ data: [{ id: "admin-1", auth_user_id: null, email: "user@example.com", status: "active" }], error: null });
      queryMock.mockResolvedValueOnce({ data: null, error: { message: "DB Error" } }); // update fails
      
      await expect(findAdminUserForAuthUser(user as any)).rejects.toThrow("DB Error");
      
      const formData = new FormData();
      formData.set("email", "user@example.com");
      formData.set("password", "pass");
      
      queryMock.mockResolvedValueOnce({ data: [{ id: "admin-1", auth_user_id: null, email: "user@example.com", status: "active" }], error: null });
      queryMock.mockResolvedValueOnce({ data: null, error: { message: "DB Error" } }); // update fails again for loginAction test
      
      const res = await loginAction({ error: null }, formData);
      expect(res.error).toBe("Tài khoản này chưa được cấp quyền truy cập VAM OS. Vui lòng liên hệ người phụ trách.");
      expect(mockAuthClient.auth.signOut).toHaveBeenCalled();
      const { redirect } = await import("next/navigation");
      expect(redirect).not.toHaveBeenCalled();
    });

    it("zero-row update triggers a safe re-read and succeeds on same-UUID race", async () => {
      queryMock.mockResolvedValueOnce({ data: [{ id: "admin-1", auth_user_id: null, email: "user@example.com", status: "active" }], error: null });
      queryMock.mockResolvedValueOnce({ data: [], error: null }); // update returns 0 rows
      queryMock.mockResolvedValueOnce({ data: { auth_user_id: "user-id-1" }, error: null }); // re-read shows same UUID
      
      const admin = await findAdminUserForAuthUser(user as any);
      expect(admin).not.toBeNull();
      expect(queryMock).toHaveBeenCalledTimes(3);
    });

    it("different-UUID conflict signs out and fails", async () => {
      queryMock.mockResolvedValueOnce({ data: [{ id: "admin-1", auth_user_id: null, email: "user@example.com", status: "active" }], error: null });
      queryMock.mockResolvedValueOnce({ data: [], error: null }); // update returns 0 rows
      queryMock.mockResolvedValueOnce({ data: { auth_user_id: "different-id" }, error: null }); // re-read shows different UUID
      
      await expect(findAdminUserForAuthUser(user as any)).rejects.toThrow("identity link conflict");
    });

    it("ambiguous normalized-email match fails closed (not active)", async () => {
      queryMock.mockResolvedValueOnce({ data: [], error: null }); // lookup returns nothing because not active
      
      const admin = await findAdminUserForAuthUser(user as any);
      expect(admin).toBeNull();
      
      const formData = new FormData();
      formData.set("email", "user@example.com");
      formData.set("password", "pass");
      queryMock.mockResolvedValueOnce({ data: [], error: null });
      const res = await loginAction({ error: null }, formData);
      expect(res.error).toBe("Tài khoản này chưa được cấp quyền truy cập VAM OS. Vui lòng liên hệ người phụ trách.");
    });
  });
});
