/**
 * AuthDirectory — danh bạ tài khoản đọc một lần cho cả một lượt mời.
 *
 * Cùng một vòng trang với findAuthUserByEmail, nên cùng quy tắc: CHỈ một trang
 * rỗng mới chứng minh đã hết danh bạ. GoTrue tự giới hạn số dòng mỗi trang, và
 * dừng ở trang ngắn là bỏ sót tài khoản — rồi tạo tài khoản thứ hai cho một
 * hòm thư đã có.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  const original = await vi.importActual<Record<string, unknown>>("react");
  return { ...original, cache: (fn: unknown) => fn };
});
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({ canOperateSeason: vi.fn(), getAdminScopeContext: vi.fn() }));

import { AuthDirectory, AuthLookupIncomplete, findAuthUserByEmail } from "@/lib/enable-reviewer";

const PAGE = 50;

function directory(emails: string[]) {
  const listUsers = vi.fn(async ({ page }: { page: number }) => {
    const start = (page - 1) * PAGE;
    return {
      data: { users: emails.slice(start, start + PAGE).map((email, index) => ({ id: `auth-${start + index}`, email })) },
      error: null
    };
  });
  return { client: { auth: { admin: { listUsers } } }, listUsers };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("đọc hết danh bạ", () => {
  it("trang ngắn không phải trang cuối; chỉ trang rỗng mới là hết", async () => {
    const emails = Array.from({ length: 120 }, (_, index) => `filler${index}@example.com`);
    emails[117] = "Target.Person@Example.com";
    const { client, listUsers } = directory(emails);

    const loaded = await AuthDirectory.load(client);

    expect(listUsers).toHaveBeenCalledTimes(4);
    expect(loaded.usersWithEmail("  TARGET.person@example.COM ")).toEqual([
      { id: "auth-117", email: "target.person@example.com" }
    ]);
  });

  it("danh bạ không bao giờ hết trong giới hạn trang thì từ chối, không trả một danh bạ thiếu", async () => {
    const listUsers = vi.fn(async ({ page }: { page: number }) => ({
      data: { users: Array.from({ length: PAGE }, (_, index) => ({ id: `a-${page}-${index}`, email: `u${page}-${index}@x.vn` })) },
      error: null
    }));

    await expect(AuthDirectory.load({ auth: { admin: { listUsers } } })).rejects.toBeInstanceOf(AuthLookupIncomplete);
  });

  it("nhà cung cấp báo lỗi thì ném lỗi, không trả danh bạ rỗng", async () => {
    const listUsers = vi.fn(async () => ({ data: null, error: { message: "rate limited" } }));
    await expect(AuthDirectory.load({ auth: { admin: { listUsers } } })).rejects.toMatchObject({ message: "rate limited" });
  });
});

describe("tra theo email", () => {
  it("hai tài khoản cùng email thì trả cả hai — người gọi phải từ chối, không chọn bừa", async () => {
    const { client } = directory(["an@example.com", "AN@example.com", "binh@example.com"]);
    const loaded = await AuthDirectory.load(client);
    expect(loaded.usersWithEmail("an@example.com").map((user) => user.id)).toEqual(["auth-0", "auth-1"]);
  });

  it("kết quả là một bản sao: sửa nó không sửa được danh bạ", async () => {
    const { client } = directory(["an@example.com"]);
    const loaded = await AuthDirectory.load(client);
    loaded.usersWithEmail("an@example.com").push({ id: "gia", email: "an@example.com" });
    expect(loaded.usersWithEmail("an@example.com")).toHaveLength(1);
  });
});

describe("tra một người vẫn dừng sớm", () => {
  it("findAuthUserByEmail dừng ở trang có người cần tìm", async () => {
    const emails = Array.from({ length: 200 }, (_, index) => `filler${index}@example.com`);
    emails[60] = "target@example.com";
    const { client, listUsers } = directory(emails);

    const found = await findAuthUserByEmail(client, "target@example.com");

    expect(found?.id).toBe("auth-60");
    expect(listUsers).toHaveBeenCalledTimes(2);
  });
});
