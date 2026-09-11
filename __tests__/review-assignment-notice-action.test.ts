/**
 * Giao lô hồ sơ → thư báo cho người chấm.
 *
 * Khẳng định chính các lệnh được phát ra, theo đúng thứ tự: thư chỉ đi sau khi
 * lô đã được giao, chỉ khi người vận hành tick, chỉ ở vòng chấm hồ sơ. Và một
 * lá thư không đi được không bao giờ biến một lần giao thành công thành thất bại.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentAdminUser: vi.fn(),
  assignSelectedApplicationReviews: vi.fn(),
  notifyReviewerOfAssignment: vi.fn()
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: mocks.getCurrentAdminUser }));
vi.mock("@/lib/permissions", () => ({ canBulkAssignReviews: () => true }));
vi.mock("@/lib/bulk-assignment", () => ({
  assignSelectedApplicationReviews: mocks.assignSelectedApplicationReviews
}));
vi.mock("@/lib/review-assignment-notice", () => ({
  notifyReviewerOfAssignment: mocks.notifyReviewerOfAssignment
}));

import { bulkAssignApplicationReviewsAction } from "@/app/actions/bulk-assignment";
import { initialBulkAssignmentActionState } from "@/lib/bulk-assignment-action-types";

// 10:00 sáng 11/09/2026 giờ Việt Nam.
const NOW = new Date("2026-09-11T03:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mocks.getCurrentAdminUser.mockResolvedValue({ id: "admin-1", role: "admin" });
  mocks.assignSelectedApplicationReviews.mockResolvedValue({
    ok: true,
    applicationsAssigned: 2,
    reviewerId: "rev-1",
    batchId: "batch-1"
  });
  mocks.notifyReviewerOfAssignment.mockResolvedValue({ status: "sent", reviewerLabel: "Võ Nguyễn Hoàng Mỹ" });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

function form({
  round = "profile_screening",
  notify = true,
  due = "2026-09-20"
}: { round?: string; notify?: boolean; due?: string } = {}) {
  const data = new FormData();
  data.append("application_ids", "app-1");
  data.append("application_ids", "app-2");
  data.append("reviewer_id", "rev-1");
  data.append("review_round", round);
  data.append("due_at", due);
  if (notify) data.append("notify_reviewer", "1");
  return data;
}

const run = (data: FormData) => bulkAssignApplicationReviewsAction(initialBulkAssignmentActionState, data);

describe("gửi thư", () => {
  it("tick gửi thư: báo cho đúng người, đúng lô, với hạn đã đọc", async () => {
    const state = await run(form());

    expect(mocks.notifyReviewerOfAssignment).toHaveBeenCalledTimes(1);
    expect(mocks.notifyReviewerOfAssignment.mock.calls[0][0]).toEqual({
      reviewerAdminUserId: "rev-1",
      applicationIds: ["app-1", "app-2"],
      applicationsAssigned: 2,
      dueAt: "2026-09-20T16:59:59.000Z",
      assignmentBatchId: "batch-1"
    });
    expect(state.ok).toBe(true);
    expect(state.message).toContain("Đã giao thành công 2 hồ sơ");
    expect(state.message).toContain("Đã gửi thư báo cho Võ Nguyễn Hoàng Mỹ.");
    expect(state.emailWarning ?? null).toBeNull();
  });

  it("thư chỉ đi SAU khi lô đã được giao", async () => {
    const order: string[] = [];
    mocks.assignSelectedApplicationReviews.mockImplementation(async () => {
      order.push("assign");
      return { ok: true, applicationsAssigned: 2, reviewerId: "rev-1", batchId: "batch-1" };
    });
    mocks.notifyReviewerOfAssignment.mockImplementation(async () => {
      order.push("notify");
      return { status: "sent", reviewerLabel: "Võ Nguyễn Hoàng Mỹ" };
    });

    await run(form());
    expect(order).toEqual(["assign", "notify"]);
  });

  it("bỏ tick: không gửi, và lời báo không nhắc tới thư", async () => {
    const state = await run(form({ notify: false }));

    expect(mocks.notifyReviewerOfAssignment).not.toHaveBeenCalled();
    expect(state.ok).toBe(true);
    expect(state.message).not.toContain("thư");
  });

  it("vòng phỏng vấn: không gửi, kể cả khi biểu mẫu có tick", async () => {
    const state = await run(form({ round: "interview" }));

    expect(mocks.assignSelectedApplicationReviews).toHaveBeenCalledTimes(1);
    expect(mocks.notifyReviewerOfAssignment).not.toHaveBeenCalled();
    expect(state.ok).toBe(true);
  });
});

describe("thư không đi được", () => {
  it("việc giao VẪN thành công, và cảnh báo nói rõ đừng giao lại", async () => {
    mocks.notifyReviewerOfAssignment.mockResolvedValue({
      status: "not_sent",
      reviewerLabel: "Võ Nguyễn Hoàng Mỹ",
      reason: "Người chấm chưa có địa chỉ email."
    });
    const state = await run(form());

    expect(state.ok).toBe(true);
    expect(state.message).toContain("Đã giao thành công 2 hồ sơ");
    expect(state.message).not.toContain("Đã gửi thư");
    expect(state.emailWarning).toBe(
      "Chưa gửi được thư báo cho Võ Nguyễn Hoàng Mỹ: Người chấm chưa có địa chỉ email. Hồ sơ vẫn đã được giao, không cần giao lại."
    );
  });
});

describe("không giao được thì không gửi thư nào", () => {
  it("hàm giao từ chối", async () => {
    mocks.assignSelectedApplicationReviews.mockResolvedValue({ ok: false, message: "Hồ sơ đã có người chấm." });
    const state = await run(form());

    expect(state.ok).toBe(false);
    expect(mocks.notifyReviewerOfAssignment).not.toHaveBeenCalled();
  });

  it("hạn hỏng: không giao, không gửi", async () => {
    const state = await run(form({ due: "2026-09-10" }));

    expect(state.ok).toBe(false);
    expect(mocks.assignSelectedApplicationReviews).not.toHaveBeenCalled();
    expect(mocks.notifyReviewerOfAssignment).not.toHaveBeenCalled();
  });
});
