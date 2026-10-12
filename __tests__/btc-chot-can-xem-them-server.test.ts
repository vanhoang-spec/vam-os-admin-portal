/**
 * Máy chủ của ô "BTC chốt kết quả" (12/10/2026) — soi chính lệnh ghi phát ra và những lần
 * KHÔNG được phát lệnh nào. Luật thật nằm trong vam119_btc_decide_needs_review (đã có bài
 * test chạy trên Postgres); ở đây giữ phần máy chủ: gửi đúng tham số, chặn sớm cái chắc
 * chắc sai, nói đúng lỗi, và chỉ làm mới các trang khi đã ghi xong.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  actor: { id: "core-1" } as { id?: string } | null,
  revalidate: vi.fn(),
  staffReads: [] as string[][]
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: async () => mocks.actor }));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: () => ({
    rpc: mocks.rpc,
    from: () => { const b: any = { select: () => b, eq: () => b, single: async () => ({ data: { id: "season-12" }, error: null }) }; return b; }
  })
}));
vi.mock("@/lib/paged-read", () => ({
  readAllPagesIn: async (_c: unknown, table: string, _col: string, idList: string[]) => {
    if (table === "admin_users") mocks.staffReads.push([...idList].sort());
    return { data: [{ id: "sup-1", full_name: "Support Một", email: "s1@example.test" }, { id: "core-9", full_name: null, email: "core9@example.test" }], error: null };
  }
}));

import { decideNeedsReviewAction } from "@/app/actions/mentee-offline";
import { decideNeedsReview, getOfflineDashboard } from "@/lib/mentee-offline";
import { BTC_DECISIONS, btcCanDecide, isBtcDecision, offlineError } from "@/lib/mentee-offline-core";

const APP = "11111111-1111-4111-8111-111111111111";
const input = (over: Partial<Parameters<typeof decideNeedsReview>[0]> = {}) => ({ applicationId: APP, revision: 3, outcome: "passed", reason: "Mục tiêu rõ", ...over });

beforeEach(() => {
  mocks.actor = { id: "core-1" };
  mocks.staffReads = [];
  mocks.revalidate.mockReset();
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: { ok: true, message: "Đã lưu.", revision: 4 }, error: null });
});

describe("gửi quyết định", () => {
  it("gọi đúng một hàm, đúng hồ sơ, phiên bản, kết quả và lý do đã bỏ khoảng trắng thừa", async () => {
    const result = await decideNeedsReview(input({ reason: "  Mục tiêu rõ, đủ cam kết \n" }));
    expect(mocks.rpc.mock.calls).toEqual([["vam119_btc_decide_needs_review", {
      p_actor: "core-1", p_application: APP, p_revision: 3, p_outcome: "passed", p_reason: "Mục tiêu rõ, đủ cam kết"
    }]]);
    expect(result).toEqual({ ok: true, message: "Đã chốt: Đạt — bạn này là mentee của mùa." });
  });

  it("“Không chọn” đi cùng đường, lời báo khác", async () => {
    const result = await decideNeedsReview(input({ outcome: "rejected", revision: 7 }));
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_outcome: "rejected", p_revision: 7 });
    expect(result).toEqual({ ok: true, message: "Đã chốt: Không chọn làm mentee." });
  });
});

describe("chặn sớm — không phát lệnh ghi nào", () => {
  it("kết quả không phải Đạt / Không chọn", async () => {
    for (const outcome of ["needs_review", "approved_as_mentee", "", "PASSED"]) {
      const r = await decideNeedsReview(input({ outcome }));
      expect(r).toEqual({ ok: false, message: "Chọn kết quả: Đạt hoặc Không chọn." });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("thiếu lý do (rỗng hoặc toàn khoảng trắng)", async () => {
    for (const reason of ["", "   ", "\n\t"]) {
      expect(await decideNeedsReview(input({ reason }))).toEqual({ ok: false, message: "Nhập lý do của quyết định — bắt buộc." });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("mã hồ sơ không phải UUID, hoặc chưa đăng nhập", async () => {
    for (const applicationId of ["guide", "", `${APP}x`]) expect((await decideNeedsReview(input({ applicationId }))).ok).toBe(false);
    mocks.actor = null;
    expect((await decideNeedsReview(input())).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("lỗi từ database nói đúng việc", () => {
  const fail = async (message: string) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message } });
    return decideNeedsReview(input());
  };

  it("không đủ quyền: nói rõ ai chốt được — không phải câu “chưa được cấp quyền phỏng vấn”", async () => {
    const r = await fail("ACCESS_DENIED");
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Core team");
    expect(r.message).not.toContain("phỏng vấn trong mùa này");
  });

  it.each([
    ["STALE_REVISION", "Tải lại trước khi lưu"],
    ["NOT_NEEDS_REVIEW", "không còn ở diện"],
    ["SAME_RESULT", "đúng kết quả này rồi"],
    ["STATUS_CHANGED", "đã được đổi ở một màn hình khác"],
    ["OTHER_MATCH_REQUIRES_BTC", "cặp ghép"],
    ["MEMBERSHIP_REQUIRES_BTC", "trạng thái tham gia"],
    ["IDENTITY_REQUIRES_BTC", "Danh tính"],
    ["APPLICATION_WITHDRAWN", "đã rút"],
    ["REASON_REQUIRED", "lý do"]
  ])("%s", async (code, fragment) => {
    const r = await fail(code);
    expect(r.ok).toBe(false);
    expect(r.message).toContain(fragment);
  });

  it("database trả về mà không xác nhận đã ghi: coi là chưa ghi", async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: false }, error: null });
    expect((await decideNeedsReview(input())).ok).toBe(false);
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect((await decideNeedsReview(input())).ok).toBe(false);
  });
});

describe("làm mới các trang", () => {
  it("ghi xong mới làm mới màn hình phỏng vấn, Ghép cặp và danh sách đơn", async () => {
    await decideNeedsReviewAction(input());
    expect(mocks.revalidate.mock.calls.map((c) => c[0]).sort()).toEqual(["/applications", "/interviews/mentee-offline", "/matches"]);
  });

  it("không ghi được thì không làm mới gì", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "STALE_REVISION" } });
    expect((await decideNeedsReviewAction(input())).ok).toBe(false);
    await decideNeedsReviewAction(input({ reason: "" }));
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});

describe("bảng màn hình: quyền chốt và tên người đã chốt", () => {
  const op = (over: Record<string, unknown> = {}) => ({
    checked_in_at: "2026-10-11T01:00:00Z", checked_in_by: "sup-1", room: 1, desk: 1, interviewer_id: "iv", review_id: "rv",
    outcome: "passed", match_id: null, revision: 4, is_online: false, online_note: null, ...over
  });
  const board = (canDecide: unknown) => ({
    canOperate: true, ...(canDecide === undefined ? {} : { canDecide }), sessions: [], participants: [], logs: [],
    candidates: [
      { id: "a", name: "A", phone: null, email: null, status: "approved_as_mentee", sessionId: "s", bookedAt: "", takeSubmitted: false,
        operation: op({ btc_decided_by: "core-9", btc_decided_at: "2026-10-12T03:00:00Z", outcome_reason: "Lý do của BTC" }) },
      { id: "b", name: "B", phone: null, email: null, status: "needs_more_review", sessionId: "s", bookedAt: "", takeSubmitted: false, operation: op({ outcome: "needs_review" }) }
    ]
  });
  const load = async (canDecide: unknown) => {
    mocks.rpc.mockImplementation(async (fn: string) => fn === "vam118_offline_board" ? { data: board(canDecide), error: null } : { data: { rubric: null }, error: null });
    const r = await getOfflineDashboard({ kind: "progress" });
    if (!r.ok) throw new Error(r.message);
    return r.data;
  };

  it("canDecide chỉ là true khi database trả đúng true — thiếu khoá hay giá trị lạ đều là không", async () => {
    expect((await load(true)).canDecide).toBe(true);
    for (const value of [false, undefined, null, "true", 1]) expect((await load(value)).canDecide).toBe(false);
  });

  it("đọc tên người check-in và người BTC đã chốt trong MỘT lần; không có tên thì dùng email; chưa ai chốt thì null", async () => {
    const data = await load(true);
    expect(mocks.staffReads).toEqual([["core-9", "sup-1"]]);
    const [a, b] = data.candidates;
    expect(a.operation).toMatchObject({ btc_decided_by_name: "core9@example.test", checked_in_by_name: "Support Một", outcome_reason: "Lý do của BTC" });
    expect(b.operation?.btc_decided_by_name).toBeNull();
  });
});

describe("phần thuần", () => {
  it("btcCanDecide: đang “cần xem thêm”, hoặc BTC đã chốt (đổi lại được); kết quả của người phỏng vấn thì không", () => {
    expect(btcCanDecide({ outcome: "needs_review", btc_decided_at: null })).toBe(true);
    expect(btcCanDecide({ outcome: "passed", btc_decided_at: "2026-10-12T03:00:00Z" })).toBe(true);
    expect(btcCanDecide({ outcome: "rejected", btc_decided_at: "2026-10-12T03:00:00Z" })).toBe(true);
    expect(btcCanDecide({ outcome: "passed", btc_decided_at: null })).toBe(false);
    expect(btcCanDecide({ outcome: "rejected" })).toBe(false);
    expect(btcCanDecide({ outcome: null })).toBe(false);
    expect(btcCanDecide(null)).toBe(false);
  });

  it("isBtcDecision: đúng hai kết quả BTC chốt được, khớp bảng nhãn", () => {
    expect(Object.keys(BTC_DECISIONS).sort()).toEqual(["passed", "rejected"]);
    expect(isBtcDecision("passed")).toBe(true);
    expect(isBtcDecision("rejected")).toBe(true);
    for (const v of ["needs_review", "", null, undefined, 1]) expect(isBtcDecision(v)).toBe(false);
  });

  it("BTC_DECIDED có lời nhắc riêng cho người phỏng vấn, không rơi về câu lỗi chung", () => {
    expect(offlineError("BTC_DECIDED")).toContain("BTC đã chốt");
    expect(offlineError("BTC_DECIDED")).not.toBe(offlineError("mot-loi-la"));
  });
});
