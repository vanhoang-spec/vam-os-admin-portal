/**
 * Đường ghi của phép nối danh tính: đọc gì, ghi gì, và khi nào KHÔNG ghi.
 *
 * Phép quyết định đã được thử riêng ở `participant-identity-core.test.ts`. File
 * này thử phần chạm database: câu truy vấn có đúng hình dạng không, mối nối có
 * được ghi đúng lúc không, và — quan trọng nhất — lỗi hạ tầng có bị nhầm thành
 * "không nhận ra bạn" không.
 *
 * Hai thứ đó khác hẳn nhau. Một cái là dữ liệu nói không có; một cái là ta
 * không đọc được dữ liệu. Gộp chúng lại nghĩa là một sự cố kết nối hiện ra
 * thành lời báo "chưa nhận ra bạn", và người vận hành đi dọn danh bạ trong khi
 * thứ hỏng là đường mạng.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { resolveParticipantIdentity } from "@/lib/participant-auth";

const AUTH_USER = "auth-user-1";

type Insert = { table: string; payload: Record<string, unknown> };
type Query = { table: string; op: string; column: string; value: unknown };

function makeClient(options: {
  link?: Record<string, unknown> | null;
  people?: Array<Record<string, unknown>>;
  linkError?: { message: string } | null;
  peopleError?: { message: string } | null;
  insertError?: { code?: string } | null;
}) {
  const inserts: Insert[] = [];
  const queries: Query[] = [];

  function table(name: string) {
    const chain: Record<string, unknown> = {};
    let mode: "select" | "insert" = "select";

    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn((column: string, value: unknown) => {
      queries.push({ table: name, op: "eq", column, value });
      return chain;
    });
    chain.ilike = vi.fn((column: string, value: unknown) => {
      queries.push({ table: name, op: "ilike", column, value });
      return chain;
    });
    chain.insert = vi.fn((payload: Record<string, unknown>) => {
      mode = "insert";
      inserts.push({ table: name, payload });
      return chain;
    });
    chain.maybeSingle = vi.fn(async () => {
      if (mode === "insert") return { data: null, error: options.insertError ?? null };
      return { data: options.link ?? null, error: options.linkError ?? null };
    });
    chain.then = (resolve: (value: { data: unknown; error: unknown }) => unknown) => {
      if (mode === "insert") {
        return Promise.resolve(resolve({ data: null, error: options.insertError ?? null }));
      }
      return Promise.resolve(
        resolve({ data: options.people ?? [], error: options.peopleError ?? null })
      );
    };
    return chain;
  }

  return { from: vi.fn((name: string) => table(name)), inserts, queries };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("lần đầu đăng nhập", () => {
  it("email khớp đúng một người thì ghi mối nối", async () => {
    const fake = makeClient({
      link: null,
      people: [{ id: "person-an", email_primary: "an@example.com" }]
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await resolveParticipantIdentity({
      authUserId: AUTH_USER,
      authEmail: "an@example.com"
    });

    expect(result.personId).toBe("person-an");
    expect(result.refusal).toBeNull();
    expect(result.error).toBeNull();
    expect(fake.inserts).toHaveLength(1);
    expect(fake.inserts[0].payload).toMatchObject({
      auth_user_id: AUTH_USER,
      person_id: "person-an",
      status: "active",
      link_source: "self_register"
    });
  });

  it("ghi rõ mối nối này từ đâu ra", async () => {
    // Khi có người thấy dữ liệu của người khác, câu hỏi đầu tiên là "ai nối hai
    // thứ này lại, bằng cách nào". Không ghi lại thì không ai trả lời được.
    const fake = makeClient({
      link: null,
      people: [{ id: "person-an", email_primary: "an@example.com" }]
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    await resolveParticipantIdentity({ authUserId: AUTH_USER, authEmail: "an@example.com" });

    expect(fake.inserts[0].payload.link_source).toBe("self_register");
    expect(String(fake.inserts[0].payload.activated_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("email khớp NHIỀU người thì KHÔNG ghi gì cả", async () => {
    const fake = makeClient({
      link: null,
      people: [
        { id: "a", email_primary: "chung@example.com" },
        { id: "b", email_primary: "chung@example.com" }
      ]
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await resolveParticipantIdentity({
      authUserId: AUTH_USER,
      authEmail: "chung@example.com"
    });

    expect(result.personId).toBeNull();
    expect(result.refusal).toBeTruthy();
    expect(fake.inserts).toEqual([]);
  });

  it("không khớp ai thì không ghi gì cả", async () => {
    const fake = makeClient({ link: null, people: [] });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await resolveParticipantIdentity({
      authUserId: AUTH_USER,
      authEmail: "la@example.com"
    });

    expect(result.personId).toBeNull();
    expect(fake.inserts).toEqual([]);
  });

  it("dò email không phân biệt hoa thường", async () => {
    const fake = makeClient({
      link: null,
      people: [{ id: "person-an", email_primary: "AN@Example.com" }]
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    await resolveParticipantIdentity({ authUserId: AUTH_USER, authEmail: "  AN@EXAMPLE.COM " });

    const lookup = fake.queries.find((q) => q.table === "people");
    expect(lookup?.op).toBe("ilike");
    expect(lookup?.value).toBe("an@example.com");
  });
});

describe("đã có mối nối", () => {
  it("dùng lại, và KHÔNG dò email nữa", async () => {
    const fake = makeClient({
      link: { person_id: "person-cu", status: "active" },
      people: [{ id: "person-khac", email_primary: "an@example.com" }]
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await resolveParticipantIdentity({
      authUserId: AUTH_USER,
      authEmail: "an@example.com"
    });

    expect(result.personId).toBe("person-cu");
    // Không hỏi bảng `people` lần nào: ai đó sửa email trong danh bạ không được
    // phép làm người đang đăng nhập biến thành người khác.
    expect(fake.queries.some((q) => q.table === "people")).toBe(false);
    expect(fake.inserts).toEqual([]);
  });

  it("mối nối bị ngắt thì KHÔNG lặng lẽ nối lại", async () => {
    // Ban tổ chức chủ động ngắt một mối nối. Dò email lại nghĩa là nó tự nối
    // lại ngay lượt đăng nhập sau, và việc ngắt trở thành vô nghĩa.
    const fake = makeClient({
      link: { person_id: "person-cu", status: "inactive" },
      people: [{ id: "person-cu", email_primary: "an@example.com" }]
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await resolveParticipantIdentity({
      authUserId: AUTH_USER,
      authEmail: "an@example.com"
    });

    expect(result.personId).toBeNull();
    expect(result.refusal).toBeTruthy();
    expect(fake.inserts).toEqual([]);
    expect(fake.queries.some((q) => q.table === "people")).toBe(false);
  });

  it("hai lượt đăng nhập cùng lúc: dòng đã có là chuyện vô hại", async () => {
    const fake = makeClient({
      link: null,
      people: [{ id: "person-an", email_primary: "an@example.com" }],
      insertError: { code: "23505" }
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await resolveParticipantIdentity({
      authUserId: AUTH_USER,
      authEmail: "an@example.com"
    });

    expect(result.personId).toBe("person-an");
    expect(result.error).toBeNull();
  });
});

describe("lỗi hạ tầng KHÁC HẲN không nhận ra", () => {
  it("đọc mối nối hỏng: báo lỗi, không báo không nhận ra", async () => {
    const fake = makeClient({ linkError: { message: "connection reset" } });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await resolveParticipantIdentity({
      authUserId: AUTH_USER,
      authEmail: "an@example.com"
    });

    expect(result.error).toBeTruthy();
    expect(result.refusal).toBeNull();
    expect(result.personId).toBeNull();
  });

  it("dò danh bạ hỏng: báo lỗi, và KHÔNG ghi mối nối nào", async () => {
    const fake = makeClient({ link: null, peopleError: { message: "timeout" } });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await resolveParticipantIdentity({
      authUserId: AUTH_USER,
      authEmail: "an@example.com"
    });

    expect(result.error).toBeTruthy();
    expect(result.personId).toBeNull();
    expect(fake.inserts).toEqual([]);
  });

  it("ghi mối nối hỏng thật thì KHÔNG nhận là đã nối", async () => {
    // Chỉ 23505 là vô hại. Nuốt các lỗi khác nghĩa là người dùng vào được lượt
    // này rồi lượt sau bị chặn, vì mối nối chưa từng được ghi.
    const fake = makeClient({
      link: null,
      people: [{ id: "person-an", email_primary: "an@example.com" }],
      insertError: { code: "23503" }
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await resolveParticipantIdentity({
      authUserId: AUTH_USER,
      authEmail: "an@example.com"
    });

    expect(result.error).toBeTruthy();
    expect(result.personId).toBeNull();
  });

  it("chưa cấu hình được Supabase thì cũng là lỗi, không phải không nhận ra", async () => {
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(null as never);

    const result = await resolveParticipantIdentity({
      authUserId: AUTH_USER,
      authEmail: "an@example.com"
    });

    expect(result.error).toBeTruthy();
    expect(result.refusal).toBeNull();
    expect(result.personId).toBeNull();
  });
});

describe("cổng vào", () => {
  it("thiếu id tài khoản thì dừng trước khi chạm database", async () => {
    const fake = makeClient({});
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await resolveParticipantIdentity({ authUserId: "", authEmail: "a@b.com" });

    expect(result.personId).toBeNull();
    expect(fake.from).not.toHaveBeenCalled();
  });

  it("tra mối nối theo ĐÚNG tài khoản đang đăng nhập", async () => {
    const fake = makeClient({ link: { person_id: "person-cu", status: "active" } });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    await resolveParticipantIdentity({ authUserId: AUTH_USER, authEmail: "an@example.com" });

    expect(fake.queries).toContainEqual({
      table: "account_person_auth_links",
      op: "eq",
      column: "auth_user_id",
      value: AUTH_USER
    });
  });
});
