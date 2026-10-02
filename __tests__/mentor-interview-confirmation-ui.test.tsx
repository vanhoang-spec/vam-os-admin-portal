// @vitest-environment jsdom
/**
 * Màn hình thư xác nhận mentor: nút gửi thật chỉ mở khi gõ ĐÚNG số người sẽ nhận,
 * và gửi đi đúng link sheet + con số đã gõ (server đọc lại và so lần nữa).
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ state: null as unknown, send: vi.fn(), test: vi.fn() }));

// react-dom 18.3.1 bản ổn định không có useFormState; Next dùng bản đóng gói riêng.
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useFormState: () => [mocks.state, vi.fn()], useFormStatus: () => ({ pending: false }) };
});
vi.mock("@/app/actions/mentor-interview-confirmation", () => ({
  previewMentorConfirmationsAction: vi.fn(),
  sendMentorConfirmationsAction: mocks.send,
  sendMentorConfirmationTestAction: mocks.test
}));

import { ConfirmationClient } from "@/app/interviews/thu-xac-nhan-mentor/confirmation-client";

const recipient = (email: string, status: string) => ({
  name: email.split("@")[0], email, phone: "", note: "", blockKeys: ["2026-10-03:sang"], status, loginEmail: status === "no_access" ? null : email, matchedBy: status === "no_access" ? null : "email"
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.send.mockResolvedValue({ ok: true, message: "Đã gửi 2/2 thư.", sent: 2, failed: [], remaining: 0 });
  mocks.state = {
    ok: true,
    sample: { to: "a@example.test", subject: "UEH MENTORING | THƯ XÁC NHẬN", body: "Kính gửi Anh/Chị Mentor A," },
    plan: {
      seasonId: "s", seasonCode: "UEHM-S12", anchorSessionId: "x", origin: "https://os.example", duplicates: [],
      blocks: [{ key: "2026-10-03:sang", label: "Thứ Bảy 03/10/2026 — buổi sáng", timeLabel: "08:00 – 11:30", rooms: "H101", place: "Cơ sở H", mapUrl: "" }],
      recipients: [recipient("a@example.test", "ready"), recipient("b@example.test", "ready"), recipient("c@example.test", "no_access"), recipient("d@example.test", "already_sent")]
    }
  };
});
afterEach(cleanup);

it("nút gửi khoá cho tới khi gõ đúng số người sẵn sàng; gửi đi đúng link + con số", async () => {
  render(<ConfirmationClient />);
  fireEvent.change(screen.getByLabelText("Link Google Sheet mentor đăng ký phỏng vấn"), { target: { value: "https://docs.google.com/spreadsheets/d/abc/edit" } });
  const send = screen.getByRole("button", { name: "Gửi thư cho 2 mentor" }) as HTMLButtonElement;
  expect(send.disabled).toBe(true);
  const box = screen.getByLabelText("Gõ đúng số người sẽ nhận (2) để mở nút gửi");
  fireEvent.change(box, { target: { value: "4" } });
  expect(send.disabled).toBe(true);
  fireEvent.change(box, { target: { value: "2" } });
  expect(send.disabled).toBe(false);
  fireEvent.click(send);
  await waitFor(() => expect(mocks.send).toHaveBeenCalledWith("https://docs.google.com/spreadsheets/d/abc/edit", "2"));
  expect(await screen.findByText("Đã gửi 2/2 thư.")).toBeTruthy();
});

it("hiện đúng từng người và trạng thái; người chưa có quyền không có địa chỉ gửi", () => {
  render(<ConfirmationClient />);
  const rowC = document.querySelector('tr[data-status="no_access"]')!;
  expect(rowC.textContent).toContain("c@example.test");
  expect(rowC.textContent).toContain("Chưa có quyền phỏng vấn");
  expect(document.querySelectorAll('tr[data-status="ready"]')).toHaveLength(2);
  expect(screen.getByText("Kính gửi Anh/Chị Mentor A,")).toBeTruthy();
});

it("không ai sẵn sàng: cả hai nút gửi đều khoá", () => {
  (mocks.state as { plan: { recipients: unknown[] } }).plan.recipients = [recipient("c@example.test", "no_access")];
  render(<ConfirmationClient />);
  expect((screen.getByRole("button", { name: "Gửi thử cho tôi" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Gửi thư cho 0 mentor" }) as HTMLButtonElement).disabled).toBe(true);
});
