/**
 * Hai đường giao việc — hàng loạt và từng hồ sơ — đọc hạn hoàn tất theo CÙNG một
 * cách, và từ chối thay vì giao đi mà rơi mất hạn.
 *
 * Khẳng định chính lệnh giao được phát ra: đúng mốc thời gian nào, hay không
 * phát ra lệnh nào cả.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentAdminUser: vi.fn(),
  assignSelectedApplicationReviews: vi.fn(),
  assignApplicationReview: vi.fn(),
  reassignApplicationReview: vi.fn()
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: mocks.getCurrentAdminUser }));
vi.mock("@/lib/permissions", () => ({
  canBulkAssignReviews: () => true,
  canAssignReviewLots: () => true,
  canAssignReview: () => true,
  canReview: () => true
}));
vi.mock("@/lib/bulk-assignment", () => ({
  assignSelectedApplicationReviews: mocks.assignSelectedApplicationReviews
}));
vi.mock("@/lib/review-assignment-notice", () => ({
  notifyReviewerOfAssignment: vi.fn(async () => ({ status: "sent", reviewerLabel: "Reviewer 1" }))
}));
vi.mock("@/lib/application-reviews", () => ({
  assignApplicationReview: mocks.assignApplicationReview,
  cancelApplicationReview: vi.fn(),
  reassignApplicationReview: mocks.reassignApplicationReview,
  saveApplicationReviewDraft: vi.fn(),
  submitApplicationReview: vi.fn()
}));

import { bulkAssignApplicationReviewsAction } from "@/app/actions/bulk-assignment";
import { assignApplicationReviewAction, reassignApplicationReviewAction } from "@/app/actions/application-reviews";
import { initialBulkAssignmentActionState } from "@/lib/bulk-assignment-action-types";
import { initialReviewActionState } from "@/lib/review-action-types";

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
  mocks.assignApplicationReview.mockResolvedValue({ ok: true, id: "review-1" });
  mocks.reassignApplicationReview.mockResolvedValue({ ok: true, id: "review-2" });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

function bulkForm(due?: string) {
  const form = new FormData();
  form.append("application_ids", "app-1");
  form.append("application_ids", "app-2");
  form.append("reviewer_id", "rev-1");
  form.append("review_round", "profile_screening");
  if (due !== undefined) form.append("due_at", due);
  return form;
}

function singleForm(due?: string) {
  const form = new FormData();
  form.append("application_id", "app-1");
  form.append("reviewer_admin_user_id", "rev-1");
  form.append("review_round", "profile_screening");
  if (due !== undefined) form.append("due_at", due);
  return form;
}

describe("giao hàng loạt", () => {
  it("gửi xuống hết ngày theo giờ Việt Nam, không phải chuỗi ngày thô", async () => {
    const state = await bulkAssignApplicationReviewsAction(initialBulkAssignmentActionState, bulkForm("2026-09-20"));

    expect(mocks.assignSelectedApplicationReviews).toHaveBeenCalledTimes(1);
    expect(mocks.assignSelectedApplicationReviews.mock.calls[0][0].dueAt).toBe("2026-09-20T16:59:59.000Z");
    expect(state.ok).toBe(true);
    expect(state.message).toContain("hạn hoàn tất hết ngày 20/09/2026");
  });

  it("để trống: giao không hạn, và lời báo không nhắc tới hạn", async () => {
    const state = await bulkAssignApplicationReviewsAction(initialBulkAssignmentActionState, bulkForm(""));

    expect(mocks.assignSelectedApplicationReviews.mock.calls[0][0].dueAt).toBeNull();
    expect(state.message).not.toContain("hạn");
  });

  it("không có ô hạn: vẫn giao được, không hạn", async () => {
    await bulkAssignApplicationReviewsAction(initialBulkAssignmentActionState, bulkForm());
    expect(mocks.assignSelectedApplicationReviews.mock.calls[0][0].dueAt).toBeNull();
  });

  it("hạn đã qua: từ chối, và KHÔNG giao gì", async () => {
    const state = await bulkAssignApplicationReviewsAction(initialBulkAssignmentActionState, bulkForm("2026-09-10"));

    expect(state.ok).toBe(false);
    expect(state.message).toMatch(/đã qua/);
    expect(mocks.assignSelectedApplicationReviews).not.toHaveBeenCalled();
  });

  it("hạn không đọc được: từ chối, và KHÔNG giao đi mà rơi mất hạn", async () => {
    const state = await bulkAssignApplicationReviewsAction(initialBulkAssignmentActionState, bulkForm("20/09/2026"));

    expect(state.ok).toBe(false);
    expect(mocks.assignSelectedApplicationReviews).not.toHaveBeenCalled();
  });
});

describe("giao từng hồ sơ", () => {
  it("đọc hạn đúng như giao hàng loạt", async () => {
    await assignApplicationReviewAction(initialReviewActionState, singleForm("2026-09-20"));

    expect(mocks.assignApplicationReview).toHaveBeenCalledTimes(1);
    expect(mocks.assignApplicationReview.mock.calls[0][0].dueAt).toBe("2026-09-20T16:59:59.000Z");
  });

  it("để trống: giao không hạn", async () => {
    await assignApplicationReviewAction(initialReviewActionState, singleForm(""));
    expect(mocks.assignApplicationReview.mock.calls[0][0].dueAt).toBeNull();
  });

  it("hạn đã qua: từ chối, và KHÔNG giao gì", async () => {
    const state = await assignApplicationReviewAction(initialReviewActionState, singleForm("2026-09-10"));

    expect(state.ok).toBe(false);
    expect(mocks.assignApplicationReview).not.toHaveBeenCalled();
  });
});

function reassignForm(due?: string) {
  const form = new FormData();
  form.append("review_id", "review-1");
  form.append("application_id", "app-1");
  form.append("new_reviewer_admin_user_id", "rev-2");
  form.append("reason", "Reviewer trễ hạn chấm");
  if (due !== undefined) form.append("new_due_at", due);
  return form;
}

describe("đổi người chấm — hạn mới", () => {
  it("đọc hạn đúng như lúc giao việc, và gửi CÙNG lời gọi đổi người", async () => {
    const state = await reassignApplicationReviewAction(initialReviewActionState, reassignForm("2026-09-20"));

    expect(mocks.reassignApplicationReview).toHaveBeenCalledTimes(1);
    expect(mocks.reassignApplicationReview.mock.calls[0][0]).toMatchObject({
      reviewId: "review-1",
      newReviewerAdminUserId: "rev-2",
      adminUserId: "admin-1",
      newDueAt: "2026-09-20T16:59:59.000Z"
    });
    expect(state.ok).toBe(true);
    expect(state.message).toContain("Hạn mới: hết ngày 20/09/2026");
  });

  it("để trống: giữ hạn cũ (null), và lời báo không nhắc hạn mới", async () => {
    const state = await reassignApplicationReviewAction(initialReviewActionState, reassignForm(""));

    expect(mocks.reassignApplicationReview.mock.calls[0][0].newDueAt).toBeNull();
    expect(state.message).not.toContain("Hạn mới");
  });

  it("form cũ không có ô hạn: vẫn đổi được, giữ hạn cũ", async () => {
    await reassignApplicationReviewAction(initialReviewActionState, reassignForm());
    expect(mocks.reassignApplicationReview.mock.calls[0][0].newDueAt).toBeNull();
  });

  it("hạn mới đã qua: từ chối, và KHÔNG đổi người", async () => {
    const state = await reassignApplicationReviewAction(initialReviewActionState, reassignForm("2026-09-10"));

    expect(state.ok).toBe(false);
    expect(state.message).toMatch(/đã qua/);
    expect(mocks.reassignApplicationReview).not.toHaveBeenCalled();
  });

  it("hạn không đọc được: từ chối, KHÔNG đổi người mà rơi mất hạn", async () => {
    const state = await reassignApplicationReviewAction(initialReviewActionState, reassignForm("20/09/2026"));

    expect(state.ok).toBe(false);
    expect(mocks.reassignApplicationReview).not.toHaveBeenCalled();
  });

  it("database từ chối (hạn cũ đã qua mà để trống): đưa nguyên lời báo lên màn hình", async () => {
    mocks.reassignApplicationReview.mockResolvedValue({ ok: false, message: "Hạn cũ đã qua. Đặt hạn mới." });
    const state = await reassignApplicationReviewAction(initialReviewActionState, reassignForm(""));

    expect(state).toEqual({ ok: false, message: "Hạn cũ đã qua. Đặt hạn mới." });
  });
});
