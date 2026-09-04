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

  /**
   * Every application id the browser would actually POST.
   *
   * This must serialise the real <form> rather than count inputs in the DOM:
   * an UNCHECKED checkbox and an UNMOUNTED input are both present-or-absent in
   * ways that only FormData resolves correctly. Counting `input[name=...]`
   * nodes would report ids that are never submitted.
   */
  const submittedIds = (container: HTMLElement) => {
    const form = container.querySelector("form");
    if (!form) throw new Error("form not found");
    return (new FormData(form).getAll("application_ids") as string[]).map(String).sort();
  };

  it("ONLY_SELECTED_IDS_ARE_SUBMITTED: unselected applications are not in the payload", () => {
    const { container } = render(<AssignBulkForm {...defaultProps} />);

    expect(submittedIds(container)).toEqual([]);

    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    fireEvent.click(checkboxes[0]); // app1 only

    expect(submittedIds(container)).toEqual(["app1"]);
    // app3 was never selected and must not mutate.
    expect(submittedIds(container)).not.toContain("app3");
    // app2 is already assigned and must never be submitted.
    expect(submittedIds(container)).not.toContain("app2");
  });

  it("SELECTION_SURVIVES_SEARCH_FILTER: filtering the list does not silently drop selected ids", () => {
    const { container } = render(<AssignBulkForm {...defaultProps} />);

    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    fireEvent.click(checkboxes[0]); // app1
    fireEvent.click(checkboxes[2]); // app3
    expect(submittedIds(container)).toEqual(["app1", "app3"]);

    // Narrow the visible list to App 1 only. App 3 is unmounted from the table,
    // but the operator selected it and it must still be assigned.
    fireEvent.change(screen.getByPlaceholderText("Tìm tên, email..."), {
      target: { value: "App 1" }
    });

    expect(screen.queryByText("App 3")).toBeNull();
    expect(submittedIds(container)).toEqual(["app1", "app3"]);
    // The confirmation count must equal what is actually submitted.
    expect(screen.getByText(/Bạn sắp giao/).textContent).toContain("2");
  });

  it("ALREADY_ASSIGNED_NEVER_SUBMITTED: select-all skips assigned rows", () => {
    const { container } = render(<AssignBulkForm {...defaultProps} />);

    fireEvent.click(screen.getByRole("button", { name: "Chọn tất cả đang hiển thị" }));

    expect(submittedIds(container)).toEqual(["app1", "app3"]);
    expect(submittedIds(container)).not.toContain("app2");
  });

  it("SELECT_ALL_IS_ADDITIVE_ACROSS_FILTERS: selections accumulate rather than reset", () => {
    const { container } = render(<AssignBulkForm {...defaultProps} />);
    const search = screen.getByPlaceholderText("Tìm tên, email...");

    fireEvent.change(search, { target: { value: "App 1" } });
    fireEvent.click(screen.getByRole("button", { name: "Chọn tất cả đang hiển thị" }));
    expect(submittedIds(container)).toEqual(["app1"]);

    fireEvent.change(search, { target: { value: "App 3" } });
    fireEvent.click(screen.getByRole("button", { name: "Chọn tất cả đang hiển thị" }));
    expect(submittedIds(container)).toEqual(["app1", "app3"]);
  });

  it("SINGLE_ASSIGNEE_CONTRACT: exactly one reviewer_id field is submitted, no distribution controls", () => {
    const { container } = render(<AssignBulkForm {...defaultProps} />);

    const reviewerFields = container.querySelectorAll('[name="reviewer_id"]');
    expect(reviewerFields).toHaveLength(1);
    expect((reviewerFields[0] as HTMLSelectElement).multiple).toBe(false);

    // No round-robin / workload / auto-distribution affordance exists.
    expect(container.querySelectorAll('[name="reviewer_ids"]')).toHaveLength(0);
    expect(container.querySelectorAll('[name="exclude_already_assigned"]')).toHaveLength(0);
    expect(screen.queryByText(/chia đều|round.?robin|tự động/i)).toBeNull();
  });

  it("ROUND_IS_CARRIED_EXPLICITLY: interview round posts review_round=interview", () => {
    const { container } = render(
      <AssignBulkForm
        {...defaultProps}
        reviewRound="interview"
        applications={[
          {
            id: "iapp1",
            full_name: "Interview 1",
            email_primary: "i1@test.com",
            status: "invited_to_interview",
            role_applied: "mentor",
            intake_batch_id: "batch1",
            submitted_at: "2026-01-01T00:00:00Z",
            existing_review_count: 0
          },
          {
            id: "papp1",
            full_name: "Profile 1",
            email_primary: "p1@test.com",
            status: "submitted",
            role_applied: "mentor",
            intake_batch_id: "batch1",
            submitted_at: "2026-01-01T00:00:00Z",
            existing_review_count: 0
          }
        ]}
      />
    );

    const round = container.querySelector('input[name="review_round"]') as HTMLInputElement;
    expect(round.value).toBe("interview");

    // A profile-round application is not offered on the interview screen.
    expect(screen.queryByText("Profile 1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Chọn tất cả đang hiển thị" }));
    expect(submittedIds(container)).toEqual(["iapp1"]);
  });

  it("INTERVIEW_EMPTY_STATE: shows link to reviewer pool if no interviewers", () => {
    render(<AssignBulkForm {...defaultProps} reviewers={[]} reviewRound="interview" />);
    
    // Vocabulary is the Vietnamese one the Owner asked for; the empty-state
    // contract (a statement plus a route to fix it) is unchanged.
    expect(screen.getByText("Chưa có Người phỏng vấn cho mùa này.")).toBeDefined();
    const link = screen.getByText("Mở Danh sách nhân sự tuyển sinh để cấp quyền.");
    expect(link.closest("a")?.getAttribute("href")).toBe("/reviews/reviewer-pool");
  });
});
