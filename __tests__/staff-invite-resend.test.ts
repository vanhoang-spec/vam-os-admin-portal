/**
 * Gửi link đặt mật khẩu cho tài khoản nhân sự đang hoạt động hoặc còn ở trạng
 * thái đã mời.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO ĐƯỜNG NÀY TỒN TẠI
 * ---------------------------------------------------------------------------
 * Thư mời nhân sự đầu tiên trên production không đi được: máy chủ không dựng
 * được link vì production không đặt VAM_OS_PUBLIC_BASE_URL và nơi gọi không
 * truyền địa chỉ của request. Tài khoản đã tạo, người được mời không nhận được
 * gì, và tạo lại thì bị từ chối vì địa chỉ đã có tài khoản đăng nhập.
 *
 * Bộ test canh ba điều: không gửi nhầm người (mã phải thuộc đúng tài khoản), không
 * mở cửa cho tài khoản đang khoá, và luôn truyền địa chỉ request.
 *
 * Phân loại: DIRECT PRODUCTION TESTS — gọi thẳng `resendManagedAdminInvite`.
 */
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
vi.mock("@/lib/public-url", () => ({ getPublicOrigin: vi.fn(async () => "https://os.alumni-mentoring.edu.vn") }));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { sendStaffInvite } from "@/lib/email";
import { resendManagedAdminInvite } from "@/lib/admin-users";

const ADMIN_ID = "44444444-4444-4444-8444-444444444444";
const AUTH_ID = "33333333-3333-4333-8333-333333333333";
const ACTOR = "55555555-5555-4555-8555-555555555555";
const ORIGIN = "https://os.alumni-mentoring.edu.vn";

const ROW = {
  id: ADMIN_ID,
  email: "Thao@Example.com",
  full_name: null,
  role: "core_team",
  status: "invited",
  auth_user_id: AUTH_ID
};

type Mode = "ok" | "fail" | "wrong-user";

function makeClient(opts: {
  row?: Record<string, unknown> | null;
  confirmed?: boolean;
  invite?: Mode;
  recovery?: Mode;
} = {}) {
  const inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const generateLink = vi.fn(async ({ type, email }: { type: string; email: string }) => {
    const mode = type === "invite" ? (opts.invite ?? "ok") : (opts.recovery ?? "ok");
    if (mode === "fail") return { data: null, error: { code: "email_exists", message: "exists" } };
    const id = mode === "wrong-user" ? "66666666-6666-4666-8666-666666666666" : AUTH_ID;
    return { data: { user: { id, email }, properties: { hashed_token: `${type}-token` } }, error: null };
  });
  const getUserById = vi.fn(async () => ({
    data: { user: { id: AUTH_ID, email_confirmed_at: opts.confirmed ? "2026-09-13T00:00:00Z" : null } },
    error: null
  }));
  const from = vi.fn((table: string) => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: opts.row === undefined ? ROW : opts.row, error: null }),
      insert: async (payload: Record<string, unknown>) => {
        inserts.push({ table, payload });
        return { error: null };
      }
    };
    return chain;
  });
  return { client: { from, auth: { admin: { generateLink, getUserById } } }, generateLink, getUserById, inserts };
}

function use(opts: Parameters<typeof makeClient>[0] = {}) {
  const fake = makeClient(opts);
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake.client as never);
  return fake;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: ACTOR, role: "super_admin", status: "active" } as never);
  vi.mocked(sendStaffInvite).mockResolvedValue({ ok: true, skipped: false } as never);
});

describe("1. những lúc KHÔNG được gửi", () => {
  it("không phải super_admin: từ chối, không tạo link, không gửi", async () => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: ACTOR, role: "admin", status: "active" } as never);
    const fake = use();

    const result = await resendManagedAdminInvite(ADMIN_ID);

    expect(result.ok).toBe(false);
    expect(fake.generateLink).not.toHaveBeenCalled();
    expect(sendStaffInvite).not.toHaveBeenCalled();
  });

  it.each(["suspended", "inactive"])("tài khoản đang %s: từ chối, không tạo link, không gửi — không mở lại cửa vừa khoá", async (status) => {
    const fake = use({ row: { ...ROW, status } });

    const result = await resendManagedAdminInvite(ADMIN_ID);

    expect(result.ok).toBe(false);
    expect(fake.generateLink).not.toHaveBeenCalled();
    expect(sendStaffInvite).not.toHaveBeenCalled();
  });

  it("chưa liên kết Auth: từ chối", async () => {
    const fake = use({ row: { ...ROW, auth_user_id: null } });

    const result = await resendManagedAdminInvite(ADMIN_ID);

    expect(result.ok).toBe(false);
    expect(fake.generateLink).not.toHaveBeenCalled();
  });

  it("mã tạo ra thuộc một tài khoản đăng nhập KHÁC: từ chối, không gửi — không trao quyền vào nhầm tay", async () => {
    use({ invite: "wrong-user" });

    const result = await resendManagedAdminInvite(ADMIN_ID);

    expect(result.ok).toBe(false);
    expect(sendStaffInvite).not.toHaveBeenCalled();
  });
});

