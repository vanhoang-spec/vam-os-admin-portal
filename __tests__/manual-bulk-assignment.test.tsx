/** @vitest-environment jsdom */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AssignBulkForm } from "@/app/reviews/assign-bulk/assign-bulk-form";
import type { ReviewAssignableApplication, ReviewEligibleReviewer, IntakeBatch, Season } from "@/lib/types";

vi.mock("react", async () => {
  const original = await vi.importActual("react");
  return {
    ...original,
    cache: (fn: any) => fn
  };
});

vi.mock("react-dom", async () => {
  const original = await vi.importActual("react-dom");
  return {
    ...original,
    useFormState: (action: any, initialState: any) => [initialState, action],
    useFormStatus: () => ({ pending: false })
  };
});

describe("Manual Bulk Assignment UX (AssignBulkForm)", () => {
  afterEach(() => {
    cleanup();
  });

  const mockReviewers: ReviewEligibleReviewer[] = [
    { id: "rev1", email: "rev1@example.com", full_name: "Reviewer 1", role: "reviewer", current_workload: 0 },
    { id: "rev2", email: "rev2@example.com", full_name: "Reviewer 2", role: "reviewer", current_workload: 5 }
  ];

  const mockApplications: ReviewAssignableApplication[] = [
    {
      id: "app1",
      full_name: "App 1",
      email_primary: "app1@test.com",
      status: "submitted",
      role_applied: "mentor",
      intake_batch_id: "batch1",
      submitted_at: "2026-01-01T00:00:00Z",
      existing_review_count: 0
    },
    {
      id: "app2",
      full_name: "App 2",
      email_primary: "app2@test.com",
      status: "submitted",
      role_applied: "mentor",
      intake_batch_id: "batch1",
      submitted_at: "2026-01-02T00:00:00Z",
      existing_review_count: 1, // already assigned
      existing_reviewer_id: "rev1"
    },
    {
      id: "app3",
      full_name: "App 3",
      email_primary: "app3@test.com",
      status: "ready_for_screening",
      role_applied: "mentor",
      intake_batch_id: "batch1",
      submitted_at: "2026-01-03T00:00:00Z",
      existing_review_count: 0
    }
  ];

  const defaultProps = {
    applications: mockApplications,
    reviewers: mockReviewers,
    intakeBatchId: "batch1",
    roleApplied: "mentor",
    reviewRound: "profile_screening" as const,
    intakeBatches: [] as IntakeBatch[],
    seasons: [] as Season[],
    adminUserId: "admin1"
  };

  it("MANUAL_ONE_ASSIGNEE_ONLY: renders exactly one assignee select and disables submit until selected", () => {
    render(<AssignBulkForm {...defaultProps} />);
    
    // Select should be present
    const select = screen.getByRole("combobox");
    expect(select).toBeDefined();
    expect(select.getAttribute("name")).toBe("reviewer_id");

    // The submit button is disabled initially because no applications and no reviewer are selected
    const submitButton = screen.getByRole("button", { name: /Xác nhận giao hồ sơ/i });
    expect(submitButton).toHaveProperty("disabled", true);
  });

  it("EXPLICIT_APPLICATION_SELECTION: allows selecting applications via checkbox and updates count", () => {
    render(<AssignBulkForm {...defaultProps} />);
    
    // Find checkboxes for app1 and app3 (unassigned)
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(checkboxes.length).toBe(3); // app1, app2, app3
    
    // Check app1
    fireEvent.click(checkboxes[0]);
    expect(checkboxes[0].checked).toBe(true);

    // Verify count in the submit text
    expect(screen.getByText(/Bạn sắp giao/).textContent).toContain("1");

    // Check app3
    fireEvent.click(checkboxes[2]);
    expect(screen.getByText(/Bạn sắp giao/).textContent).toContain("2");
  });

  it("ALREADY_ASSIGNED_DISABLED: disables already assigned rows", () => {
    render(<AssignBulkForm {...defaultProps} />);
    
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    // app2 is already assigned
    expect(checkboxes[1].disabled).toBe(true);
    expect(checkboxes[0].disabled).toBe(false);
    expect(checkboxes[2].disabled).toBe(false);

    // It should display "Đã phân công" or the reviewer's name
    expect(screen.getAllByText(/Reviewer 1/).length).toBeGreaterThan(0);
  });

  it("SELECT_ALL_VISIBLE: selects all unassigned applications", () => {
    render(<AssignBulkForm {...defaultProps} />);
    
    const selectAllBtn = screen.getByRole("button", { name: "Chọn tất cả đang hiển thị" });
    fireEvent.click(selectAllBtn);
    
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(false); // disabled
    expect(checkboxes[2].checked).toBe(true);

    expect(screen.getByText(/Bạn sắp giao/).textContent).toContain("2");
  });

  it("INTERVIEW_EMPTY_STATE: shows link to reviewer pool if no interviewers", () => {
    render(<AssignBulkForm {...defaultProps} reviewers={[]} reviewRound="interview" />);
    
    expect(screen.getByText("Chưa có Interviewer cho mùa này.")).toBeDefined();
    expect(screen.getByText("Vào Danh sách Reviewer để cấp quyền.")).toBeDefined();
  });
});
