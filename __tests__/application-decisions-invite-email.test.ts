/**
 * Móc gửi thư mời phỏng vấn nằm trong applyApplicationDecisions.
 *
 * Đặt ở đó chứ không ở màn hình nào là một quyết định có hệ quả: cả màn "mời
 * phỏng vấn hàng loạt" lẫn màn quyết định chung đều đi qua hàm này, nên một
 * chỗ móc phủ được cả hai. Đổi lại, hàm này cũng xử lý MỌI quyết định khác —
 * duyệt, từ chối, waitlist — nên nó phải im lặng tuyệt đối ở những lần đó.
 *
 * Ba tính chất được khoá ở đây:
 *   1. Chỉ gửi khi quyết định là "mời phỏng vấn".
 *   2. Chỉ gửi cho những đơn RPC báo là đã đổi được trạng thái. Một đơn bị chặn
 *      vì trạng thái đã cũ mà nhận thư "bạn đã qua vòng hồ sơ" là nói dối.
 *   3. Gửi hỏng không được làm hỏng quyết định — quyết định đã nằm trong DB.
 *
 * Phân loại: DIRECT PRODUCTION TESTS.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/interview-invite-notifications", async () => {
  const actual = await vi.importActual<typeof import("@/lib/interview-invite-notifications")>(
    "@/lib/interview-invite-notifications"
  );
  return { ...actual, notifyInterviewRoundInvites: vi.fn() };
});

import { applyApplicationDecisions } from "@/lib/application-decisions";
import { notifyInterviewRoundInvites } from "@/lib/interview-invite-notifications";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

type RpcRow = { application_id: string; applied: boolean; reason: string };

let rpcRows: RpcRow[];

function makeClient() {
  return {
    rpc: vi.fn(() => Promise.resolve({ data: rpcRows, error: null }))
  } as unknown as ReturnType<typeof getSupabaseServiceRoleClient>;
}

function noNotifications() {
  return {
    sent: 0,
    failed: 0,
    skipped: 0,
    noEmail: 0,
    notAttempted: 0,
    notAttemptedNames: [] as string[]
  };
}

function decide(newStatus: string, ids: string[]) {
  return applyApplicationDecisions({
    applicationIds: ids,
    decidedByAdminUserId: "admin-1",
    newStatus,
    decisionNote: null,
    expectedStatuses: Object.fromEntries(ids.map((id) => [id, "screening_passed"]))
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rpcRows = [];
  (getSupabaseServiceRoleClient as unknown as Mock).mockImplementation(() => makeClient());
  (notifyInterviewRoundInvites as unknown as Mock).mockResolvedValue(noNotifications());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("gửi thư khi mời phỏng vấn", () => {
  it("gửi cho đúng những đơn đã đổi được trạng thái, bỏ đơn bị chặn", async () => {
    rpcRows = [
      { application_id: "a1", applied: true, reason: "" },
      { application_id: "a2", applied: false, reason: "stale_status" },
      { application_id: "a3", applied: true, reason: "" }
    ];

    await decide("invited_to_interview", ["a1", "a2", "a3"]);

    expect(notifyInterviewRoundInvites).toHaveBeenCalledTimes(1);
    expect((notifyInterviewRoundInvites as unknown as Mock).mock.calls[0][0]).toEqual({
      applicationIds: ["a1", "a3"]
    });
  });

  it("ghép kết quả gửi vào thông báo cho người vận hành", async () => {
    rpcRows = [{ application_id: "a1", applied: true, reason: "" }];
    (notifyInterviewRoundInvites as unknown as Mock).mockResolvedValue({
      ...noNotifications(),
      sent: 1
    });

    const result = await decide("invited_to_interview", ["a1"]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toContain("Đã cập nhật 1 đơn.");
      expect(result.message).toContain("Đã gửi 1 thư mời phỏng vấn.");
    }
  });
});

describe("im lặng ở mọi quyết định khác", () => {
  for (const status of [
    "approved_as_mentee",
    "rejected_or_not_fit",
    "waitlisted",
    "interview_passed",
    "screening_passed"
  ]) {
    it(`không gửi gì khi quyết định là ${status}`, async () => {
      rpcRows = [{ application_id: "a1", applied: true, reason: "" }];

      await decide(status, ["a1"]);

      expect(notifyInterviewRoundInvites).not.toHaveBeenCalled();
    });
  }

  it("không đơn nào đổi được thì không gửi, dù quyết định là mời phỏng vấn", async () => {
    rpcRows = [{ application_id: "a1", applied: false, reason: "invalid_transition" }];

    const result = await decide("invited_to_interview", ["a1"]);

    expect(result.ok).toBe(false);
    expect(notifyInterviewRoundInvites).not.toHaveBeenCalled();
  });
});

describe("gửi hỏng không làm hỏng quyết định", () => {
  it("hàm gửi ném lỗi thì quyết định vẫn báo thành công", async () => {
    rpcRows = [{ application_id: "a1", applied: true, reason: "" }];
    (notifyInterviewRoundInvites as unknown as Mock).mockRejectedValue(new Error("boom"));

    const result = await decide("invited_to_interview", ["a1"]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.applied).toBe(1);
      expect(result.message).toContain("Đã cập nhật 1 đơn.");
    }
  });
});