describe("2. gửi lại", () => {
  it("tạo link kiểu invite cho đúng địa chỉ, và gửi kèm ĐỊA CHỈ CỦA REQUEST", async () => {
    const fake = use();

    const result = await resendManagedAdminInvite(ADMIN_ID);

    expect(result.ok).toBe(true);
    expect(fake.generateLink).toHaveBeenCalledWith({ type: "invite", email: "thao@example.com" });
    expect(sendStaffInvite).toHaveBeenCalledWith(expect.objectContaining({
      toEmail: "thao@example.com",
      linkType: "invite",
      tokenHash: "invite-token",
      adminUserId: ADMIN_ID,
      roleLabel: "Ban Điều hành",
      requestOrigin: ORIGIN
    }));
  });

  it("Supabase từ chối kiểu invite: chuyển sang recovery, vẫn đúng tài khoản", async () => {
    const fake = use({ invite: "fail" });

    const result = await resendManagedAdminInvite(ADMIN_ID);

    expect(result.ok).toBe(true);
    expect(fake.generateLink).toHaveBeenNthCalledWith(2, { type: "recovery", email: "thao@example.com" });
    expect(sendStaffInvite).toHaveBeenCalledWith(expect.objectContaining({
      linkType: "recovery",
      tokenHash: "recovery-token",
      requestOrigin: ORIGIN
    }));
  });

  it("cả hai kiểu đều hỏng: từ chối, không gửi", async () => {
    use({ invite: "fail", recovery: "fail" });

    const result = await resendManagedAdminInvite(ADMIN_ID);

    expect(result.ok).toBe(false);
    expect(sendStaffInvite).not.toHaveBeenCalled();
  });

  it("người đã xác nhận email (quên mật khẩu): gửi thẳng recovery, không thử invite", async () => {
    const fake = use({ row: { ...ROW, status: "active" }, confirmed: true });

    const result = await resendManagedAdminInvite(ADMIN_ID);

    expect(result.ok).toBe(true);
    expect(fake.generateLink).toHaveBeenCalledTimes(1);
    expect(fake.generateLink).toHaveBeenCalledWith({ type: "recovery", email: "thao@example.com" });
    expect(sendStaffInvite).toHaveBeenCalledWith(expect.objectContaining({
      linkType: "recovery",
      tokenHash: "recovery-token",
      requestOrigin: ORIGIN
    }));
  });

  it("tài khoản đang hoạt động mà chưa đặt mật khẩu: vẫn gửi được, kiểu invite", async () => {
    const fake = use({ row: { ...ROW, status: "active" } });

    const result = await resendManagedAdminInvite(ADMIN_ID);

    expect(result.ok).toBe(true);
    expect(fake.generateLink).toHaveBeenCalledWith({ type: "invite", email: "thao@example.com" });
    expect(sendStaffInvite).toHaveBeenCalledWith(expect.objectContaining({ linkType: "invite", requestOrigin: ORIGIN }));
  });
});

describe("3. báo đúng sự thật, ghi nhật ký không lộ gì", () => {
  it("thư hỏng: nói rõ CHƯA gửi được", async () => {
    use();
    vi.mocked(sendStaffInvite).mockResolvedValue({ ok: false, skipped: false, reason: "Brevo từ chối" } as never);

    const result = await resendManagedAdminInvite(ADMIN_ID);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("CHƯA gửi được");
    expect(result.message).toContain("Brevo từ chối");
  });

  it("ghi nhật ký kể cả khi thư hỏng — link cũ đã hết dùng là thay đổi có thật", async () => {
    const fake = use();
    vi.mocked(sendStaffInvite).mockResolvedValue({ ok: false, skipped: false, reason: "x" } as never);

    await resendManagedAdminInvite(ADMIN_ID);

    const audit = fake.inserts.find((row) => row.table === "admin_audit_log");
    expect(audit?.payload).toMatchObject({ action_type: "update_admin_user", target_admin_user_id: ADMIN_ID });
    expect(audit?.payload.after_data).toMatchObject({ staff_invite_resent: true, delivered: false });
  });

  it("nhật ký không mang email, không mang mã", async () => {
    const fake = use();

    await resendManagedAdminInvite(ADMIN_ID);

    const audit = fake.inserts.find((row) => row.table === "admin_audit_log");
    const serialized = JSON.stringify(audit?.payload ?? {}).toLowerCase();
    expect(serialized).not.toContain("thao");
    expect(serialized).not.toContain("token");
  });
});
