/** @vitest-environment jsdom */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AssignBulkForm } from "@/app/reviews/assign-bulk/assign-bulk-form";
import type { ReviewAssignableApplication, ReviewEligibleReviewer, IntakeBatch, Season } from "@/lib/types";
import { toVietnamDateInput, toVietnamInputValue } from "@/lib/event-datetime";

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

  /**
   * The list opens on "Chưa giao" — the work that still needs doing. A case
   * that needs to see an already-assigned row has to say so, which is the
   * point of the tabs.
   */
  const showAllRows = () => fireEvent.click(screen.getByTestId("pool-tab-all"));

  /** One page is one lot, so "select all" is scoped to the page. */
  const selectPageButton = () => screen.getByRole("button", { name: /Chọn cả trang/ });

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
    
    // The default tab hides assigned work; this case counts every row, so it
    // asks for all of them.
    showAllRows();
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

  it("ASSIGNED_ROWS_ARE_SELECTABLE_BUT_NEVER_RE_ASSIGNED: handing back needs a tick", () => {
    // These rows used to be disabled, which made handing an application back
    // impossible from the one screen an admin opens for this job. They are
    // selectable now — the protection is that eligibility is re-derived from
    // the data, so a ticked assigned row cannot enter the assign payload.
    const { container } = render(<AssignBulkForm {...defaultProps} />);
    showAllRows();

    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(checkboxes[1].disabled).toBe(false);

    fireEvent.click(checkboxes[1]); // app2, already assigned to Reviewer 1
    expect(checkboxes[1].checked).toBe(true);
    expect(submittedIds(container)).not.toContain("app2");

    // The current assignee is named, so the operator knows whose work they are
    // taking back.
    expect(screen.getAllByText(/Reviewer 1/).length).toBeGreaterThan(0);
  });

  it("HAND_BACK_PAYLOAD: an assigned row submits its review id to the cancel form", () => {
    const { container } = render(
      <AssignBulkForm
        {...defaultProps}
        applications={mockApplications.map((a) =>
          a.id === "app2" ? { ...a, existing_review_id: "review-of-app2" } : a
        )}
      />
    );
    showAllRows();

    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    fireEvent.click(checkboxes[1]);

    const forms = container.querySelectorAll("form");
    const cancelForm = forms[forms.length - 1];
    const ids = new FormData(cancelForm).getAll("review_id").map(String);
    expect(ids).toEqual(["review-of-app2"]);
  });

  it("SELECT_PAGE_IS_ONE_LOT: select-all takes the page, not the whole intake", () => {
    render(<AssignBulkForm {...defaultProps} />);
    
    const selectAllBtn = selectPageButton();
    fireEvent.click(selectAllBtn);
    
    // Default tab lists exactly the unassigned pair, which is the lot.
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes.every((box) => box.checked)).toBe(true);

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
    // The default tab lists exactly the unassigned pair, app1 and app3.
    fireEvent.click(checkboxes[0]); // app1
    fireEvent.click(checkboxes[1]); // app3
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

    fireEvent.click(selectPageButton());

    expect(submittedIds(container)).toEqual(["app1", "app3"]);
    expect(submittedIds(container)).not.toContain("app2");
  });

  it("SELECT_ALL_IS_ADDITIVE_ACROSS_FILTERS: selections accumulate rather than reset", () => {
    const { container } = render(<AssignBulkForm {...defaultProps} />);
    const search = screen.getByPlaceholderText("Tìm tên, email...");

    fireEvent.change(search, { target: { value: "App 1" } });
    fireEvent.click(selectPageButton());
    expect(submittedIds(container)).toEqual(["app1"]);

    fireEvent.change(search, { target: { value: "App 3" } });
    fireEvent.click(selectPageButton());
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
    fireEvent.click(selectPageButton());
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

describe("Hạn hoàn tất khi giao hồ sơ", () => {
  afterEach(() => {
    cleanup();
  });

  const reviewers: ReviewEligibleReviewer[] = [
    { id: "rev1", email: "rev1@example.com", full_name: "Reviewer 1", role: "reviewer", current_workload: 0 }
  ];

  const applications: ReviewAssignableApplication[] = [
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
      status: "screening_assigned",
      role_applied: "mentor",
      intake_batch_id: "batch1",
      submitted_at: "2026-01-02T00:00:00Z",
      existing_review_count: 1,
      existing_reviewer_id: "rev1",
      existing_review_id: "review-of-app2",
      existing_due_at: "2026-09-20T16:59:59.000Z"
    }
  ];

  const props = {
    applications,
    reviewers,
    intakeBatchId: "batch1",
    roleApplied: "mentor",
    reviewRound: "profile_screening" as const,
    intakeBatches: [] as IntakeBatch[],
    seasons: [] as Season[],
    adminUserId: "admin1"
  };

  /** A day N days from now: as the operator types it, and as the form posts it. */
  function dayFromNow(days: number) {
    const posted = toVietnamInputValue(new Date(Date.now() + days * 86_400_000).toISOString()).slice(0, 10);
    return { typed: toVietnamDateInput(posted), posted };
  }

  const dueInput = (label = "Hạn hoàn tất chấm") => screen.getByLabelText(`${label} — dạng ngày/tháng/năm`);
  const assignForm = (container: HTMLElement) => container.querySelectorAll("form")[0] as HTMLFormElement;
  const submitButton = () => screen.getByRole("button", { name: /Xác nhận giao hồ sơ/ }) as HTMLButtonElement;
  const summary = () => screen.getByText(/Bạn sắp giao/).textContent ?? "";

  /** Reviewer chosen and one unassigned application ticked. */
  function readyToAssign() {
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "rev1" } });
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
  }

  it("DUE_FIELD_BELONGS_TO_THE_ASSIGN_FORM: posted with an assignment, never with a hand-back", () => {
    const { container } = render(<AssignBulkForm {...props} />);
    const forms = container.querySelectorAll("form");

    expect(new FormData(forms[0]).has("due_at")).toBe(true);
    expect(new FormData(forms[forms.length - 1]).has("due_at")).toBe(false);
  });

  it("DUE_DATE_IS_POSTED_AS_A_DATE_AND_ANNOUNCED", () => {
    const { container } = render(<AssignBulkForm {...props} />);
    readyToAssign();
    const day = dayFromNow(9);
    fireEvent.change(dueInput(), { target: { value: day.typed } });

    expect(new FormData(assignForm(container)).get("due_at")).toBe(day.posted);
    expect(summary()).toContain(`hạn hoàn tất hết ngày ${day.typed}`);
    expect(submitButton().disabled).toBe(false);
  });

  it("NO_DUE_IS_SAID_OUT_LOUD: leaving it empty is visible before confirming", () => {
    render(<AssignBulkForm {...props} />);
    readyToAssign();

    expect(summary()).toContain("chưa đặt hạn hoàn tất");
    expect(submitButton().disabled).toBe(false);
  });

  it("HALF_TYPED_DUE_BLOCKS_ASSIGNING: otherwise the lot goes out with no deadline", () => {
    const { container } = render(<AssignBulkForm {...props} />);
    readyToAssign();
    fireEvent.change(dueInput(), { target: { value: "20/09/20" } });

    // What the browser would send is empty — the silent loss being blocked.
    expect(new FormData(assignForm(container)).get("due_at")).toBe("");
    expect(submitButton().disabled).toBe(true);
    expect(screen.getByText(/Gõ đủ ngày\/tháng\/năm/)).toBeDefined();
    expect(summary()).not.toContain("chưa đặt hạn");
  });

  it("PAST_DUE_BLOCKS_ASSIGNING", () => {
    render(<AssignBulkForm {...props} />);
    readyToAssign();
    fireEvent.change(dueInput(), { target: { value: dayFromNow(-2).typed } });

    expect(submitButton().disabled).toBe(true);
    expect(screen.getByText(/đã qua/)).toBeDefined();
  });

  it("INTERVIEW_ROUND_NAMES_ITS_OWN_DEADLINE", () => {
    render(<AssignBulkForm {...props} reviewRound="interview" applications={[]} />);
    expect(dueInput("Hạn hoàn tất phỏng vấn")).toBeDefined();
  });

  it("ASSIGNED_ROW_SHOWS_ITS_DEADLINE", () => {
    render(<AssignBulkForm {...props} />);
    fireEvent.click(screen.getByTestId("pool-tab-assigned"));

    expect(screen.getByText("Hạn 20/09/2026")).toBeDefined();
  });
});
