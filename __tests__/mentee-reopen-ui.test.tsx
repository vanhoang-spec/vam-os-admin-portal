// @vitest-environment jsdom
/**
 * Khung "Mở lại chọn ca cho bạn chưa chọn" (ca-mentee): gửi hàng loạt phải qua
 * bước xác nhận NGAY TRÊN TRANG; gửi thử thì không; Support chỉ xem.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ submit: vi.fn() }));
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useFormState: () => [null, mocks.submit] };
});
vi.mock("@/app/actions/mentee-reopen-notice", () => ({ sendReopenNoticesAction: vi.fn() }));

import { ReopenNoticePanel, type ReopenNoticePanelProps } from "@/app/interviews/ca-mentee/reopen-notice-panel";

const base: ReopenNoticePanelProps = {
  total: 72, pending: 72, notified: 0, deadlineLabel: "20:00 ngày 03/10/2026", anyBookable: true,
  sentInWindow: 138, allowance: 40, preview: { subject: "[UEH Mentoring] Mở lại chọn ca", text: "Chào Nguyễn Văn A" }, canOperate: true
};
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const mode = (call: number) => (mocks.submit.mock.calls[call][0] as FormData).get("mode");

it("gửi hàng loạt: bấm lần đầu chỉ hiện xác nhận; Huỷ không gửi; Xác nhận gửi đúng một lượt", () => {
  render(<ReopenNoticePanel {...base} />);
  fireEvent.click(screen.getByRole("button", { name: "Gửi thư cho 40 bạn" }));
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(screen.getByText("Gửi thư mở lại chọn ca tới 40 bạn?")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Huỷ" }));
  expect(mocks.submit).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Gửi thư cho 40 bạn" }));
  fireEvent.click(screen.getByRole("button", { name: "Xác nhận gửi" }));
  expect(mocks.submit).toHaveBeenCalledTimes(1);
  expect(mode(0)).toBe("send");
});

it("gửi thử đi thẳng, đánh dấu chế độ thử", () => {
  render(<ReopenNoticePanel {...base} />);
  fireEvent.click(screen.getByRole("button", { name: "Gửi thử cho tôi" }));
  expect(mocks.submit).toHaveBeenCalledTimes(1);
  expect(mode(0)).toBe("test");
});

it("hết người chờ hoặc không còn ca: nút gửi khoá và nói lý do", () => {
  render(<ReopenNoticePanel {...base} pending={0} notified={72} />);
  expect((screen.getByRole("button", { name: "Gửi thư cho 0 bạn" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("Không còn ai chờ thư mở lại.")).toBeTruthy();
  cleanup();
  render(<ReopenNoticePanel {...base} anyBookable={false} />);
  expect((screen.getByRole("button", { name: "Gửi thư cho 40 bạn" }) as HTMLButtonElement).disabled).toBe(true);
});

it("Support (không vận hành) chỉ xem số và thư mẫu, không có nút gửi", () => {
  render(<ReopenNoticePanel {...base} canOperate={false} />);
  expect(screen.getByTestId("reopen-pending").textContent).toBe("72");
  expect(screen.queryByRole("button", { name: /Gửi/ })).toBeNull();
  expect(screen.getByText("Xem thư mẫu")).toBeTruthy();
});
