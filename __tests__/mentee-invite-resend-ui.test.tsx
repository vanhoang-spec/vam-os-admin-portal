// @vitest-environment jsdom
/**
 * Bảng "Thư mời chọn ca" trên trang hồ sơ: xác nhận bằng bước thứ hai NGAY TRÊN
 * TRANG (window.confirm bị trình duyệt tích hợp của Claude chặn) — bấm lần đầu
 * không gửi gì, Huỷ không gửi gì, Xác nhận mới gửi đúng ba trường.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ submit: vi.fn() }));
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useFormState: () => [null, mocks.submit], useFormStatus: () => ({ pending: false }) };
});
vi.mock("@/app/actions/mentee-invite-resend", () => ({ correctEmailAndResendMenteeInviteAction: vi.fn() }));

import { ResendInvitePanel } from "@/app/applications/[id]/resend-invite-panel";

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it("bấm lần đầu chỉ hiện bước xác nhận; Huỷ không gửi; Xác nhận gửi đúng hồ sơ + email cũ + email mới", () => {
  render(<ResendInvitePanel applicationId="app-1" currentEmail="sai@st.ueh.edu" />);
  fireEvent.change(screen.getByLabelText("Email đúng của ứng viên"), { target: { value: "dung@st.ueh.edu.vn" } });
  fireEvent.click(screen.getByRole("button", { name: "Sửa email & gửi lại thư mời chọn ca" }));
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(screen.getByText("Sửa email thành dung@st.ueh.edu.vn và gửi lại thư mời?")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Huỷ" }));
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Xác nhận gửi" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Sửa email & gửi lại thư mời chọn ca" }));
  fireEvent.click(screen.getByRole("button", { name: "Xác nhận gửi" }));
  expect(mocks.submit).toHaveBeenCalledTimes(1);
  const fd = mocks.submit.mock.calls[0][0] as FormData;
  expect(fd.get("application_id")).toBe("app-1");
  expect(fd.get("expected_email")).toBe("sai@st.ueh.edu");
  expect(fd.get("new_email")).toBe("dung@st.ueh.edu.vn");
});

it("sửa ô email sau khi đã mở bước xác nhận: bước xác nhận đóng lại (không xác nhận nhầm email cũ)", () => {
  render(<ResendInvitePanel applicationId="app-1" currentEmail="sai@st.ueh.edu" />);
  fireEvent.click(screen.getByRole("button", { name: "Gửi lại thư mời chọn ca" }));
  expect(screen.getByRole("button", { name: "Xác nhận gửi" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Email đúng của ứng viên"), { target: { value: "khac@st.ueh.edu.vn" } });
  expect(screen.queryByRole("button", { name: "Xác nhận gửi" })).toBeNull();
});
