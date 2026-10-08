// @vitest-environment jsdom
/**
 * Khung "Báo ca chuyển sang phỏng vấn online" (ca-mentee): gửi hàng loạt phải qua bước
 * xác nhận NGAY TRÊN TRANG; gửi thử thì không; Support chỉ xem.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ submit: vi.fn() }));
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useFormState: () => [null, mocks.submit] };
});
vi.mock("@/app/actions/mentee-online-notice", () => ({ sendOnlineNoticesAction: vi.fn() }));

import { OnlineNoticePanel, type OnlineNoticePanelProps } from "@/app/interviews/ca-mentee/online-notice-panel";

const base: OnlineNoticePanelProps = {
  total: 78, pending: 78, notified: 0, sessionsWithoutLink: 0, sentInWindow: 300, allowance: 40,
  preview: { subject: "[UEH Mentoring Mùa 12] Ca phỏng vấn của bạn chuyển sang PHỎNG VẤN ONLINE", text: "Chào bạn Nguyễn Văn A" },
  canOperate: true
};
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const mode = (call: number) => (mocks.submit.mock.calls[call][0] as FormData).get("mode");

it("gửi hàng loạt: bấm lần đầu chỉ hiện xác nhận; Huỷ không gửi; Xác nhận gửi đúng một lượt", () => {
  render(<OnlineNoticePanel {...base} />);
  fireEvent.click(screen.getByRole("button", { name: "Gửi thư cho 40 bạn" }));
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(screen.getByText("Gửi thư báo phỏng vấn online tới 40 bạn?")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Huỷ" }));
  expect(mocks.submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Gửi thư cho 40 bạn" }));
  fireEvent.click(screen.getByRole("button", { name: "Xác nhận gửi" }));
  expect(mocks.submit).toHaveBeenCalledTimes(1);
  expect(mode(0)).toBe("send");
});

it("gửi thử đi thẳng, đánh dấu chế độ thử", () => {
  render(<OnlineNoticePanel {...base} />);
  fireEvent.click(screen.getByRole("button", { name: "Gửi thử cho tôi" }));
  expect(mocks.submit).toHaveBeenCalledTimes(1);
  expect(mode(0)).toBe("test");
});

it("hết người chờ hoặc hết hạn mức: nút gửi khoá và nói lý do; ca thiếu link nhóm được báo", () => {
  render(<OnlineNoticePanel {...base} pending={0} notified={78} />);
  expect((screen.getByRole("button", { name: "Gửi thư cho 0 bạn" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("Mọi bạn giữ ca online đã nhận thư.")).toBeTruthy();
  cleanup();
  render(<OnlineNoticePanel {...base} allowance={0} sessionsWithoutLink={2} />);
  expect((screen.getByRole("button", { name: "Gửi thư cho 0 bạn" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/2 ca online chưa có link nhóm/)).toBeTruthy();
});

it("Support (không vận hành) chỉ xem số và thư mẫu, không có nút gửi", () => {
  render(<OnlineNoticePanel {...base} canOperate={false} />);
  expect(screen.getByTestId("online-pending").textContent).toBe("78");
  expect(screen.queryByRole("button", { name: /Gửi/ })).toBeNull();
});
