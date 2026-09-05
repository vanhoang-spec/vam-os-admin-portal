/**
 * @vitest-environment jsdom
 *
 * S12 review-gate UX remediation.
 *
 * The database gate (`vam084_application_decision_eligibility`) is the
 * authority and is NOT relaxed by this work. These tests pin the operator-facing
 * behaviour: a blocked lifecycle option stays visible but disabled and labelled,
 * and the guidance block explains the real assignment situation instead of a
 * bare "chưa có review".
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/actions/application-decisions", () => ({
  updateApplicationDecisionAction: vi.fn()
}));

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

import { DecisionForm, BLOCKED_OPTION_SUFFIX } from "@/app/applications/[id]/decision-form";
import {
  ASSIGNMENT_STATE_LABEL,
  buildReviewGateState,
  type ReviewGateReviewInput,
  type ReviewGateState
} from "@/lib/review-gate-ux";

// `restoreMocks` in vitest.config.ts wipes implementations between tests, so
// these are re-armed per test rather than once at module scope.
beforeEach(() => {
  mockUseFormState.mockReturnValue([{ ok: false, message: "" }, vi.fn()]);
  mockUseFormStatus.mockReturnValue({ pending: false });
});

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Fixtures — modelled on production application 231ac88a Trần Anh Thi:
// ready_for_screening, one profile_screening review, reviewer assigned,
// review cancelled, submitted_at null.
// ---------------------------------------------------------------------------

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

const REVIEWER_NAMES = new Map([
  [ACTOR_ID, "Core Team Admin"],
  [OTHER_ID, "Nguyễn Hà Như Liễu"]
]);

function review(over: Partial<ReviewGateReviewInput> = {}): ReviewGateReviewInput {
  return {
    id: "review-1",
    review_round: "profile_screening",
    status: "assigned",
    reviewer_admin_user_id: OTHER_ID,
    ...over
  };
}

function gate(
  stage: "profile" | "interview",
  reviews: ReviewGateReviewInput[],
  actorAdminUserId: string | null = ACTOR_ID
): ReviewGateState {
  return buildReviewGateState({
    stage,
    reviews,
    requiredCount: 1,
    actorAdminUserId,
    reviewerNameById: REVIEWER_NAMES
  });
}

const EMPTY_INTERVIEW_GATE = gate("interview", []);

function renderForm(over: Partial<React.ComponentProps<typeof DecisionForm>> = {}) {
  return render(
    <DecisionForm
      applicationId="231ac88a-c21b-4fa1-a041-d9ba67c0cee7"
      currentStatus="ready_for_screening"
      profileGate={gate("profile", [])}
      interviewGate={EMPTY_INTERVIEW_GATE}
      canAssignReview
      {...over}
    />
  );
}

function decisionOption(value: string): HTMLOptionElement {
  const select = screen.getByRole("combobox") as HTMLSelectElement;
  const option = Array.from(select.options).find((o) => o.value === value);
  if (!option) throw new Error(`option ${value} not rendered`);
  return option;
}

// ---------------------------------------------------------------------------
// 6 / 7 / 8 — what counts as a submitted review
// ---------------------------------------------------------------------------

describe("review gate counting mirrors the database", () => {
  it("does not count a cancelled review", () => {
    const state = gate("profile", [review({ status: "cancelled" })]);
    expect(state.submittedCount).toBe(0);
    expect(state.met).toBe(false);
    // A cancelled row is reported as such, never as "chưa giao".
    expect(state.assignmentState).toBe("cancelled");
    expect(state.activeReview).toBeNull();
  });

  it("does not count an autosaved / in_progress review", () => {
    const state = gate("profile", [review({ status: "in_progress" })]);
    expect(state.submittedCount).toBe(0);
    expect(state.met).toBe(false);
    expect(state.assignmentState).toBe("in_progress");
  });

  it("does not count an assigned-but-untouched review", () => {
    const state = gate("profile", [review({ status: "assigned" })]);
    expect(state.submittedCount).toBe(0);
    expect(state.assignmentState).toBe("assigned");
  });

  it("counts a submitted review and reports it as đã nộp", () => {
    const state = gate("profile", [review({ status: "submitted" })]);
    expect(state.submittedCount).toBe(1);
    expect(state.met).toBe(true);
    expect(state.assignmentState).toBe("submitted");
    expect(state.cta).toBe("none");
  });

  it("counts distinct reviewers, matching count(distinct reviewer_admin_user_id)", () => {
    const state = buildReviewGateState({
      stage: "profile",
      reviews: [
        review({ id: "a", status: "submitted", reviewer_admin_user_id: OTHER_ID }),
        review({ id: "b", status: "submitted", reviewer_admin_user_id: OTHER_ID })
      ],
      requiredCount: 2,
      actorAdminUserId: ACTOR_ID,
      reviewerNameById: REVIEWER_NAMES
    });
    expect(state.submittedCount).toBe(1);
    expect(state.met).toBe(false);
  });

  it("ignores reviews belonging to the other stage", () => {
    const state = gate("profile", [
      review({ id: "i", review_round: "interview", status: "submitted" })
    ]);
    expect(state.submittedCount).toBe(0);
    expect(state.assignmentState).toBe("unassigned");
  });

  it("distinguishes every assignment state the operator needs", () => {
    expect(gate("profile", []).assignmentState).toBe("unassigned");
    expect(ASSIGNMENT_STATE_LABEL.unassigned).toBe("Chưa giao");
    expect(ASSIGNMENT_STATE_LABEL.assigned).toBe("Đã giao");
    expect(ASSIGNMENT_STATE_LABEL.in_progress).toBe("Đang thực hiện");
    expect(ASSIGNMENT_STATE_LABEL.cancelled).toBe("Đã hủy");
    expect(ASSIGNMENT_STATE_LABEL.submitted).toBe("Đã nộp");
  });
});

// ---------------------------------------------------------------------------
// 1 / 2 / 9 — blocked option stays visible, disabled and labelled
// ---------------------------------------------------------------------------

describe("blocked decision options", () => {
  it("blocks the screening decision when no profile review has been submitted", () => {
    renderForm({ profileGate: gate("profile", [review({ status: "cancelled" })]) });
    expect(decisionOption("screening_passed").disabled).toBe(true);
    expect(decisionOption("invited_to_interview").disabled).toBe(true);
  });

  it("keeps the blocked option visible with wording that explains the block", () => {
    renderForm({ profileGate: gate("profile", [review({ status: "cancelled" })]) });
    const option = decisionOption("screening_passed");
    expect(option).toBeTruthy();
    expect(option.textContent).toContain("Qua vòng hồ sơ");
    expect(option.textContent).toContain("chưa đủ review");
    expect(option.textContent?.endsWith(BLOCKED_OPTION_SUFFIX)).toBe(true);
  });

  it("leaves ungated options selectable", () => {
    renderForm({ profileGate: gate("profile", []) });
    expect(decisionOption("under_data_check").disabled).toBe(false);
    expect(decisionOption("withdrawn").disabled).toBe(false);
  });

  it("enables the screening decision once the minimum is met", () => {
    renderForm({ profileGate: gate("profile", [review({ status: "submitted" })]) });
    const option = decisionOption("screening_passed");
    expect(option.disabled).toBe(false);
    expect(option.textContent).not.toContain("chưa đủ review");
    expect(screen.queryByTestId("review-gate-profile")).toBeNull();
  });

  it("blocks the interview decision until an interview review is submitted", () => {
    renderForm({
      currentStatus: "ready_for_final_decision",
      profileGate: gate("profile", [review({ status: "submitted" })]),
      interviewGate: gate("interview", [
        review({ id: "iv", review_round: "interview", status: "in_progress" })
      ])
    });
    expect(decisionOption("interview_passed").disabled).toBe(true);

    cleanup();

    renderForm({
      currentStatus: "ready_for_final_decision",
      profileGate: gate("profile", [review({ status: "submitted" })]),
      interviewGate: gate("interview", [
        review({ id: "iv", review_round: "interview", status: "submitted" })
      ])
    });
    expect(decisionOption("interview_passed").disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Guidance block content
// ---------------------------------------------------------------------------

describe("guidance block", () => {
  it("states the shortfall with submitted/required counts, not just 'không có review'", () => {
    renderForm({ profileGate: gate("profile", [review({ status: "cancelled" })]) });
    const block = screen.getByTestId("review-gate-profile");
    expect(block.textContent).toContain("Chưa đủ đánh giá hồ sơ để ra quyết định.");
    expect(block.textContent).toContain("0/1");
  });

  it("reports a cancelled review as đã hủy rather than as no review at all", () => {
    renderForm({ profileGate: gate("profile", [review({ status: "cancelled" })]) });
    const block = screen.getByTestId("review-gate-profile");
    expect(block.textContent).toContain("Đã hủy");
  });

  it("names the reviewer and status of an existing assignment", () => {
    renderForm({ profileGate: gate("profile", [review({ status: "in_progress" })]) });
    const block = screen.getByTestId("review-gate-profile");
    expect(block.textContent).toContain("Nguyễn Hà Như Liễu");
    expect(block.textContent).toContain("Đang thực hiện");
  });

  it("disappears once the minimum is met", () => {
    renderForm({ profileGate: gate("profile", [review({ status: "submitted" })]) });
    expect(screen.queryByTestId("review-gate-profile")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3 / 4 / 5 — CTAs
// ---------------------------------------------------------------------------

describe("call to action", () => {
  it("offers 'Giao review hồ sơ' when no active review exists", () => {
    const state = gate("profile", [review({ status: "cancelled" })]);
    expect(state.cta).toBe("assign");

    renderForm({ profileGate: state });
    const block = screen.getByTestId("review-gate-profile");
    const cta = within(block).getByText(/Giao review hồ sơ/);
    expect(cta.closest("a")?.getAttribute("href")).toBe("#assign-review-card");
  });

  it("offers 'Giao review hồ sơ' when the stage was never assigned", () => {
    renderForm({ profileGate: gate("profile", []) });
    const block = screen.getByTestId("review-gate-profile");
    expect(block.textContent).toContain("Chưa giao");
    expect(within(block).getByText(/Giao review hồ sơ/)).toBeTruthy();
  });

  it("does not link to the assignment surface when the actor cannot assign", () => {
    renderForm({ profileGate: gate("profile", []), canAssignReview: false });
    const block = screen.getByTestId("review-gate-profile");
    expect(within(block).queryByRole("link")).toBeNull();
    expect(block.textContent).toContain("Giao review hồ sơ");
  });

  it("offers 'Mở đánh giá của tôi' pointing at the actor's own open review", () => {
    const state = gate("profile", [
      review({ id: "mine", status: "in_progress", reviewer_admin_user_id: ACTOR_ID })
    ]);
    expect(state.cta).toBe("open_mine");
    expect(state.myOpenReviewId).toBe("mine");
    expect(state.otherReviewerName).toBeNull();

    renderForm({ profileGate: state });
    const block = screen.getByTestId("review-gate-profile");
    const link = within(block).getByText(/Mở đánh giá của tôi/).closest("a");
    expect(link?.getAttribute("href")).toBe("/reviews/mine");
    expect(within(block).queryByText(/Giao review hồ sơ/)).toBeNull();
  });

  it("shows another reviewer's name without exposing edit-as-other access", () => {
    const state = gate("profile", [
      review({ id: "theirs", status: "in_progress", reviewer_admin_user_id: OTHER_ID })
    ]);
    expect(state.cta).toBe("await_other");
    expect(state.myOpenReviewId).toBeNull();
    expect(state.otherReviewerName).toBe("Nguyễn Hà Như Liễu");

    renderForm({ profileGate: state });
    const block = screen.getByTestId("review-gate-profile");
    expect(block.textContent).toContain("Nguyễn Hà Như Liễu");
    expect(within(block).queryByText(/Mở đánh giá của tôi/)).toBeNull();
    // No link into the other reviewer's review from the guidance block.
    const hrefs = within(block)
      .queryAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).not.toContain("/reviews/theirs");
    // Reassignment stays on the existing authorized assignment surface.
    expect(hrefs).toContain("#assign-review-card");
  });

  it("hides the reassignment link from an actor without assignment rights", () => {
    const state = gate("profile", [
      review({ id: "theirs", status: "assigned", reviewer_admin_user_id: OTHER_ID })
    ]);
    renderForm({ profileGate: state, canAssignReview: false });
    const block = screen.getByTestId("review-gate-profile");
    expect(within(block).queryAllByRole("link")).toHaveLength(0);
    expect(block.textContent).toContain("Nguyễn Hà Như Liễu");
  });
});

// ---------------------------------------------------------------------------
// 5 — interview handoff
// ---------------------------------------------------------------------------

describe("interview handoff", () => {
  it("points at 'Mời phỏng vấn' once screening has passed", () => {
    renderForm({
      currentStatus: "screening_passed",
      profileGate: gate("profile", [review({ status: "submitted" })])
    });
    const handoff = screen.getByTestId("interview-handoff");
    expect(handoff.textContent).toContain("Mời phỏng vấn");
    // No interview-review nag at this step — the next action is the invitation.
    expect(screen.queryByTestId("review-gate-interview")).toBeNull();
    expect(decisionOption("invited_to_interview").disabled).toBe(false);
  });

  it("is absent while the application is still in profile screening", () => {
    renderForm({ currentStatus: "ready_for_screening" });
    expect(screen.queryByTestId("interview-handoff")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 11 — legacy grandfathered records
// ---------------------------------------------------------------------------

describe("legacy invited_to_interview records", () => {
  const legacyProps = {
    currentStatus: "invited_to_interview",
    // 31 UEHM-S12 mentor applications sit here with zero submitted profile reviews.
    profileGate: gate("profile", []),
    interviewGate: gate("interview", [])
  };

  it("does not push a legacy record back into profile screening", () => {
    renderForm(legacyProps);
    expect(screen.queryByTestId("review-gate-profile")).toBeNull();
    expect(screen.queryByTestId("interview-handoff")).toBeNull();
  });

  it("shows forward-looking interview guidance instead", () => {
    renderForm(legacyProps);
    const block = screen.getByTestId("review-gate-interview");
    expect(block.textContent).toContain("Chưa đủ đánh giá phỏng vấn để ra quyết định.");
    expect(within(block).getByText(/Giao review phỏng vấn/)).toBeTruthy();
  });

  it("keeps the interview assignment path open for a legacy record", () => {
    renderForm(legacyProps);
    // Nothing here proposes a backwards decision; the enabled next steps are
    // the interview-side ones plus the always-available operational statuses.
    expect(decisionOption("interview_scheduled").disabled).toBe(false);
    expect(decisionOption("withdrawn").disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 10 — the server / database gate is untouched
// ---------------------------------------------------------------------------

describe("server and database gate unchanged", () => {
  const RPC_SQL = join(
    process.cwd(),
    "supabase/migrations/20260903180000_p0_restore_recruitment_review_rpcs.sql"
  );

  it("still refuses screening_passed below the profile minimum", () => {
    const sql = readFileSync(RPC_SQL, "utf-8");
    expect(sql).toContain("v_profile_submitted >= v_profile_required");
    expect(sql).toContain("'profile_review_minimum_not_met'");
    expect(sql).toContain("v_interview_submitted >= v_interview_required");
    expect(sql).toContain("'interview_review_minimum_not_met'");
    expect(sql).toContain("'stage_requirement_missing'");
    // Only submitted rows are counted, and per distinct reviewer.
    expect(sql).toContain("count(distinct ar.reviewer_admin_user_id)");
    expect(sql).toContain("ar.status = 'submitted'");
  });

  it("still routes every decision write through the atomic RPC", () => {
    const source = readFileSync(join(process.cwd(), "lib/application-decisions.ts"), "utf-8");
    expect(source).toContain("vam084_apply_application_decisions");
    expect(source).toContain("profile_review_minimum_not_met");
    expect(source).toContain("interview_review_minimum_not_met");
  });

  it("adds no client-side bypass of the gate", () => {
    const form = readFileSync(
      join(process.cwd(), "app/applications/[id]/decision-form.tsx"),
      "utf-8"
    );
    // The form still posts to the same server action and nothing else.
    expect(form).toContain("updateApplicationDecisionAction");
    expect(form).not.toMatch(/supabase|service_role|rpc\(/i);
    // The gate mirror is read-only: no write helper is imported here.
    expect(form).not.toContain("recordApplicationDecision");
  });

  it("keeps the gate mirror free of any write path", () => {
    const lib = readFileSync(join(process.cwd(), "lib/review-gate-ux.ts"), "utf-8");
    expect(lib).not.toMatch(/insert|update|upsert|delete|rpc\(/i);
  });
});
