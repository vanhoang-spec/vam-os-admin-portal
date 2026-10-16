/**
 * @vitest-environment jsdom
 */
/**
 * Vòng 2 · Báo cáo — khung "3. Nhắc mentor chưa chọn mentee" (BTC 16/10/2026).
 *
 * BTC bấm gửi nhắc vào trưa, nên khung phải nói đúng ba điều: sẽ nhắc bao nhiêu người, vì sao nút đang
 * khoá (vòng chưa mở/đã đóng, không còn ai cần nhắc, chạm hạn mức), và phải qua một bước xác nhận ngay
 * trên trang trước khi thư đi tới mentor thật.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>();
  return { ...actual, useFormState: (_fn: unknown, initial: unknown) => [initial, vi.fn()], useFormStatus: () => ({ pending: false }) };
});
vi.mock("@/app/actions/matching-round2", () => ({
  sendRound2ReminderTestAction: vi.fn(),
  sendRound2RemindersAction: vi.fn(),
  sendRound2InvitesAction: vi.fn(),
  sendRound2TestAction: vi.fn(),
  setRound2WindowAction: vi.fn()
}));

import { Round2ReminderPanel, type ReminderPanelProps } from "@/app/matches/vong-2/bao-cao/reminder-panel";

const base: ReminderPanelProps = { window: "open", eligible: 189, remindedRecently: 0, sentInWindow: 120, allowance: 800 };
const text = (c: HTMLElement) => c.textContent ?? "";

afterEach(() => cleanup());

describe("khung nhắc mentor chưa chọn mentee", () => {
  it("nói số mentor sẽ nhắc, số đã được nhắc gần đây, hạn mức; có nút gửi thử và nút gửi thật", () => {
    const { container } = render(<Round2ReminderPanel {...base} remindedRecently={12} />);
    expect(text(container)).toContain("Sẽ nhắc: 189 mentor");
    expect(text(container)).toContain("Đã được nhắc gần đây: 12");
    expect(text(container)).toContain("120/1.000");
    expect(text(container)).toContain("Gửi thử thư nhắc cho tôi");
    expect(container.querySelector('[data-testid="reminder-send"]')?.textContent).toBe("Gửi thư nhắc (tối đa 189 thư)");
  });

  it("số thư mỗi lần bấm = min(số cần nhắc, phần hạn mức còn lại)", () => {
    const { container } = render(<Round2ReminderPanel {...base} allowance={150} />);
    expect(container.querySelector('[data-testid="reminder-send"]')?.textContent).toBe("Gửi thư nhắc (tối đa 150 thư)");
  });

  it("bấm gửi chưa đi thư: hiện câu hỏi xác nhận kèm số thư, có nút Huỷ; form xác nhận mang dấu confirmed=yes", () => {
    const { container, getByText } = render(<Round2ReminderPanel {...base} eligible={189} allowance={800} />);
    fireEvent.click(container.querySelector('[data-testid="reminder-send"]')!);
    expect(text(container)).toContain("Gửi 189 thư nhắc tới mentor thật?");
    expect(container.querySelector('input[name="confirmed"][value="yes"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="reminder-send"]')).toBeNull();
    fireEvent.click(getByText("Huỷ"));
    expect(container.querySelector('[data-testid="reminder-send"]')).not.toBeNull();
    expect(container.querySelector('input[name="confirmed"]')).toBeNull();
  });

  it.each([
    ["vòng chưa mở", { window: "not_open" as const }, "Vòng 2 chưa mở"],
    ["vòng đã đóng", { window: "closed" as const }, "Vòng 2 đã đóng"],
    ["không còn ai cần nhắc", { eligible: 0 }, "Không có mentor nào cần nhắc"],
    ["chạm hạn mức", { allowance: 0 }, "Đã chạm phần hạn mức"],
    ["không đếm được thư đã gửi", { allowance: 0, sentInWindow: null }, "Không đếm được"]
  ])("khoá nút gửi và nói lý do: %s", (_name, over, reason) => {
    const { container } = render(<Round2ReminderPanel {...base} {...over} />);
    expect(container.querySelector('[data-testid="reminder-send"]')).toBeNull();
    expect(text(container)).toContain(reason);
    // Gửi thử vẫn dùng được: BTC vẫn đọc thư trước khi vòng mở.
    expect(text(container)).toContain("Gửi thử thư nhắc cho tôi");
  });
});
