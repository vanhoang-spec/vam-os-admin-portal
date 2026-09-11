/** @vitest-environment jsdom */
/**
 * Lô đã giao nhưng thư báo không đi được — màn hình phải nói ra.
 *
 * Người vận hành không thấy cảnh báo sẽ tin rằng người chấm đã biết có việc.
 * Nên cảnh báo đứng riêng, dưới dạng cảnh báo, không lẫn vào dòng xanh "đã
 * giao thành công".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const scenario = vi.hoisted(() => ({ assignState: null as null | Record<string, unknown> }));

vi.mock("react", async () => {
  const original = await vi.importActual("react");
  return { ...original, cache: (fn: any) => fn };
});

vi.mock("react-dom", async () => {
  const original = await vi.importActual("react-dom");
  return {
    ...original,
    // The assign form's state is the one under test. The hand-back form's
    // initial state carries `failures`, which tells the two apart.
    useFormState: (action: any, initialState: any) => [
      Array.isArray(initialState?.failures) ? initialState : scenario.assignState ?? initialState,
      action
    ],
    useFormStatus: () => ({ pending: false })
  };
});

import { AssignBulkForm } from "@/app/reviews/assign-bulk/assign-bulk-form";
import type { IntakeBatch, ReviewAssignableApplication, ReviewEligibleReviewer, Season } from "@/lib/types";

const reviewers: ReviewEligibleReviewer[] = [
  { id: "rev1", email: "rev1@example.com", full_name: "Reviewer 1", role: "reviewer", current_workload: 0 }
];

const applications: ReviewAssignableApplication[] = [
  {
    id: "app1",
    full_name: "App 1",
    email_primary: "app1@test.com",
    status: "submitted",
    role_applied: "mentee",
    intake_batch_id: "batch1",
    submitted_at: "2026-01-01T00:00:00Z",
    existing_review_count: 0
  }
];

const props = {
  applications,
  reviewers,
  intakeBatchId: "batch1",
  roleApplied: "mentee",
  reviewRound: "profile_screening" as const,
  intakeBatches: [] as IntakeBatch[],
  seasons: [] as Season[],
  adminUserId: "admin1"
};

const WARNING =
  "Chưa gửi được thư báo cho Reviewer 1: Người chấm chưa có địa chỉ email. Hồ sơ vẫn đã được giao, không cần giao lại.";

describe("thư không đi được thì màn hình nói ra", () => {
  beforeEach(() => {
    // The success effect scrolls to the top; jsdom has no layout to scroll.
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });

  afterEach(() => {
    cleanup();
    scenario.assignState = null;
  });

  it("EMAIL_WARNING_IS_A_WARNING_NOT_BURIED_IN_THE_SUCCESS_LINE", () => {
    scenario.assignState = { ok: true, message: "Đã giao thành công 10 hồ sơ.", emailWarning: WARNING };
    render(<AssignBulkForm {...props} />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(WARNING);

    // The lot really was assigned, so the success line stays — and stays apart.
    const success = screen.getByText("Đã giao thành công 10 hồ sơ.");
    expect(success.closest('[role="alert"]')).toBeNull();
  });

  it("MAIL_SENT_NO_WARNING", () => {
    scenario.assignState = {
      ok: true,
      message: "Đã giao thành công 10 hồ sơ. Đã gửi thư báo cho Reviewer 1.",
      emailWarning: null
    };
    render(<AssignBulkForm {...props} />);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/Đã gửi thư báo cho Reviewer 1/)).toBeDefined();
  });
});
