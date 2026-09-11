/**
 * Mốc đăng nhập lần đầu của người được mời.
 *
 * Không có mốc này, màn hình mời hiện người đã dùng tài khoản là "chưa vào" mãi,
 * và ban tổ chức cứ gửi lại thư cho họ. Nhưng lệnh ghi này tuyệt đối không được
 * chặn ai đăng nhập.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { recordParticipantActivation } from "@/lib/participant-auth";

type Update = { table: string; payload: Record<string, unknown>; filters: Array<[string, string, unknown]> };

function recordingClient(error: { code?: string; message: string } | null = null) {
  const updates: Update[] = [];
  const client = {
    from: (table: string) => ({
      update: (payload: Record<string, unknown>) => {
        const filters: Array<[string, string, unknown]> = [];
        const chain: any = {
          eq: (column: string, value: unknown) => (filters.push(["eq", column, value]), chain),
          is: (column: string, value: unknown) => (filters.push(["is", column, value]), chain),
          then: (resolve: any, reject: any) => {
            updates.push({ table, payload, filters });
            return Promise.resolve({ data: null, error }).then(resolve, reject);
          }
        };
        return chain;
      }
    })
  };
  return { client, updates };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("ghi hẹp", () => {
  it("đúng một lệnh sửa, chỉ cột activated_at, chỉ khi còn trống, đúng cặp tài khoản-người", async () => {
    const db = recordingClient();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db.client as never);

    await recordParticipantActivation({ authUserId: "auth-1", personId: "person-1" });

    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].table).toBe("account_person_auth_links");
    expect(Object.keys(db.updates[0].payload)).toEqual(["activated_at"]);
    expect(String(db.updates[0].payload.activated_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(db.updates[0].filters).toEqual([
      ["eq", "auth_user_id", "auth-1"],
      ["eq", "person_id", "person-1"],
      ["eq", "status", "active"],
      ["is", "activated_at", null]
    ]);
  });
});

describe("không bao giờ chặn đăng nhập", () => {
  it("database từ chối: không ném lỗi", async () => {
    const db = recordingClient({ code: "42501", message: "permission denied" });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db.client as never);
    await expect(recordParticipantActivation({ authUserId: "auth-1", personId: "person-1" })).resolves.toBeUndefined();
  });

  it("không có client: không ném lỗi", async () => {
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(null as never);
    await expect(recordParticipantActivation({ authUserId: "auth-1", personId: "person-1" })).resolves.toBeUndefined();
  });

  it("client ném lỗi giữa chừng: không ném lỗi", async () => {
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue({
      from: () => {
        throw new Error("mất kết nối");
      }
    } as never);
    await expect(recordParticipantActivation({ authUserId: "auth-1", personId: "person-1" })).resolves.toBeUndefined();
  });
});
