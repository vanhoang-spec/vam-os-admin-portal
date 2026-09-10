/**
 * Người hỗ trợ điểm danh được CHỌN từ support team, không phải gõ email.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO ĐỔI
 * ---------------------------------------------------------------------------
 * Ô gõ email bắt người vận hành nhớ chính xác địa chỉ của một người khác rồi
 * gõ lại không sai một ký tự. Gõ sai thì hệ thống báo "chưa có tài khoản trên
 * hệ thống" — một câu đúng về mặt kỹ thuật nhưng dẫn người ta đi sai hướng,
 * vì tài khoản vẫn ở đó, chỉ là email vừa gõ không phải của nó.
 *
 * Danh sách support team đã nằm sẵn trong CRM.
 *
 * ---------------------------------------------------------------------------
 * Ô CHỌN KHÔNG PHẢI MỘT PHÉP KIỂM
 * ---------------------------------------------------------------------------
 * Cái đến từ biểu mẫu là thứ người gửi tự đặt được. Một danh sách đã lọc trên
 * màn hình không ngăn được ai gửi lên id của một tài khoản khác, nên hàm ghi
 * phải tự kiểm lại vai trò và trạng thái — bên kia cổng này là quyền ghi dữ
 * liệu tham dự.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { addEventSupporter, listSupporterCandidates } from "@/lib/event-supporters";

const EVENT = "00000000-0000-4000-8000-0000000000aa";

type Insert = { table: string; payload: Record<string, unknown> };

/**
 * Bản giả của client, ghi lại mọi bộ lọc đã dùng và mọi dòng đã chèn.
 *
 * Giữ lại `filters` vì chính chúng là thứ quyết định ô chọn hiện ra ai: bỏ một
 * bộ lọc đi thì danh sách vẫn ra kết quả, chỉ là ra sai người.
 */
