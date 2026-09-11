/**
 * Giao lô bị database từ chối: lời báo đi thẳng ra màn hình, và danh sách chỉ tải
 * lại khi lý do là dữ liệu trên màn hình đã cũ.
 *
 * Không tải lại thì người vận hành chỉ còn cách bấm lại vào đúng những hồ sơ vừa
 * bị từ chối — đúng chuyện đã xảy ra khi hai hồ sơ đã giao vẫn nằm ở tab "Chưa giao".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentAdminUser: vi.fn(),
  assignSelectedApplicationReviews: vi.fn(),
  notifyReviewerOfAssignment: vi.fn(),
  revalidatePath: vi.fn()
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: mocks.getCurrentAdminUser }));
vi.mock("@/lib/permissions", () => ({ canBulkAssignReviews: () => true, canAssignReviewLots: () => true }));
vi.mock("@/lib/bulk-assignment", () => ({
  assignSelectedApplicationReviews: mocks.assignSelectedApplicationReviews
}));
vi.mock("@/lib/review-assignment-notice", () => ({
  notifyReviewerOfAssignment: mocks.notifyReviewerOfAssignment
}));

import { bulkAssignApplicationReviewsAction } from "@/app/actions/bulk-assignment";
import { initialBulkAssignmentActionState } from "@/lib/bulk-assignment-action-types";

const ASSIGNMENT_SCREENS = ["/reviews", "/reviews/assign-bulk", "/reviews/progress", "/applications"];

function form() {
  const data = new FormData();
  data.append("application_ids", "app-1");
  data.append("application_ids", "app-2");
  data.append("reviewer_id", "rev-1");
  data.append("review_round", "profile_screening");
  data.append("notify_reviewer", "1");
  return data;
}

const run = () => bulkAssignApplicationReviewsAction(initialBulkAssignmentActionState, form());
const reloaded = () => mocks.revalidatePath.mock.calls.map((call) => call[0]);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentAdminUser.mockResolvedValue({ id: "admin-1", role: "admin" });
  mocks.notifyReviewerOfAssignment.mockResolvedValue({ status: "sent", reviewerLabel: "Người chấm" });
});

describe("database từ chối", () => {
  it("vì màn hình đã cũ: lời báo đi nguyên, mọi màn hình giao tải lại, không gửi thư nào", async () => {
    const message = "Có hồ sơ trong lựa chọn đã được giao chấm hồ sơ trước đó. Danh sách đã được tải lại.";
    mocks.assignSelectedApplicationReviews.mockResolvedValue({ ok: false, message, refreshList: true });

    const state = await run();

    expect(state).toEqual({ ok: false, message });
    expect(reloaded()).toEqual(ASSIGNMENT_SCREENS);
    expect(mocks.notifyReviewerOfAssignment).not.toHaveBeenCalled();
  });

  it("vì lý do khác (không có quyền mùa): báo đúng, không tải lại gì", async () => {
    const message = "Bạn không có quyền vận hành mùa của các hồ sơ này.";
    mocks.assignSelectedApplicationReviews.mockResolvedValue({ ok: false, message, refreshList: false });

    const state = await run();

    expect(state).toEqual({ ok: false, message });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.notifyReviewerOfAssignment).not.toHaveBeenCalled();
  });
});

describe("giao thành công", () => {
  it("vẫn tải lại mọi màn hình giao, đúng một lần mỗi màn hình", async () => {
    mocks.assignSelectedApplicationReviews.mockResolvedValue({
      ok: true,
      applicationsAssigned: 2,
      reviewerId: "rev-1",
      batchId: "batch-1"
    });

    const state = await run();

    expect(state.ok).toBe(true);
    expect(reloaded()).toEqual(ASSIGNMENT_SCREENS);
  });
});
