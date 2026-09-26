/**
 * Đổi người chấm kèm hạn mới — tầng thư viện và luật thuần.
 *
 * Lỗi gốc: hàm đổi người chép nguyên hạn của bài cũ sang bài mới. Người cũ trễ
 * hạn thì người mới nhận việc với hạn đã qua, bị tính trễ ngay phút đầu, và màn
 * hình không có chỗ nào sửa.
 *
 * Khẳng định CHÍNH lệnh ghi được phát ra: đúng hàm nào, mang đúng mốc nào — và
 * không có lệnh ghi thứ hai nào đi riêng từ ứng dụng.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(),
  canReviewSeason: vi.fn(),
  canOperateSeason: vi.fn()
}));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { reassignApplicationReview } from "@/lib/application-reviews";
import {
  REASSIGN_NEW_DUE_REQUIRED,
  reassignDueInputProblem,
  reviewDueHasPassed
} from "@/lib/review-due";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

const ADMIN_ID = "admin-1";
const INPUT = {
  reviewId: "review-old",
  newReviewerAdminUserId: "rev-new",
  adminUserId: ADMIN_ID,
  reason: "Reviewer trễ hạn chấm"
};

type RpcResult = { data: unknown; error: unknown };
let rpcResult: RpcResult;
let rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
let tableTouches: string[];

beforeEach(() => {
  rpcResult = { data: "review-new", error: null };
  rpcCalls = [];
  tableTouches = [];
  (getCurrentAdminUser as Mock).mockResolvedValue({ id: ADMIN_ID, role: "core_team", status: "active" });
  (getSupabaseServiceRoleClient as Mock).mockReturnValue({
    // Một lệnh ghi đi riêng (ví dụ update due_at sau khi đổi người) sẽ hiện ở đây.
    from: (table: string) => {
      tableTouches.push(table);
      throw new Error(`không được chạm bảng ${table} trực tiếp`);
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return rpcResult;
    }
  });
});

describe("reassignApplicationReview — một lệnh ghi, mang hạn mới", () => {
  it("gửi hạn mới xuống CÙNG lời gọi đổi người", async () => {
    const result = await reassignApplicationReview({ ...INPUT, newDueAt: "2026-09-30T16:59:59.000Z" });

    expect(result).toEqual({ ok: true, id: "review-new" });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe("vam103_reassign_review_with_due");
    expect(rpcCalls[0].args).toEqual({
      p_review_id: "review-old",
      p_actor: ADMIN_ID,
      p_reason: "Reviewer trễ hạn chấm",
      p_new_reviewer: "rev-new",
      p_new_due_at: "2026-09-30T16:59:59.000Z"
    });
    expect(tableTouches).toEqual([]);
  });

  it("không gửi hạn mới: p_new_due_at là null — giữ hạn cũ, database tự kiểm hạn cũ", async () => {
    await reassignApplicationReview(INPUT);
    expect(rpcCalls[0].args.p_new_due_at).toBeNull();
  });

  it("database báo hạn cũ đã qua: nói đúng việc cần làm", async () => {
    rpcResult = { data: null, error: { message: "NEW_DUE_REQUIRED" } };
    expect(await reassignApplicationReview(INPUT)).toEqual({ ok: false, message: REASSIGN_NEW_DUE_REQUIRED });
  });

  it("database báo hạn mới đã qua: nói đúng việc cần làm", async () => {
    rpcResult = { data: null, error: { message: "NEW_DUE_IN_PAST" } };
    const result = await reassignApplicationReview({ ...INPUT, newDueAt: "2026-09-01T16:59:59.000Z" });
    expect(result).toEqual({ ok: false, message: "Hạn chấm mới đã qua. Chọn một ngày từ hôm nay trở đi." });
  });

  it("lỗi khác: không lộ chữ của database", async () => {
    rpcResult = { data: null, error: { message: "permission denied for table application_reviews" } };
    const result = await reassignApplicationReview(INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toContain("application_reviews");
  });

  it("hồ sơ đã rút: vẫn giữ lời báo riêng như trước", async () => {
    rpcResult = { data: null, error: { message: "APPLICATION_WITHDRAWN" } };
    const result = await reassignApplicationReview(INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/rút/);
  });

  it("support_team: bị chặn trước database, không ghi gì", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: ADMIN_ID, role: "support_team", status: "active" });
    const result = await reassignApplicationReview({ ...INPUT, newDueAt: "2026-09-30T16:59:59.000Z" });
    expect(result).toEqual({ ok: false, message: "Bạn không có quyền thực hiện thao tác review này." });
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("luật thuần của ô hạn mới", () => {
  // 10:00 sáng 26/09/2026 giờ Việt Nam.
  const NOW = new Date("2026-09-26T03:00:00.000Z");
  const PAST = "2026-09-24T16:59:59.000Z"; // hết ngày 24/09
  const FUTURE = "2026-10-05T16:59:59.000Z";

  it("hạn đã qua / chưa qua / không có hạn", () => {
    expect(reviewDueHasPassed(PAST, NOW)).toBe(true);
    expect(reviewDueHasPassed(FUTURE, NOW)).toBe(false);
    expect(reviewDueHasPassed(null, NOW)).toBe(false);
    expect(reviewDueHasPassed("không-phải-ngày", NOW)).toBe(false);
  });

  it("hạn cũ đã qua, ô để trống: phải điền", () => {
    expect(reassignDueInputProblem("", "", PAST, NOW)).toBe(REASSIGN_NEW_DUE_REQUIRED);
  });

  it("hạn cũ đã qua, điền ngày hợp lệ: gửi được", () => {
    expect(reassignDueInputProblem("30/09/2026", "2026-09-30", PAST, NOW)).toBeNull();
  });

  it("hạn cũ còn hiệu lực hoặc không có hạn, ô để trống: gửi được (giữ như cũ)", () => {
    expect(reassignDueInputProblem("", "", FUTURE, NOW)).toBeNull();
    expect(reassignDueInputProblem("", "", null, NOW)).toBeNull();
  });

  it("gõ dở hoặc ngày đã qua: chặn, dù hạn cũ còn hiệu lực", () => {
    expect(reassignDueInputProblem("30/09", "", FUTURE, NOW)).toMatch(/Gõ đủ ngày/);
    expect(reassignDueInputProblem("20/09/2026", "2026-09-20", FUTURE, NOW)).toMatch(/đã qua/);
  });

  it("hạn cũ hết vào CUỐI ngày theo giờ Việt Nam: 23:00 ngày 24/09 vẫn chưa qua", () => {
    const lateEvening = new Date("2026-09-24T16:00:00.000Z"); // 23:00 giờ Việt Nam
    expect(reviewDueHasPassed(PAST, lateEvening)).toBe(false);
    expect(reassignDueInputProblem("", "", PAST, lateEvening)).toBeNull();
  });
});
