/** @vitest-environment jsdom */
/**
 * Giao từng hồ sơ từ trang chi tiết đơn — ô hạn hoàn tất.
 *
 * Trước đây là `<input type="date">`: Chrome tiếng Anh vẽ nó thành mm/dd/yyyy,
 * và chuỗi ngày thô nó gửi đi bị database đọc thành 07:00 sáng giờ Việt Nam.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-dom", async () => {
  const original = await vi.importActual("react-dom");
  return {
    ...original,
    useFormState: (action: any, initialState: any) => [initialState, action],
    useFormStatus: () => ({ pending: false })
  };
});

vi.mock("@/app/actions/application-reviews", () => ({
  assignApplicationReviewAction: vi.fn(),
  cancelApplicationReviewAction: vi.fn()
}));

import { AssignmentControls } from "@/app/applications/[id]/assign-reviewer-form";
import { toVietnamDateInput, toVietnamInputValue } from "@/lib/event-datetime";
import type { AdminUserPublic } from "@/lib/types";

const reviewers = [
  { id: "rev1", email: "rev1@example.com", full_name: "Reviewer 1", role: "reviewer" }
] as unknown as AdminUserPublic[];

/** A day N days from now: as the operator types it, and as the form posts it. */
function dayFromNow(days: number) {
  const posted = toVietnamInputValue(new Date(Date.now() + days * 86_400_000).toISOString()).slice(0, 10);
  return { typed: toVietnamDateInput(posted), posted };
}

function renderProfileForm() {
  return render(
    <AssignmentControls
      applicationId="app-1"
      profileReviewers={reviewers}
      interviewers={[]}
      profileAssignable
      interviewAssignable={false}
    />
  );
}

const dueInput = () => screen.getByLabelText("Hạn hoàn tất — dạng ngày/tháng/năm");
const assignButton = () => screen.getByRole("button", { name: "Giao Review" }) as HTMLButtonElement;

describe("giao từng hồ sơ — hạn hoàn tất", () => {
  afterEach(() => {
    cleanup();
  });

  it("không còn ô date của trình duyệt", () => {
    const { container } = renderProfileForm();
    expect(container.querySelector('input[type="date"]')).toBeNull();
  });

  it("gõ ngày/tháng/năm, gửi đi YYYY-MM-DD", () => {
    const { container } = renderProfileForm();
    const day = dayFromNow(5);
    fireEvent.change(dueInput(), { target: { value: day.typed } });

    const form = container.querySelector("form") as HTMLFormElement;
    expect(new FormData(form).get("due_at")).toBe(day.posted);
    expect(assignButton().disabled).toBe(false);
  });

  it("để trống vẫn giao được", () => {
    renderProfileForm();
    expect(assignButton().disabled).toBe(false);
  });

  it("gõ dở thì không cho giao — nếu không, hồ sơ được giao đi mà không có hạn", () => {
    const { container } = renderProfileForm();
    fireEvent.change(dueInput(), { target: { value: "20/09" } });

    const form = container.querySelector("form") as HTMLFormElement;
    expect(new FormData(form).get("due_at")).toBe("");
    expect(assignButton().disabled).toBe(true);
    expect(screen.getByText(/Gõ đủ ngày\/tháng\/năm/)).toBeDefined();
  });

  it("ngày đã qua thì không cho giao", () => {
    renderProfileForm();
    fireEvent.change(dueInput(), { target: { value: dayFromNow(-3).typed } });

    expect(assignButton().disabled).toBe(true);
    expect(screen.getByText(/đã qua/)).toBeDefined();
  });
});
