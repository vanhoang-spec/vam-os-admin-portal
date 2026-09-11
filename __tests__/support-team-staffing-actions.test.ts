/**
 * support_team ở tầng server action: giao lô và trả hồ sơ đi qua được; huỷ từ
 * trang chi tiết đơn thì không — đó vẫn là việc của ban điều hành.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  actor: null as null | { id: string; role: string },
  assignSelected: vi.fn(),
  cancelReview: vi.fn()
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn(async () => state.actor) }));
vi.mock("@/lib/bulk-assignment", () => ({ assignSelectedApplicationReviews: state.assignSelected }));
vi.mock("@/lib/application-reviews", () => ({
  assignApplicationReview: vi.fn(),
  cancelApplicationReview: state.cancelReview,
  reassignApplicationReview: vi.fn(),
  saveApplicationReviewDraft: vi.fn(),
  submitApplicationReview: vi.fn()
}));

import { bulkAssignApplicationReviewsAction } from "@/app/actions/bulk-assignment";
import { bulkCancelApplicationReviewsAction } from "@/app/actions/bulk-cancel";
import { cancelApplicationReviewAction } from "@/app/actions/application-reviews";
import { initialBulkAssignmentActionState } from "@/lib/bulk-assignment-action-types";
import { initialBulkCancelActionState } from "@/lib/bulk-cancel-action-types";
import { initialReviewActionState } from "@/lib/review-action-types";

function signInAs(role: string) {
  state.actor = { id: "actor-1", role };
}

function assignForm() {
  const form = new FormData();
  form.append("application_ids", "app-1");
  form.append("reviewer_id", "rev-1");
  form.append("review_round", "profile_screening");
  return form;
}

function handBackForm() {
  const form = new FormData();
  form.append("review_id", "review-1");
  form.append("reason", "Reviewer bận, chia lại");
  return form;
}

beforeEach(() => {
  state.actor = null;
  state.assignSelected.mockReset();
  state.assignSelected.mockResolvedValue({ ok: true, applicationsAssigned: 1, reviewerId: "rev-1", batchId: "batch-1" });
  state.cancelReview.mockReset();
  state.cancelReview.mockResolvedValue({ ok: true, id: "review-1" });
});

describe("giao lô", () => {
  it("support_team đi qua được tới lệnh giao", async () => {
    signInAs("support_team");
    const result = await bulkAssignApplicationReviewsAction(initialBulkAssignmentActionState, assignForm());

    expect(result.ok).toBe(true);
    expect(state.assignSelected).toHaveBeenCalledTimes(1);
  });

  it("reviewer bị chặn, không có lệnh giao nào", async () => {
    signInAs("reviewer");
    const result = await bulkAssignApplicationReviewsAction(initialBulkAssignmentActionState, assignForm());

    expect(result.ok).toBe(false);
    expect(state.assignSelected).not.toHaveBeenCalled();
  });
});

describe("trả hồ sơ về hàng chờ", () => {
  it("support_team trả được từ màn hình giao lô", async () => {
    signInAs("support_team");
    const result = await bulkCancelApplicationReviewsAction(initialBulkCancelActionState, handBackForm());

    expect(result.ok).toBe(true);
    expect(state.cancelReview).toHaveBeenCalledTimes(1);
  });

  it("viewer bị chặn", async () => {
    signInAs("viewer");
    const result = await bulkCancelApplicationReviewsAction(initialBulkCancelActionState, handBackForm());

    expect(result.ok).toBe(false);
    expect(state.cancelReview).not.toHaveBeenCalled();
  });

  it("support_team KHÔNG huỷ được từ trang chi tiết đơn", async () => {
    signInAs("support_team");
    const form = new FormData();
    form.append("review_id", "review-1");
    form.append("application_id", "app-1");
    form.append("reason", "Reviewer bận");
    const result = await cancelApplicationReviewAction(initialReviewActionState, form);

    expect(result.ok).toBe(false);
    expect(state.cancelReview).not.toHaveBeenCalled();
  });
});
