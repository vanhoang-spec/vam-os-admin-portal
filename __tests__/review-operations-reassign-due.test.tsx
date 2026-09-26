/** @vitest-environment jsdom */
/**
 * Form "Đổi Người Review" — ô hạn chấm mới.
 *
 * Trước đây form không có ô hạn: người thay nhận lại nguyên hạn của người cũ,
 * kể cả khi hạn đó đã qua. Soi đúng form đổi người — trang này còn form huỷ ở
 * ngay trên, tìm chung cả trang thì nút hay ô của form kia có thể làm test
 * xanh vô nghĩa.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";

vi.mock("react-dom", async () => {
  const original = await vi.importActual("react-dom");
  return {
    ...original,
    useFormState: (action: any, initialState: any) => [initialState, action],
    useFormStatus: () => ({ pending: false })
  };
});

vi.mock("@/app/actions/application-reviews", () => ({
  cancelApplicationReviewAction: vi.fn(),
  reassignApplicationReviewAction: vi.fn()
}));

import { ReviewOperations } from "@/app/reviews/[id]/review-operations";
import { toVietnamDateInput, toVietnamInputValue } from "@/lib/event-datetime";
import type { ReviewEligibleReviewer } from "@/lib/types";

const reviewers = [
  { id: "rev-2", email: "rev2@example.com", full_name: "Nguyễn Tiến Phong", role: "core_team" }
] as unknown as ReviewEligibleReviewer[];

/** Một ngày cách hôm nay N ngày: như người vận hành gõ, và như form gửi đi. */
function dayFromNow(days: number) {
  const posted = toVietnamInputValue(new Date(Date.now() + days * 86_400_000).toISOString()).slice(0, 10);
  return { typed: toVietnamDateInput(posted), posted };
}

/** Mốc hết ngày N ngày nữa, như cột due_at lưu. */
function dueInDays(days: number) {
  return new Date(`${dayFromNow(days).posted}T23:59:59+07:00`).toISOString();
}

function renderReassign(currentDueAt: string | null) {
  const utils = render(
    <ReviewOperations
      reviewId="review-1"
      applicationId="app-1"
      isSubmitted={false}
      isCancelled={false}
      allowReassign
      reviewers={reviewers}
      currentDueAt={currentDueAt}
    />
  );
  const form = utils
    .getAllByRole("heading", { level: 3 })
    .find((heading) => heading.textContent === "Đổi Người Review")
    ?.closest("form") as HTMLFormElement;
  if (!form) throw new Error("không thấy form đổi người");
  const scope = within(form);
  return {
    form,
    scope,
    dueInput: () => scope.getByLabelText("Hạn chấm mới — dạng ngày/tháng/năm") as HTMLInputElement,
    button: () => scope.getByRole("button", { name: "Đổi Người Review" }) as HTMLButtonElement
  };
}

describe("Đổi Người Review — hạn chấm mới", () => {
  afterEach(() => {
    cleanup();
  });

  it("hạn cũ đã qua: báo rõ, bắt buộc điền, khoá nút cho tới khi điền", () => {
    const { form, scope, dueInput, button } = renderReassign(dueInDays(-2));

    expect(scope.getByText(/đã quá hạn/)).toBeDefined();
    expect(scope.getByText(/Hạn chấm mới \(bắt buộc\)/)).toBeDefined();
    expect(scope.getByText(/Hạn cũ đã qua\. Đặt hạn mới/)).toBeDefined();
    expect(button().disabled).toBe(true);

    const day = dayFromNow(4);
    fireEvent.change(dueInput(), { target: { value: day.typed } });

    expect(new FormData(form).get("new_due_at")).toBe(day.posted);
    expect(button().disabled).toBe(false);
  });

  it("hạn cũ còn hiệu lực: để trống vẫn đổi được, và nói rõ là giữ hạn cũ", () => {
    const { form, scope, button } = renderReassign(dueInDays(3));

    expect(scope.getByText(/Hạn chấm mới \(tuỳ chọn\)/)).toBeDefined();
    expect(scope.getByText(/Để trống thì người mới giữ hạn hiện tại/)).toBeDefined();
    expect(new FormData(form).get("new_due_at")).toBe("");
    expect(button().disabled).toBe(false);
  });

  it("chưa có hạn: để trống vẫn đổi được", () => {
    const { scope, button } = renderReassign(null);

    expect(scope.getByText(/Để trống thì người mới không có hạn/)).toBeDefined();
    expect(scope.queryByText(/Hạn hiện tại/)).toBeNull();
    expect(button().disabled).toBe(false);
  });

  it("gõ dở: khoá nút — nếu không, đổi người mà rơi mất hạn người vận hành đang nhìn thấy", () => {
    const { form, dueInput, button } = renderReassign(dueInDays(3));
    fireEvent.change(dueInput(), { target: { value: "30/09" } });

    expect(new FormData(form).get("new_due_at")).toBe("");
    expect(button().disabled).toBe(true);
  });

  it("gõ một ngày đã qua: khoá nút", () => {
    const { scope, dueInput, button } = renderReassign(dueInDays(-2));
    fireEvent.change(dueInput(), { target: { value: dayFromNow(-1).typed } });

    expect(button().disabled).toBe(true);
    expect(scope.getByText(/đã qua/)).toBeDefined();
  });

  it("ô hạn nằm TRONG form đổi người, không lọt sang form huỷ", () => {
    const { form } = renderReassign(dueInDays(-2));
    const cancelForm = Array.from(document.querySelectorAll("form")).find((f) => f !== form) as HTMLFormElement;

    expect(form.querySelector('input[name="new_due_at"]')).not.toBeNull();
    expect(cancelForm.querySelector('input[name="new_due_at"]')).toBeNull();
    expect(form.querySelector('input[type="date"]')).toBeNull();
  });
});
