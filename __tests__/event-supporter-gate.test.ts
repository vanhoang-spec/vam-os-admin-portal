/**
 * Cổng quyền của máy quét.
 *
 * Bên kia cổng này là việc ghi dữ liệu tham dự — thứ có thể dùng để cộng điểm
 * rèn luyện cho sinh viên. Nên ca test quan trọng nhất ở đây không phải "ai
 * vào được" mà là "hỏng thì đóng, không mở".
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { canScanEvent } from "@/lib/event-supporters";
import type { CurrentAdminUser } from "@/lib/auth-constants";

const EVENT = "00000000-0000-4000-8000-0000000000aa";
const OTHER_EVENT = "00000000-0000-4000-8000-0000000000bb";

function user(role: string, status = "active"): CurrentAdminUser {
  return {
    id: "u1",
    email: "a@vam.org",
    full_name: "A",
    role,
    status,
    auth_user_id: null
  } as CurrentAdminUser;
}

/** Client giả: trả về một dòng ghép cho đúng `matchEventId`, hoặc một lỗi. */
function client(options: { matchEventId?: string; fail?: boolean } = {}) {
  const filters: Record<string, string> = {};
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn((column: string, value: string) => {
    filters[column] = value;
    return chain;
  });
  chain.maybeSingle = vi.fn(async () => {
    if (options.fail) return { data: null, error: { code: "500", message: "mất kết nối" } };
    const hit = filters.event_id === options.matchEventId;
    return { data: hit ? { id: "s1" } : null, error: null };
  });
  return { from: vi.fn(() => chain) };
}

beforeEach(() => vi.clearAllMocks());

describe("quản trị sự kiện luôn quét được", () => {
  it.each(["super_admin", "admin", "core_team"])("vai trò %s vào thẳng", async (role) => {
    // Không cần đọc database: cổng này là cùng cổng đang gác việc sửa sự kiện
    // và điểm danh thủ công.
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(null as never);
    expect(await canScanEvent(user(role), EVENT)).toBe(true);
  });
});

describe("người hỗ trợ chỉ quét được ĐÚNG buổi của mình", () => {
  it("được ghép vào buổi này thì quét được", async () => {
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(
      client({ matchEventId: EVENT }) as never
    );
    expect(await canScanEvent(user("support_team"), EVENT)).toBe(true);
  });

  it("được ghép vào buổi KHÁC thì không quét được buổi này", async () => {
    // Sáu bạn hỗ trợ buổi orientation không có việc gì ở buổi phỏng vấn tuần
    // sau — đó là cả lý do quyền này gắn theo buổi thay vì là một vai trò.
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(
      client({ matchEventId: OTHER_EVENT }) as never
    );
    expect(await canScanEvent(user("support_team"), EVENT)).toBe(false);
  });

  it("không được ghép vào đâu thì không quét được", async () => {
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client() as never);
    expect(await canScanEvent(user("viewer"), EVENT)).toBe(false);
  });

  it("vai trò nào cũng quét được nếu đã được ghép", async () => {
    // Dòng ghép là thứ cấp quyền, không phải vai trò. Một `viewer` được nhờ
    // đứng cửa vẫn quét được, và chỉ ở buổi đó.
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(
      client({ matchEventId: EVENT }) as never
    );
    expect(await canScanEvent(user("viewer"), EVENT)).toBe(true);
  });
});

describe("fail-closed", () => {
  it("chưa đăng nhập thì không", async () => {
    expect(await canScanEvent(null, EVENT)).toBe(false);
  });

  it("đọc bảng thất bại thì ĐÓNG, không mở", async () => {
    // Một lỗi hạ tầng không được biến thành quyền.
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client({ fail: true }) as never);
    expect(await canScanEvent(user("support_team"), EVENT)).toBe(false);
  });

  it("không có client thì không", async () => {
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(null as never);
    expect(await canScanEvent(user("support_team"), EVENT)).toBe(false);
  });

  it("tài khoản đã khoá thì không, dù dòng ghép còn đó", async () => {
    // Dòng ghép mở thêm quyền; nó không thay cho việc có một tài khoản đang
    // hoạt động.
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(
      client({ matchEventId: EVENT }) as never
    );
    expect(await canScanEvent(user("support_team", "disabled"), EVENT)).toBe(false);
  });

  it("đường quản trị KHÔNG tự kiểm status, và đó là chủ ý", async () => {
    // `canEditRecaps` chỉ xét vai trò. Trạng thái tài khoản đã được lọc ở
    // thượng nguồn: `getCurrentAdminUser` chỉ trả về dòng `status = 'active'`,
    // nên một tài khoản khoá không bao giờ tới được cổng này trong thực tế.
    //
    // Ghim hành vi thật thay vì một khẳng định chung chung: nếu ai đó sau này
    // bỏ bộ lọc ở thượng nguồn, ca này vẫn xanh mà hệ thống đã hỏng — nên nó
    // được viết kèm ca dưới, ca canh chính bộ lọc ấy.
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client() as never);
    expect(await canScanEvent(user("admin", "disabled"), EVENT)).toBe(true);
  });

  it("bộ lọc thượng nguồn vẫn còn: getCurrentAdminUser chỉ nhận tài khoản active", async () => {
    const source = readFileSync(join(__dirname, "..", "lib", "admin-auth.ts"), "utf8");
    expect(source).toMatch(/\.eq\("status", "active"\)/);
  });
});

describe("truy vấn lọc theo cả hai chiều", () => {
  it("lọc theo cả event_id lẫn admin_user_id", async () => {
    // Thiếu một trong hai nghĩa là một người hỗ trợ bất kỳ mở được máy quét của
    // bất kỳ buổi nào.
    const fake = client({ matchEventId: EVENT });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);
    await canScanEvent(user("support_team"), EVENT);

    const chain = fake.from.mock.results[0].value as { eq: ReturnType<typeof vi.fn> };
    const columns = chain.eq.mock.calls.map((call) => call[0]);
    expect(columns).toContain("event_id");
    expect(columns).toContain("admin_user_id");
  });
});
