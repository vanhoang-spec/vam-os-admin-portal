// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
vi.mock("react-dom", async (original) => ({
  ...(await original<typeof import("react-dom")>()),
  useFormState: (_action: unknown, initial: unknown) => [initial, undefined],
  useFormStatus: () => ({ pending: false })
}));
vi.mock("@/app/checkin/[token]/actions", () => ({ submitEventCheckinAction: vi.fn() }));
vi.mock("@/lib/events", () => ({ getPublicCheckinData: async () => ({
  ok: true, event: { id: "e", event_name: "Mentor Orientation", show_student_id_field: false }, eventLink: {}
}) }));
import { CheckinForm } from "@/app/checkin/[token]/checkin-form";
import CheckinPage from "@/app/checkin/[token]/page";
afterEach(cleanup);
it("mentor không thấy MSSV, vẫn có email bắt buộc và nút check-in", () => {
  render(<CheckinForm token="t" showStudentId={false} />);
  expect(screen.queryByRole("textbox", { name: "Mã số sinh viên" })).toBeNull();
  expect(screen.getByRole("textbox", { name: /Email/ }).hasAttribute("required")).toBe(true);
  expect(screen.getByRole("button", { name: "Check-in" })).toBeTruthy();
});
it("sự kiện khác vẫn hiện MSSV khi bật hoặc chưa cấu hình", () => {
  render(<CheckinForm token="t" />);
  expect(screen.getByRole("textbox", { name: "Mã số sinh viên" })).toBeTruthy();
});
it("trang check-in truyền cấu hình ẩn MSSV từ đúng Event xuống form", async () => {
  render(await CheckinPage({ params: Promise.resolve({ token: "t" }) }));
  expect(screen.queryByRole("textbox", { name: "Mã số sinh viên" })).toBeNull();
  expect(screen.getByRole("textbox", { name: /Email/ })).toBeTruthy();
});
