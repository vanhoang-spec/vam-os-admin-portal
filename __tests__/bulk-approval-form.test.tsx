/** @vitest-environment jsdom */
/**
 * M092 — BulkApprovalForm UI behavior.
 *
 * The offline E2E harness (e2e/m092-bulk-official-approval.spec.ts) runs
 * with Supabase env vars pinned empty, so bulkOfficialApprovalAction can
 * only ever resolve to ok:false ("Bạn chưa đăng nhập.") there — it is
 * structurally incapable of returning real per-row results. These tests
 * cover the row-level result rendering, retry-unresolved-rows selection,
 * and the 100-row selection cap directly, the same way
 * __tests__/m091-decision-modal.test.tsx covers DecisionForm's success path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/bulk-official-approval", () => ({ bulkOfficialApproveApplications: vi.fn() }));

const mockUseFormState = vi.fn();
const mockUseFormStatus = vi.fn();
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useFormState: (...args: unknown[]) => mockUseFormState(...args),
    useFormStatus: () => mockUseFormStatus()
  };
});

import { BulkApprovalForm } from "@/app/applications/bulk-approval/bulk-approval-form";
import { bulkOfficialApprovalAction } from "@/app/actions/bulk-official-approval";
import { initialBulkApprovalActionState, MAX_BULK_APPROVAL_IDS } from "@/lib/bulk-official-approval-types";

beforeEach(() => {
  mockUseFormStatus.mockReturnValue({ pending: false });
  mockUseFormState.mockReturnValue([initialBulkApprovalActionState, bulkOfficialApprovalAction]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const mentorRow = { id: "app-mentor-1", fullName: "Mentor A", email: "mentora@example.com", role: "mentor" as const, status: "interview_passed", isRenewal: false };
const menteeRow = { id: "app-mentee-1", fullName: "Mentee B", email: "menteeb@example.com", role: "mentee" as const, status: "interview_passed", isRenewal: false };

describe("BulkApprovalForm — mixed mentor + mentee selection", () => {
  it("selecting one mentor and one mentee candidate updates the count and the confirm-dialog trigger label", () => {
    render(<BulkApprovalForm rows={[mentorRow, menteeRow]} />);
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);
    expect(screen.getByText(`Đã chọn: 2/${MAX_BULK_APPROVAL_IDS}`)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Duyệt chính thức 2 đơn/ })).toBeTruthy();
  });

  it("opening the confirm dialog states that profiles will be created/reused, and derives role from the application", () => {
    render(<BulkApprovalForm rows={[mentorRow, menteeRow]} />);
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);
    fireEvent.click(screen.getByRole("button", { name: /Duyệt chính thức 2 đơn/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/mentor \+ mentee|mentee \+ mentor/)).toBeTruthy();
    expect(within(dialog).getByText(/tạo hoặc liên kết hồ sơ người/i)).toBeTruthy();
    expect(within(dialog).getByText(/mentor\/mentee profile chính thức/i)).toBeTruthy();
  });
});

describe("BulkApprovalForm — 100-row selection cap", () => {
  const manyRows = Array.from({ length: MAX_BULK_APPROVAL_IDS + 10 }, (_, i) => ({
    id: `app-${i}`,
    fullName: `Ứng viên ${i}`,
    email: `a${i}@example.com`,
    role: (i % 2 === 0 ? "mentor" : "mentee") as "mentor" | "mentee",
    status: "interview_passed",
    isRenewal: false
  }));

  it("'Chọn tất cả' selects at most MAX_BULK_APPROVAL_IDS rows", () => {
    render(<BulkApprovalForm rows={manyRows} />);
    fireEvent.click(screen.getByRole("button", { name: /Chọn tất cả/ }));
    expect(screen.getByText(`Đã chọn: ${MAX_BULK_APPROVAL_IDS}/${MAX_BULK_APPROVAL_IDS}`)).toBeTruthy();
    const checked = screen.getAllByRole("checkbox").filter((el) => (el as HTMLInputElement).checked);
    expect(checked).toHaveLength(MAX_BULK_APPROVAL_IDS);
  });

  it("a checkbox beyond the cap is disabled once the limit is reached", () => {
    render(<BulkApprovalForm rows={manyRows} />);
    fireEvent.click(screen.getByRole("button", { name: /Chọn tất cả/ }));
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    // The 101st row (index MAX_BULK_APPROVAL_IDS) was never selected and must now be disabled.
    expect(checkboxes[MAX_BULK_APPROVAL_IDS].checked).toBe(false);
    expect(checkboxes[MAX_BULK_APPROVAL_IDS].disabled).toBe(true);
  });

  it("'Bỏ chọn tất cả' clears the selection and re-enables every checkbox", () => {
    render(<BulkApprovalForm rows={manyRows} />);
    fireEvent.click(screen.getByRole("button", { name: /Chọn tất cả/ }));
    fireEvent.click(screen.getByRole("button", { name: /Bỏ chọn tất cả/ }));
    expect(screen.getByText(`Đã chọn: 0/${MAX_BULK_APPROVAL_IDS}`)).toBeTruthy();
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(checkboxes.every((el) => !el.disabled)).toBe(true);
  });
});

describe("BulkApprovalForm — row-level results", () => {
  const rows = [
    { applicationId: "a1", targetRole: "mentor" as const, outcome: "approved" as const, reasonCode: "approved", reasonMessage: "Đã duyệt thành công.", personId: "p1", personCreated: true, profileId: "pr1", profileCreated: true },
    { applicationId: "a2", targetRole: "mentee" as const, outcome: "skipped" as const, reasonCode: "already_approved", reasonMessage: "Đơn đã ở trạng thái duyệt chính thức.", personId: null, personCreated: null, profileId: null, profileCreated: null },
    { applicationId: "a3", targetRole: "mentor" as const, outcome: "manual_required" as const, reasonCode: "blank_email", reasonMessage: "Đơn không có email — cần xử lý thủ công.", personId: null, personCreated: null, profileId: null, profileCreated: null },
    { applicationId: "a4", targetRole: "mentee" as const, outcome: "failed" as const, reasonCode: "internal_error", reasonMessage: "Lỗi hệ thống khi duyệt đơn này.", personId: null, personCreated: null, profileId: null, profileCreated: null }
  ];

  it("renders one result row per application with its outcome badge and reason", () => {
    mockUseFormState.mockReturnValue([
      { ok: true, message: "Đã duyệt 1/4 đơn.", rows },
      bulkOfficialApprovalAction
    ]);
    render(<BulkApprovalForm rows={[mentorRow, menteeRow]} />);

    expect(screen.getByText("Đã duyệt")).toBeTruthy();
    expect(screen.getByText("Bỏ qua")).toBeTruthy();
    expect(screen.getByText("Cần xử lý thủ công")).toBeTruthy();
    expect(screen.getByText("Lỗi")).toBeTruthy();
    expect(screen.getByText("Đơn không có email — cần xử lý thủ công.")).toBeTruthy();
    expect(screen.getByText("Lỗi hệ thống khi duyệt đơn này.")).toBeTruthy();
  });

  it("a failed/manual row stays retryable: clicking retry re-selects exactly those application IDs", () => {
    mockUseFormState.mockReturnValue([
      { ok: true, message: "Đã duyệt 1/4 đơn.", rows },
      bulkOfficialApprovalAction
    ]);
    const allRows = [
      { id: "a1", fullName: "A1", email: "a1@x.com", role: "mentor" as const, status: "interview_passed", isRenewal: false },
      { id: "a2", fullName: "A2", email: "a2@x.com", role: "mentee" as const, status: "interview_passed", isRenewal: false },
      { id: "a3", fullName: "A3", email: "a3@x.com", role: "mentor" as const, status: "interview_passed", isRenewal: false },
      { id: "a4", fullName: "A4", email: "a4@x.com", role: "mentee" as const, status: "interview_passed", isRenewal: false }
    ];
    render(<BulkApprovalForm rows={allRows} />);

    fireEvent.click(screen.getByRole("button", { name: /Chọn lại các dòng Lỗi\/Cần xử lý thủ công để thử lại/ }));

    expect(screen.getByText("Đã chọn: 2/100")).toBeTruthy();
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(checkboxes[0].checked).toBe(false); // a1 (approved) not reselected
    expect(checkboxes[1].checked).toBe(false); // a2 (skipped) not reselected
    expect(checkboxes[2].checked).toBe(true);  // a3 (manual_required) reselected
    expect(checkboxes[3].checked).toBe(true);  // a4 (failed) reselected
  });

  it("the retry-unresolved button is absent when there are no failed/manual rows to retry", () => {
    mockUseFormState.mockReturnValue([
      {
        ok: true,
        message: "Đã duyệt 2/2 đơn.",
        rows: [
          { applicationId: "a1", targetRole: "mentor" as const, outcome: "approved" as const, reasonCode: "approved", reasonMessage: "ok", personId: "p1", personCreated: true, profileId: "pr1", profileCreated: true },
          { applicationId: "a2", targetRole: "mentee" as const, outcome: "approved" as const, reasonCode: "approved", reasonMessage: "ok", personId: "p2", personCreated: false, profileId: "pr2", profileCreated: false }
        ]
      },
      bulkOfficialApprovalAction
    ]);
    render(<BulkApprovalForm rows={[mentorRow, menteeRow]} />);
    expect(screen.queryByRole("button", { name: /Chọn lại các dòng Lỗi/ })).toBeNull();
  });

  it("an all-failed unauthenticated response (no rows at all) shows the inline error, not a result table", () => {
    mockUseFormState.mockReturnValue([
      { ok: false, message: "Bạn chưa đăng nhập." },
      bulkOfficialApprovalAction
    ]);
    render(<BulkApprovalForm rows={[mentorRow, menteeRow]} />);
    expect(screen.getByRole("alert").textContent).toContain("Bạn chưa đăng nhập.");
    expect(screen.queryByText("Kết quả theo từng đơn")).toBeNull();
  });
});
