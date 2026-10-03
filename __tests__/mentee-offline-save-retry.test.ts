/**
 * Lưu kết quả không còn mất khi Support đổi phòng/bàn trong lúc mentor đang chấm
 * (sự cố 03/10/2026: ~30 lần STALE_REVISION 09:20–11:20, mentor tải lại và mất phiếu).
 */
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), fresh: null as any, actor: { id: "mentor-1" } as any }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: async () => mocks.actor }));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: () => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      const b: any = {
        select: () => b, eq: () => b,
        single: async () => ({ data: table === "seasons" ? { id: "season" } : null, error: null }),
        maybeSingle: async () => ({ data: table === "mentee_interview_operations" ? mocks.fresh : null, error: null })
      };
      return b;
    }
  })
}));

import { saveOfflineInterview } from "@/lib/mentee-offline";

const STALE = { data: null, error: { code: "P0001", message: "STALE_REVISION" } };
const OK = { data: { ok: true, message: "Đã lưu." }, error: null };
const input = { applicationId: "app-1", action: "result", revision: 2, values: { outcome: "passed" } };
const revisions = () => mocks.rpc.mock.calls.map((c) => c[1].p_revision);

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.fresh = { revision: 4, interviewer_id: "mentor-1", outcome: null, checked_in_at: "2026-10-03T02:00:00Z" };
});

it("Support đổi bàn trong lúc chấm: tự gửi lại với phiên bản mới nhất, lưu được", async () => {
  mocks.rpc.mockResolvedValueOnce(STALE).mockResolvedValueOnce(OK);
  expect(await saveOfflineInterview(input)).toEqual({ ok: true, message: "Đã lưu." });
  expect(revisions()).toEqual([2, 4]);
  expect(mocks.rpc.mock.calls[1][1]).toMatchObject({ p_actor: "mentor-1", p_application: "app-1", p_action: "result", p_values: input.values });
});

it("hồ sơ đã chuyển cho người phỏng vấn khác: KHÔNG gửi lại", async () => {
  mocks.fresh.interviewer_id = "mentor-2";
  mocks.rpc.mockResolvedValueOnce(STALE);
  const result = await saveOfflineInterview(input);
  expect(result.ok).toBe(false);
  expect(revisions()).toEqual([2]);
});

it("đã có kết quả (lần gửi trước đã lưu): KHÔNG đè, báo đã lưu trước đó", async () => {
  mocks.fresh.outcome = "passed";
  mocks.rpc.mockResolvedValueOnce(STALE);
  const result = await saveOfflineInterview(input);
  expect(result).toMatchObject({ ok: false, message: expect.stringContaining("đã được lưu trước đó") });
  expect(revisions()).toEqual([2]);
});

it("thao tác của Support (check-in / phân bàn) không tự gửi lại — họ cần thấy thay đổi", async () => {
  mocks.rpc.mockResolvedValueOnce(STALE);
  expect((await saveOfflineInterview({ ...input, action: "assign" })).ok).toBe(false);
  expect(revisions()).toEqual([2]);
});

it("chỉ gửi lại MỘT lần: lần hai vẫn trễ thì trả lỗi, không lặp", async () => {
  mocks.rpc.mockResolvedValueOnce(STALE).mockResolvedValueOnce(STALE);
  const result = await saveOfflineInterview(input);
  expect(result.ok).toBe(false);
  expect(revisions()).toEqual([2, 4]);
});
