/**
 * Tạo tài khoản nhân sự: ai gửi thư, gửi lúc nào, và gửi cho ai.
 *
 * ---------------------------------------------------------------------------
 * CÁI NÀY CANH ĐIỀU GÌ
 * ---------------------------------------------------------------------------
 * `inviteUserByEmail` làm hai việc trong một lệnh: tạo tài khoản Auth VÀ tự gửi
 * thư. Thư tự gửi mang đường dẫn về Site URL của Supabase — một đường không nằm
 * trong ba đường được phép dựng phiên từ mảnh `#`, nên người nhận bấm vào là
 * rơi vào ngõ cụt, và người mời kẹt ở bước Kích hoạt vì `email_confirmed_at`
 * không bao giờ được đặt.
 *
 * Lỗi ấy qua được cả bốn cổng: mã biên dịch sạch, tài khoản được tạo thật, màn
 * hình báo "đã gửi lời mời". Chỉ người nhận mới biết là hỏng. Nên nó bị khoá ở
 * đây, bằng những khẳng định về THỨ TỰ và về LỆNH NÀO ĐƯỢC GỌI.
 *
 * Phân loại: DIRECT PRODUCTION TESTS — gọi thẳng `createManagedAdminUser`, giữ
 * bộ điều phối `manual-staff-provisioning` là hàng thật để thứ tự bước là thật.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

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

import { createManagedAdminUser } from "@/lib/admin-users";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { findExactAuthUsers } from "@/lib/account-auth-ownership";
import { sendStaffInvite } from "@/lib/email";

const PROGRAM = "11111111-1111-4111-8111-111111111111";
const SEASON = "22222222-2222-4222-8222-222222222222";
const AUTH_ID = "33333333-3333-4333-8333-333333333333";
const ADMIN_ID = "44444444-4444-4444-8444-444444444444";
const ACTOR = "55555555-5555-4555-8555-555555555555";
const TOKEN = "hashed-token-xyz";
const EMAIL = "thao_v2003@example.com";

/** Thứ tự các mốc quan trọng, để khẳng định thư đi SAU khi tài khoản đã ghi. */
const order: string[] = [];

function makeClient(generateLinkResult?: unknown) {
  const generateLink = vi.fn(async ({ email }: { type: string; email: string }) => {
    order.push("generateLink");
    return generateLinkResult ?? {
      data: { user: { id: AUTH_ID, email }, properties: { hashed_token: TOKEN } },
      error: null
    };
  });
  const rpc = vi.fn(async (name: string) => {
    if (name === "vam062_begin_auth_operation") return { data: [{ accepted: true }], error: null };
    if (name === "vam062_admin_mutation_atomic") { order.push("commitApplication"); return { data: null, error: null }; }
    return { data: null, error: null };
  });
  const from = vi.fn((table: string) => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => {
        if (table === "programs") return { data: { id: PROGRAM, is_active: true }, error: null };
        if (table === "seasons") return { data: { id: SEASON, program_id: PROGRAM }, error: null };
        if (table === "admin_users") return { data: { id: ADMIN_ID }, error: null };
        return { data: null, error: null };
      }
    };
    return chain;
  });
  return {
    rpc, from, generateLink,
    auth: { admin: { generateLink, deleteUser: vi.fn(async () => ({ error: null })) } }
  };
}

function create(overrides: Record<string, unknown> = {}) {
  return createManagedAdminUser({
    email: EMAIL, fullName: "Võ Thị Thảo", role: "core_team", status: "invited",
    programId: PROGRAM, seasonId: SEASON, scopeRole: "operations", scopeStatus: "active",
    ...overrides
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: ACTOR, role: "super_admin", status: "active" } as never);
  // preLookup: chưa có ai · postLookup: đúng một tài khoản vừa tạo
  vi.mocked(findExactAuthUsers)
    .mockResolvedValueOnce({ ok: true, users: [] } as never)
    .mockResolvedValueOnce({ ok: true, users: [{ id: AUTH_ID }] } as never);
  vi.mocked(sendStaffInvite).mockImplementation(async () => {
    order.push("sendStaffInvite");
    return { ok: true, skipped: false };
  });
});