function makeClient(options: {
  adminUsers?: Array<Record<string, unknown>>;
  /** Dòng trả về cho `.maybeSingle()` khi tra một tài khoản. */
  lookup?: Record<string, unknown> | null;
  taken?: Array<{ admin_user_id: string }>;
  insertError?: { code?: string } | null;
}) {
  const inserts: Insert[] = [];
  const filters: Array<{ table: string; kind: string; column: string; value: unknown }> = [];

  function table(name: string) {
    const chain: Record<string, unknown> = {};
    let mode: "select" | "insert" = "select";

    const note = (kind: string) => (column: string, value: unknown) => {
      filters.push({ table: name, kind, column, value });
      return chain;
    };

    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(note("eq"));
    chain.in = vi.fn(note("in"));
    chain.ilike = vi.fn(note("ilike"));
    chain.order = vi.fn(() => chain);
    chain.insert = vi.fn((payload: Record<string, unknown>) => {
      mode = "insert";
      inserts.push({ table: name, payload });
      return chain;
    });
    chain.maybeSingle = vi.fn(async () => ({ data: options.lookup ?? null, error: null }));
    chain.then = (resolve: (value: { data: unknown; error: unknown }) => unknown) => {
      if (mode === "insert") {
        return Promise.resolve(resolve({ data: null, error: options.insertError ?? null }));
      }
      const data = name === "admin_users" ? (options.adminUsers ?? []) : (options.taken ?? []);
      return Promise.resolve(resolve({ data, error: null }));
    };
    return chain;
  }

  return { from: vi.fn((name: string) => table(name)), inserts, filters };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("danh sách để chọn", () => {
  it("chỉ lấy tài khoản Support team, và chỉ tài khoản đang hoạt động", async () => {
    const fake = makeClient({ adminUsers: [], taken: [] });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    await listSupporterCandidates(EVENT);

    const roleFilter = fake.filters.find(
      (row) => row.table === "admin_users" && row.column === "role"
    );
    expect(roleFilter?.value).toEqual(["support_team"]);

    const statusFilter = fake.filters.find(
      (row) => row.table === "admin_users" && row.column === "status"
    );
    expect(statusFilter?.value).toBe("active");
  });

  it("bỏ ra người đã có trong danh sách hỗ trợ của buổi này", async () => {
    const fake = makeClient({
      adminUsers: [
        { id: "u1", full_name: "Nguyễn A", email: "a@vam.org" },
        { id: "u2", full_name: "Trần B", email: "b@vam.org" }
      ],
      taken: [{ admin_user_id: "u1" }]
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const { rows } = await listSupporterCandidates(EVENT);

    // Chọn lại người đã thêm là thao tác vô nghĩa, và để họ trong ô chọn làm
    // người ta tưởng mình chưa thêm.
    expect(rows.map((row) => row.adminUserId)).toEqual(["u2"]);
  });

  it("lọc người đã thêm theo ĐÚNG buổi đang mở", async () => {
    const fake = makeClient({ adminUsers: [], taken: [] });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    await listSupporterCandidates(EVENT);

    const scoped = fake.filters.find(
      (row) => row.table === "event_supporters" && row.column === "event_id"
    );
    // Quên buộc theo buổi thì người hỗ trợ của buổi khác cũng bị loại khỏi ô
    // chọn, và không ai hiểu vì sao họ biến mất.
    expect(scoped?.value).toBe(EVENT);
  });

  it("mang theo tên và email để ô chọn đọc được", async () => {
    const fake = makeClient({
      adminUsers: [{ id: "u1", full_name: "Nguyễn A", email: "a@vam.org" }],
      taken: []
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const { rows } = await listSupporterCandidates(EVENT);
    expect(rows[0]).toEqual({ adminUserId: "u1", fullName: "Nguyễn A", email: "a@vam.org" });
  });
});

describe("thêm người hỗ trợ", () => {
  const supportTeam = {
    id: "u1",
    status: "active",
    role: "support_team",
    full_name: "Nguyễn A",
    email: "a@vam.org"
  };

  it("chèn đúng dòng ghép người-với-buổi", async () => {
    const fake = makeClient({ lookup: supportTeam });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await addEventSupporter({
      eventId: EVENT,
      adminUserId: "u1",
      addedBy: "admin-1"
    });

    expect(result.ok).toBe(true);
    expect(fake.inserts).toHaveLength(1);
    expect(fake.inserts[0].payload).toEqual({
      event_id: EVENT,
      admin_user_id: "u1",
      added_by: "admin-1"
    });
  });

  it("tra theo id, không tra theo email nữa", async () => {
    const fake = makeClient({ lookup: supportTeam });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    await addEventSupporter({ eventId: EVENT, adminUserId: "u1", addedBy: null });

    expect(fake.filters).toContainEqual({
      table: "admin_users",
      kind: "eq",
      column: "id",
      value: "u1"
    });
    expect(fake.filters.some((row) => row.kind === "ilike")).toBe(false);
  });

  it("id của một vai trò KHÁC support team thì bị từ chối", async () => {
    // Ô chọn chỉ hiện support team, nhưng cái đến từ biểu mẫu là thứ người gửi
    // tự đặt được. Đây là ca chứng minh hàm ghi tự kiểm lại chứ không tin vào
    // việc màn hình đã lọc.
    for (const role of ["viewer", "reviewer", "core_team", "admin", "super_admin"]) {
      const fake = makeClient({ lookup: { ...supportTeam, role } });
      vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

      const result = await addEventSupporter({
        eventId: EVENT,
        adminUserId: "u1",
        addedBy: null
      });

      expect(result.ok, role).toBe(false);
      expect(fake.inserts, role).toEqual([]);
    }
  });

  it("tài khoản đã khoá thì bị từ chối", async () => {
    const fake = makeClient({ lookup: { ...supportTeam, status: "disabled" } });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await addEventSupporter({ eventId: EVENT, adminUserId: "u1", addedBy: null });

    expect(result.ok).toBe(false);
    expect(fake.inserts).toEqual([]);
  });

  it("không chọn ai thì dừng trước khi chạm database", async () => {
    const fake = makeClient({ lookup: supportTeam });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await addEventSupporter({ eventId: EVENT, adminUserId: "", addedBy: null });

    expect(result.ok).toBe(false);
    expect(fake.from).not.toHaveBeenCalled();
  });

  it("id không có thật thì báo không tìm thấy, không chèn gì", async () => {
    const fake = makeClient({ lookup: null });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await addEventSupporter({
      eventId: EVENT,
      adminUserId: "khong-co-that",
      addedBy: null
    });

    expect(result.ok).toBe(false);
    expect(fake.inserts).toEqual([]);
  });

  it("thêm lại người đã có là thao tác vô hại", async () => {
    // 23505 = đã có trong danh sách.
    const fake = makeClient({ lookup: supportTeam, insertError: { code: "23505" } });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await addEventSupporter({ eventId: EVENT, adminUserId: "u1", addedBy: null });

    expect(result.ok).toBe(true);
    expect(result.message).toContain("đã có trong danh sách");
  });

  it("lỗi chèn thật sự thì KHÔNG được báo là đã thêm xong", async () => {
    // Chỉ 23505 (đã có trong danh sách) mới là chuyện vô hại. Nuốt các lỗi
    // khác nghĩa là người vận hành đóng máy đi với niềm tin rằng bạn hỗ trợ đã
    // quét được — rồi tới hôm event mới biết là không.
    const fake = makeClient({
      lookup: supportTeam,
      insertError: { code: "23503" }
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await addEventSupporter({ eventId: EVENT, adminUserId: "u1", addedBy: null });

    expect(result.ok).toBe(false);
  });
});
