/** @vitest-environment jsdom */
/**
 * Ô chọn người đánh giá / phỏng vấn trên trang chi tiết đơn (BTC 03/10/2026):
 * Quản trị viên → Ban Điều hành → Người đánh giá hồ sơ, mỗi nhóm A → Z.
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("react-dom", async () => {
  const original = await vi.importActual("react-dom");
  return { ...original, useFormState: (action: any, initialState: any) => [initialState, action], useFormStatus: () => ({ pending: false }) };
});
vi.mock("@/app/actions/application-reviews", () => ({ assignApplicationReviewAction: vi.fn(), cancelApplicationReviewAction: vi.fn() }));

import { AssignmentControls } from "@/app/applications/[id]/assign-reviewer-form";
import { sortStaffForAssignment } from "@/lib/staff-order";
import type { AdminUserPublic } from "@/lib/types";

afterEach(cleanup);

const staff = [
  { id: "r2", email: "z@x", full_name: "Lương Mạnh Hùng", role: "reviewer" },
  { id: "c2", email: "c2@x", full_name: "Lê Thị Thuý", role: "core_team" },
  { id: "a2", email: "a2@x", full_name: "Lý Đức Toàn", role: "admin" },
  { id: "r1", email: "a@x", full_name: "Lâm Mỹ Phương", role: "reviewer" },
  { id: "s1", email: "s@x", full_name: "Ban Hỗ Trợ A", role: "support_team" },
  { id: "c1", email: "c1@x", full_name: "Đặng Minh Loan", role: "core_team" },
  { id: "a1", email: "a1@x", full_name: "Lương Quốc Vĩ", role: "admin" },
  { id: "sa", email: "sa@x", full_name: "Nguyễn Văn Hoàng", role: "super_admin" },
  { id: "e1", email: "e@x", full_name: "", role: "reviewer" },
  { id: "x1", email: "x@x", full_name: "Vai Trò Lạ", role: "viewer" }
] as unknown as AdminUserPublic[];

it("xếp theo nhóm vai trò rồi A → Z (tiếng Việt), vai trò lạ đứng cuối, không mất ai", () => {
  const ids = sortStaffForAssignment(staff).map((s) => s.id);
  // Lê < Lương < Lý theo thứ tự tiếng Việt; reviewer không tên xếp theo email ("e@x").
  expect(ids).toEqual(["sa", "a1", "a2", "c1", "c2", "s1", "e1", "r1", "r2", "x1"]);
  expect(sortStaffForAssignment(staff)).toHaveLength(staff.length);
  expect(staff[0].id).toBe("r2"); // không sửa mảng gốc
});

it("ô chọn trên trang chi tiết đơn hiện đúng thứ tự cho cả đánh giá hồ sơ lẫn phỏng vấn", () => {
  render(
    <AssignmentControls applicationId="app" profileReviewers={staff} interviewers={staff} profileAssignable interviewAssignable />
  );
  const selects = Array.from(document.querySelectorAll('select[name="reviewer_admin_user_id"]')) as HTMLSelectElement[];
  expect(selects).toHaveLength(2);
  for (const select of selects) {
    const labels = Array.from(select.options).filter((o) => o.value).map((o) => o.textContent);
    expect(labels.slice(0, 4)).toEqual([
      "Nguyễn Văn Hoàng — Quản trị viên cấp cao",
      "Lương Quốc Vĩ — Quản trị viên",
      "Lý Đức Toàn — Quản trị viên",
      "Đặng Minh Loan — Ban Điều hành"
    ]);
    expect(labels.indexOf("Lê Thị Thuý — Ban Điều hành")).toBeLessThan(labels.indexOf("Lâm Mỹ Phương — Người đánh giá hồ sơ"));
  }
});