describe("1. Supabase không còn tự gửi thư", () => {
  it("tạo tài khoản Auth bằng generateLink kiểu invite, đúng địa chỉ được mời", async () => {
    const client = makeClient();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await create();

    expect(result.ok).toBe(true);
    expect(client.generateLink).toHaveBeenCalledWith({ type: "invite", email: EMAIL });
  });

  it("mã nguồn không còn gọi inviteUserByEmail", () => {
    const source = readFileSync("lib/admin-users.ts", "utf8");
    // Soi lệnh gọi, không soi chữ: phần chú thích có nhắc tên hàm để giải thích
    // vì sao nó bị bỏ, và một phép tìm chữ trần sẽ bắt nhầm vào đó.
    expect(source).not.toMatch(/auth\.admin\.inviteUserByEmail\s*\(/);
  });
});

describe("2. thư đi qua Brevo, và đi SAU khi tài khoản đã ghi", () => {
  it("thứ tự: generateLink → ghi tài khoản → gửi thư", async () => {
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(makeClient() as never);

    await create();

    // Gửi trước khi ghi thì người nhận cầm một đường dẫn trỏ tới tài khoản
    // không tồn tại — hỏng theo cách không sửa được từ phía họ.
    expect(order).toEqual(["generateLink", "commitApplication", "sendStaffInvite"]);
  });

  it("thư mang đúng mã mà generateLink trả về, và trỏ về đúng tài khoản vừa tạo", async () => {
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(makeClient() as never);

    await create();

    expect(sendStaffInvite).toHaveBeenCalledWith(expect.objectContaining({
      toEmail: EMAIL,
      tokenHash: TOKEN,
      linkType: "invite",
      adminUserId: ADMIN_ID
    }));
  });

  it("thư nói đúng vai trò bằng tiếng Việt, không phải giá trị thô trong database", async () => {
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(makeClient() as never);

    await create();

    const arg = vi.mocked(sendStaffInvite).mock.calls[0][0];
    expect(arg.roleLabel).toBe("Ban Điều hành");
    expect(arg.roleLabel).not.toBe("core_team");
  });
});

describe("3. những lúc KHÔNG được gửi", () => {
  it("generateLink trả về địa chỉ khác người được mời: dừng, không ghi, không gửi", async () => {
    // Đây là trường hợp tệ nhất — gửi mã của người khác đi là trao quyền vào
    // nhầm tay. Phải hỏng về phía an toàn.
    const client = makeClient({
      data: { user: { id: AUTH_ID, email: "someone.else@example.com" }, properties: { hashed_token: TOKEN } },
      error: null
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await create();

    expect(result.ok).toBe(false);
    expect(sendStaffInvite).not.toHaveBeenCalled();
    expect(order).not.toContain("commitApplication");
  });

  it("generateLink không trả về mã: dừng, không gửi", async () => {
    const client = makeClient({ data: { user: { id: AUTH_ID, email: EMAIL }, properties: {} }, error: null });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await create();

    expect(result.ok).toBe(false);
    expect(sendStaffInvite).not.toHaveBeenCalled();
  });

  it("địa chỉ đã có tài khoản Auth: bị từ chối trước khi tạo, và không gửi thư", async () => {
    vi.mocked(findExactAuthUsers).mockReset();
    vi.mocked(findExactAuthUsers).mockResolvedValue({ ok: true, users: [{ id: AUTH_ID }] } as never);
    const client = makeClient();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await create();

    expect(result.ok).toBe(false);
    expect(client.generateLink).not.toHaveBeenCalled();
    expect(sendStaffInvite).not.toHaveBeenCalled();
  });
});

describe("4. báo đúng sự thật khi thư không đi được", () => {
  it("gửi hỏng: nói rõ CHƯA gửi được, không gộp thành 'đã gửi lời mời'", async () => {
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(makeClient() as never);
    vi.mocked(sendStaffInvite).mockResolvedValue({
      ok: false, skipped: false, reason: "Brevo từ chối"
    } as never);

    const result = await create();

    // Tài khoản CÓ thật, nên không được báo thất bại toàn phần…
    expect(result.ok).toBe(true);
    // …nhưng người vận hành phải biết là chưa có thư nào đi.
    expect(result.message).toContain("CHƯA gửi được thư mời");
    expect(result.message).toContain("Brevo từ chối");
    expect(result.message).not.toContain("và gửi thư mời đặt mật khẩu");
  });

  it("cổng thư tắt (skipped) cũng không được báo là đã gửi", async () => {
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(makeClient() as never);
    vi.mocked(sendStaffInvite).mockResolvedValue({
      ok: false, skipped: true, reason: "Môi trường này đang tắt gửi thư"
    } as never);

    const result = await create();

    expect(result.message).toContain("CHƯA gửi được thư mời");
  });

  it("gửi được thì mới nói là đã gửi", async () => {
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(makeClient() as never);

    const result = await create();

    expect(result.message).toContain("gửi thư mời đặt mật khẩu");
    expect(result.message).not.toContain("CHƯA gửi được");
  });
});

describe("5. migration", () => {
  const sql = readFileSync("supabase/migrations/20260913100000_outbound_emails_staff_invite.sql", "utf8");

  it("nới theo lối cộng thêm, không viết đè danh sách", () => {
    expect(sql).toContain("pg_get_constraintdef");
    expect(sql).toContain("regexp_replace");
    expect(sql).not.toMatch(/add\s+constraint\s+outbound_emails_kind_check\s+check\s*\(/i);
  });

  it("tự kiểm giữ đủ 11 loại thư cũ", () => {
    const selfCheck = sql.slice(sql.indexOf("$self_check$"));
    for (const kind of [
      "mentor_confirmation_link", "mentee_application_confirmation",
      "mentor_application_confirmation", "review_batch_assigned",
      "interview_scheduled", "reviewer_invite", "interview_round_invite",
      "general_announcement", "event_registration_confirmation",
      "event_schedule_change", "participant_invite"
    ]) {
      expect(selfCheck, `tự kiểm phải canh loại thư cũ ${kind}`).toContain(`'${kind}'`);
    }
    expect(selfCheck).toContain("đã MẤT loại thư cũ");
  });

  it("chạy lại lần hai không nhân đôi giá trị", () => {
    expect(sql).toContain("position('''staff_invite''' in existing) > 0");
  });

  it("không có lệnh xoá dữ liệu", () => {
    expect(sql).not.toMatch(/delete\s+from|drop\s+table|truncate/i);
  });
});
