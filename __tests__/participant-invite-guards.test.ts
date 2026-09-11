/**
 * Ba điều lời mời KHÔNG được làm.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO TỪNG ĐIỀU
 * ---------------------------------------------------------------------------
 * 1. Không mời người đã có chân trong ban tổ chức — họ đã có lối vào riêng.
 * 2. Không mời khi phép tra danh bạ Auth chưa chạy hết. Mời nhầm một người đã
 *    có tài khoản sẽ tạo ra TÀI KHOẢN THỨ HAI cho cùng một hòm thư, và từ đó
 *    hai lối đăng nhập cùng trỏ về một người.
 * 3. Không tạo tài khoản cho người chưa được xếp vào mùa nào. Lời mời là để nối
 *    một người ĐÃ CÓ với một lối đăng nhập, không phải để thêm người.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/public-url", () => ({
  getAuthCallbackUrl: vi.fn(async () => "https://os.example.org/auth/callback")
}));

// `vi.mock` được nâng lên trên mọi khai báo trong file, nên một lớp khai báo ở
// đây sẽ chưa tồn tại lúc hàm dựng bản giả chạy. `vi.hoisted` nâng cả phần khởi
// tạo này lên cùng nó.
const { FakeLookupIncomplete, mockFindAuthUserByEmail } = vi.hoisted(() => ({
  FakeLookupIncomplete: class FakeLookupIncomplete extends Error {},
  mockFindAuthUserByEmail: vi.fn()
}));

vi.mock("@/lib/enable-reviewer", () => ({
  findAuthUserByEmail: (...args: unknown[]) => mockFindAuthUserByEmail(...args),
  AuthLookupIncomplete: FakeLookupIncomplete
}));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { inviteParticipant } from "@/lib/participant-invites";

const PERSON = "person-1";

function makeClient(options: {
  person?: Record<string, unknown> | null;
  membership?: unknown[];
  staff?: unknown[];
  insertError?: { code?: string } | null;
}) {
  const inserts: Array<Record<string, unknown>> = [];
  const invite = vi.fn(async () => ({ data: { user: { id: "auth-new" } }, error: null }));

  function table(name: string) {
    const chain: Record<string, unknown> = {};
    let mode: "select" | "insert" = "select";

    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.ilike = vi.fn(() => chain);
    chain.in = vi.fn(() => chain);
    chain.limit = vi.fn(() => chain);
    chain.insert = vi.fn((payload: Record<string, unknown>) => {
      mode = "insert";
      inserts.push(payload);
      return chain;
    });
    chain.maybeSingle = vi.fn(async () => ({
      data: name === "people" ? (options.person ?? null) : null,
      error: null
    }));
    chain.then = (resolve: (value: { data: unknown; error: unknown }) => unknown) => {
      if (mode === "insert") {
        return Promise.resolve(resolve({ data: null, error: options.insertError ?? null }));
      }
      const data =
        name === "person_season_memberships"
          ? (options.membership ?? [{ id: "m1" }])
          : name === "admin_users"
            ? (options.staff ?? [])
            : [];
      return Promise.resolve(resolve({ data, error: null }));
    };
    return chain;
  }

  return {
    from: vi.fn((name: string) => table(name)),
    auth: { admin: { inviteUserByEmail: invite } },
    inserts,
    invite
  };
}

const person = { id: PERSON, full_name: "Nguyễn Văn A", email_primary: "an@example.com" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentAdminUser).mockResolvedValue({
    id: "admin-1",
    email: "a@vam.org",
    full_name: "A",
    role: "admin",
    status: "active",
    auth_user_id: null
  } as never);
  mockFindAuthUserByEmail.mockResolvedValue(null);
});

describe("đường thuận", () => {
  it("người chưa có tài khoản thì gửi lời mời và ghi mối nối", async () => {
    const fake = makeClient({ person });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await inviteParticipant({ personId: PERSON });

    expect(result.ok).toBe(true);
    expect(result.invited).toBe(true);
    expect(fake.invite).toHaveBeenCalledTimes(1);
    expect(fake.inserts[0]).toMatchObject({
      auth_user_id: "auth-new",
      person_id: PERSON,
      link_source: "invite",
      created_by: "admin-1"
    });
  });

  it("lời mời luôn kèm nơi đáp xuống", async () => {
    // Không có nó, Supabase gửi người ta về Site URL và mã đăng nhập rơi vào
    // một trang không biết làm gì với nó — tài khoản được tạo mà không bao giờ
    // vào được.
    const fake = makeClient({ person });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    await inviteParticipant({ personId: PERSON });

    expect(fake.invite).toHaveBeenCalledWith("an@example.com", {
      redirectTo: "https://os.example.org/auth/callback"
    });
  });

  it("người đã có tài khoản thì KHÔNG mời lại, chỉ nối", async () => {
    mockFindAuthUserByEmail.mockResolvedValue({ id: "auth-cu", email: "an@example.com" });
    const fake = makeClient({ person });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await inviteParticipant({ personId: PERSON });

    expect(result.ok).toBe(true);
    expect(result.invited).toBe(false);
    expect(fake.invite).not.toHaveBeenCalled();
    expect(fake.inserts[0]).toMatchObject({ auth_user_id: "auth-cu" });
  });
});

describe("ba điều không làm", () => {
  it("KHÔNG mời người đã có chân trong ban tổ chức", async () => {
    const fake = makeClient({ person, staff: [{ id: "admin-9" }] });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await inviteParticipant({ personId: PERSON });

    expect(result.ok).toBe(false);
    expect(fake.invite).not.toHaveBeenCalled();
    expect(fake.inserts).toEqual([]);
  });

  it("KHÔNG mời khi tra danh bạ Auth chưa chạy hết", async () => {
    // Đây là ca nguy hiểm nhất: mời nhầm sẽ tạo tài khoản thứ hai cho cùng một
    // hòm thư, và từ đó hai lối đăng nhập cùng trỏ về một người.
    mockFindAuthUserByEmail.mockRejectedValue(new FakeLookupIncomplete("chưa hết trang"));
    const fake = makeClient({ person });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await inviteParticipant({ personId: PERSON });

    expect(result.ok).toBe(false);
    expect(fake.invite).not.toHaveBeenCalled();
    expect(fake.inserts).toEqual([]);
  });

  it("KHÔNG mời người chưa được xếp vào mùa nào", async () => {
    const fake = makeClient({ person, membership: [] });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await inviteParticipant({ personId: PERSON });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("mùa");
    expect(fake.invite).not.toHaveBeenCalled();
  });
});

describe("cổng vào", () => {
  it("không đủ quyền thì dừng trước khi chạm database", async () => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue({
      id: "u2",
      email: "b@vam.org",
      full_name: "B",
      role: "support_team",
      status: "active",
      auth_user_id: null
    } as never);
    const fake = makeClient({ person });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await inviteParticipant({ personId: PERSON });

    expect(result.ok).toBe(false);
    expect(fake.from).not.toHaveBeenCalled();
  });

  it("người thiếu email thì báo rõ, không mời", async () => {
    const fake = makeClient({ person: { ...person, email_primary: "  " } });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await inviteParticipant({ personId: PERSON });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("email");
    expect(fake.invite).not.toHaveBeenCalled();
  });

  it("mời lại người đã nối là thao tác vô hại", async () => {
    const fake = makeClient({ person, insertError: { code: "23505" } });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await inviteParticipant({ personId: PERSON });
    expect(result.ok).toBe(true);
  });

  it("ghi mối nối hỏng thật thì KHÔNG báo là đã mời xong", async () => {
    const fake = makeClient({ person, insertError: { code: "23503" } });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await inviteParticipant({ personId: PERSON });
    expect(result.ok).toBe(false);
  });
});
