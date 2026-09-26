/**
 * @vitest-environment jsdom
 *
 * S12 throughput — profile review → ONE Core Team decision → interview invite.
 *
 * The operational claim: Core Team records one decision where it used to record
 * two. The safety claim: the review gate is not weakened by a single character.
 *
 * Behaviour against a REAL PostgreSQL server lives in scripts/pg-harness — the
 * assertions here are about the TypeScript model and the operator surface.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/application-decisions", () => ({
  // Cổng chia mentor/mentee: vai trò trong các ca này quyết được mọi hồ sơ.
  refuseApplicationsBeyondDecisionRole: vi.fn(async () => ({ ok: true })),
  applyApplicationDecisions: vi.fn(),
  recordApplicationDecision: vi.fn(),
  getApplicationDecisionEligibility: vi.fn()
}));
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

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { applyApplicationDecisions } from "@/lib/application-decisions";
import { bulkInviteInterviewAction } from "@/app/actions/bulk-invite-interview";
import { ScreeningDecisionPanel } from "@/app/applications/[id]/screening-decision-panel";
import { BulkInviteForm } from "@/app/applications/bulk-invite-interview/bulk-invite-form";
import {
  BULK_INVITE_MAX,
  BULK_INVITE_TARGET_STATUS,
  isBulkInviteCandidate
} from "@/lib/bulk-invite-interview";
import { evaluateDirectInterviewInvite } from "@/lib/direct-interview-eligibility";
import {
  SCREENING_DECISION_CHOICES,
  buildScreeningDecisionState,
  isScreeningChoiceBlocked,
  type ScreeningReviewInput
} from "@/lib/screening-decision";
import { classifyOperational, deriveDecisions } from "@/lib/recruitment-export";

const ACTOR = "aaaaaaaa-0000-4000-8000-00000000000a";
const OTHER = "bbbbbbbb-0000-4000-8000-00000000000b";
const APP_ID = "cccccccc-0000-4000-8000-00000000000c";

const NAMES = new Map([
  [ACTOR, "Core Team Ops"],
  [OTHER, "Nguyễn Hà Như Liễu"]
]);

const ALLOW = { eligible: true, reason: "eligible" as const };
const DENY_MIN = { eligible: false, reason: "profile_review_minimum_not_met" as const };

/** Every decision allowed — the "reviews are in" case. */
const ALL_ALLOWED = {
  invited_to_interview: ALLOW,
  needs_more_review: ALLOW,
  rejected_or_not_fit: ALLOW
};
/** Every decision refused for want of reviews — the true server behaviour. */
const ALL_DENIED = {
  invited_to_interview: DENY_MIN,
  needs_more_review: DENY_MIN,
  rejected_or_not_fit: DENY_MIN
};

function review(over: Partial<ScreeningReviewInput> = {}): ScreeningReviewInput {
  return {
    id: "rev-1",
    review_round: "profile_screening",
    status: "assigned",
    reviewer_admin_user_id: OTHER,
    total_score: null,
    score_motivation: null,
    score_goal_clarity: null,
    score_commitment: null,
    score_fit: null,
    score_communication: null,
    recommendation: null,
    reviewer_note: null,
    submitted_at: null,
    ...over
  };
}

function submitted(over: Partial<ScreeningReviewInput> = {}): ScreeningReviewInput {
  return review({
    id: "rev-submitted",
    status: "submitted",
    total_score: 21,
    score_motivation: 5,
    score_goal_clarity: 4,
    score_commitment: 4,
    score_fit: 4,
    score_communication: 4,
    recommendation: "pass_to_interview",
    reviewer_note: "Hồ sơ rõ ràng, nên gặp trực tiếp.",
    submitted_at: "2026-09-06T02:00:00Z",
    ...over
  });
}

function state(
  applicationStatus: string,
  reviews: ScreeningReviewInput[],
  eligibility: Record<string, { eligible: boolean; reason: any }> = ALL_DENIED,
  requiredCount: number | null = 1,
  actor: string | null = ACTOR
) {
  return buildScreeningDecisionState({
    applicationStatus,
    reviews,
    requiredCount,
    actorAdminUserId: actor,
    reviewerNameById: NAMES,
    eligibility
  });
}

function renderPanel(over: Partial<React.ComponentProps<typeof ScreeningDecisionPanel>> = {}) {
  return render(
    <ScreeningDecisionPanel
      applicationId={APP_ID}
      currentStatus="screening_completed"
      state={state("screening_completed", [])}
      canAssignReview
      {...over}
    />
  );
}

function option(value: string): HTMLOptionElement {
  const select = screen.getByTestId("screening-decision-select") as HTMLSelectElement;
  const found = Array.from(select.options).find((o) => o.value === value);
  if (!found) throw new Error(`option ${value} not rendered`);
  return found;
}

const MIGRATION_PATH = "supabase/migrations/20260906090000_s12_direct_interview_invite.sql";
const DEPLOYED_PATH = "supabase/migrations/20260903180000_p0_restore_recruitment_review_rpcs.sql";
const CARRIAGE_RETURN = String.fromCharCode(13);
const read = (p: string) =>
  readFileSync(join(process.cwd(), p), "utf8").split(CARRIAGE_RETURN).join("");

function eligibilityBody(sql: string): string {
  const start = sql.indexOf("CREATE OR REPLACE FUNCTION public.vam084_application_decision_eligibility");
  const end = sql.indexOf("$function$;", start);
  if (start < 0 || end < 0) throw new Error("eligibility function not found");
  return sql.slice(start, end);
}

function inviteBranch(sql: string): string {
  const body = eligibilityBody(sql);
  const start = body.indexOf("elsif p_new_status = 'invited_to_interview' then");
  const end = body.indexOf("elsif p_new_status = 'interview_scheduled' then", start);
  return body.slice(start, end);
}

beforeEach(() => {
  mockUseFormState.mockReturnValue([{ ok: false, message: "", appliedCount: 0, blockedCount: 0, rows: [] }, vi.fn()]);
  mockUseFormStatus.mockReturnValue({ pending: false });
});

afterEach(cleanup);

// ---------------------------------------------------------------------------
// 1–4 — what does NOT satisfy the gate
// ---------------------------------------------------------------------------

describe("the invite is blocked without a submitted review", () => {
  const cases: Array<[string, ScreeningReviewInput[], string]> = [
    ["zero reviews", [], "unassigned"],
    ["assigned-only", [review({ status: "assigned" })], "assigned"],
    ["in_progress", [review({ status: "in_progress" })], "in_progress"],
    ["cancelled", [review({ status: "cancelled" })], "cancelled"]
  ];

  for (const [name, reviews, expectedAssignment] of cases) {
    it(`blocks with ${name}, and names the assignment state`, () => {
      const s = state("screening_completed", reviews);
      expect(s.submittedCount).toBe(0);
      expect(s.assignmentState).toBe(expectedAssignment);
      expect(isScreeningChoiceBlocked("invited_to_interview", s)).toBe(true);
    });
  }

  it("counts DISTINCT reviewers, matching the RPC", () => {
    const s = state("screening_completed", [submitted({ id: "a" }), submitted({ id: "b" })]);
    expect(s.submittedCount).toBe(1);
  });

  it("renders the blocked invite visible but unselectable", () => {
    renderPanel({ state: state("screening_completed", [review({ status: "cancelled" })]) });
    const invite = option("invited_to_interview");
    expect(invite.disabled).toBe(true);
    expect(invite.textContent).toContain("Mời phỏng vấn");
    expect(invite.textContent).toContain("chưa đủ điều kiện");
  });
});

// ---------------------------------------------------------------------------
// 5–7 — one action, correct target
// ---------------------------------------------------------------------------

describe("one Core Team action closes the profile round", () => {
  it("enables the direct invite once the server says so", () => {
    const s = state("screening_completed", [submitted()], ALL_ALLOWED);
    renderPanel({ state: s });
    expect(option("invited_to_interview").disabled).toBe(false);
    expect(screen.queryByTestId("screening-gate")).toBeNull();
  });

  it("targets invited_to_interview directly", () => {
    expect(SCREENING_DECISION_CHOICES.find((c) => c.label === "Mời phỏng vấn")?.value).toBe(
      "invited_to_interview"
    );
  });

  it("offers exactly three decisions and no separate 'Qua vòng hồ sơ'", () => {
    renderPanel({ state: state("screening_completed", [submitted()], ALL_ALLOWED) });
    const select = screen.getByTestId("screening-decision-select") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value).filter(Boolean);
    expect(values).toEqual(["invited_to_interview", "needs_more_review", "rejected_or_not_fit"]);
    expect(select.textContent).not.toContain("Qua vòng hồ sơ");
  });

  it("removes 'Qua vòng hồ sơ' from the individual decision form entirely", () => {
    const source = read("app/applications/[id]/decision-form.tsx");
    const options = source.slice(
      source.indexOf("const DECISION_OPTIONS"),
      source.indexOf("];", source.indexOf("const DECISION_OPTIONS"))
    );
    expect(options).not.toContain('value: "screening_passed"');
    expect(options).toContain('value: "invited_to_interview"');
  });
});

// ---------------------------------------------------------------------------
// 8–11 — the database remains the arbiter
// ---------------------------------------------------------------------------

describe("the database remains the arbiter", () => {
  it("still requires the profile minimum for the direct invite", () => {
    const branch = inviteBranch(read(MIGRATION_PATH));
    expect(branch).toContain("v_profile_submitted >= v_profile_required");
    expect(branch).toContain("'profile_review_minimum_not_met'");
  });

  it("counts only submitted reviews, and only distinct reviewers", () => {
    const body = eligibilityBody(read(MIGRATION_PATH));
    expect(body).toContain("count(distinct ar.reviewer_admin_user_id)");
    expect(body).toContain("ar.review_round = 'profile_screening' and ar.status = 'submitted'");
  });

  it("changes exactly one branch of the eligibility function and nothing else", () => {
    const split = (fn: string) => fn.split(/\n  (?:if|elsif) p_new_status/);
    const before = split(eligibilityBody(read(DEPLOYED_PATH)));
    const after = split(eligibilityBody(read(MIGRATION_PATH)));
    expect(after).toHaveLength(before.length);
    const differing = before
      .map((chunk, index) => (chunk === after[index] ? null : index))
      .filter((index): index is number => index !== null);
    expect(differing).toHaveLength(1);
    expect(after[differing[0]]).toContain("= 'invited_to_interview' then");
  });

  it("keeps the signature, stability, invoker rights and search_path", () => {
    const sql = read(MIGRATION_PATH);
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.vam084_application_decision_eligibility(p_application_id uuid, p_new_status text)"
    );
    expect(sql).toContain("RETURNS TABLE(eligible boolean, reason text)");
    expect(sql).toContain(" STABLE");
    expect(sql).toContain("SET search_path TO ''");
    expect(sql).toContain("revoke all on function public.vam084_application_decision_eligibility(uuid, text)");
    expect(sql).toContain("to service_role;");
  });

  it("refuses a bulk invite from an actor who cannot decide", async () => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "r1", role: "reviewer" } as never);
    const data = new FormData();
    data.append("application_id", APP_ID);
    const result = await bulkInviteInterviewAction(
      { ok: false, message: "", appliedCount: 0, blockedCount: 0, rows: [] },
      data
    );
    expect(result.ok).toBe(false);
    expect(applyApplicationDecisions).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 12–14 — provenance, rejection, legacy
// ---------------------------------------------------------------------------

describe("provenance, rejection and legacy records", () => {
  it("carries the needs_more_review profile provenance rule into the invite branch", () => {
    const branch = inviteBranch(read(MIGRATION_PATH));
    expect(branch).toContain("v_interview_submitted = 0");
    expect(branch).toContain("ar.review_round = 'profile_screening'");
    expect(branch).toContain("ar.submitted_at > v_latest_more_review_at");
    expect(branch).toContain("'additional_review_not_submitted'");
  });

  it("leaves the needs_more_review branch itself untouched", () => {
    const marker = "elsif p_new_status in ('waitlisted','rejected_or_not_fit','needs_more_review') then";
    const slice = (fn: string) => fn.slice(fn.indexOf(marker), fn.indexOf("elsif p_new_status = 'withdrawn'"));
    expect(slice(eligibilityBody(read(MIGRATION_PATH)))).toBe(
      slice(eligibilityBody(read(DEPLOYED_PATH)))
    );
  });

  it("keeps rejection on the existing canonical status, with no duplicate", () => {
    const values = SCREENING_DECISION_CHOICES.map((c) => c.value);
    expect(values.filter((v) => v.includes("reject"))).toEqual(["rejected_or_not_fit"]);
    expect(SCREENING_DECISION_CHOICES.find((c) => c.value === "rejected_or_not_fit")?.destructive).toBe(true);
  });

  it("shows no screening surface for a record already invited with zero reviews", () => {
    const legacy = state("invited_to_interview", []);
    expect(legacy.inProfileStage).toBe(false);
  });

  it("never proposes moving a record backwards", () => {
    const values = SCREENING_DECISION_CHOICES.map((c) => c.value);
    expect(values).not.toContain("screening_completed");
    expect(values).not.toContain("screening_passed");
  });
});

// ---------------------------------------------------------------------------
// 15–20 — bulk
// ---------------------------------------------------------------------------

describe("bulk invite", () => {
  const base = {
    submittedProfileReviewers: 1,
    requiredProfileReviews: 1,
    submittedInterviewReviewers: 0,
    latestNeedsMoreReviewAt: null,
    latestProfileSubmissionAt: "2026-09-01T00:00:00Z"
  };

  it("offers only what the individual command accepts", () => {
    for (const status of ["screening_completed", "needs_admin_review", "screening_passed"]) {
      expect(isBulkInviteCandidate({ ...base, status })).toBe(true);
    }
    for (const status of ["submitted", "ready_for_screening", "invited_to_interview", "withdrawn"]) {
      expect(isBulkInviteCandidate({ ...base, status })).toBe(false);
    }
  });

  it("withholds a row below the review minimum", () => {
    expect(isBulkInviteCandidate({ ...base, status: "screening_completed", submittedProfileReviewers: 0 })).toBe(false);
    expect(
      isBulkInviteCandidate({ ...base, status: "screening_completed", submittedProfileReviewers: 1, requiredProfileReviews: 2 })
    ).toBe(false);
  });

  it("sends every row's expected status so a stale row is blocked, not skipped", () => {
    const rows = [
      { id: "app-1", fullName: "A", role: "mentor", status: "screening_completed", statusLabel: "x", submittedReviews: 1, recommendationLabel: "Mời vào vòng phỏng vấn" },
      { id: "app-2", fullName: "B", role: "mentee", status: "needs_admin_review", statusLabel: "y", submittedReviews: 2, recommendationLabel: "Cần core team/admin xem thêm" }
    ];
    const { container } = render(<BulkInviteForm rows={rows} />);
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(container.querySelectorAll('input[name="application_id"]')).toHaveLength(0);
  });

  it("reports applied and blocked per applicant, from the server", async () => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: ACTOR, role: "core_team" } as never);
    vi.mocked(applyApplicationDecisions).mockResolvedValue({
      ok: true,
      id: "app-1",
      applied: 1,
      failed: 1,
      message: "Đã cập nhật 1 đơn; 1 đơn bị chặn.",
      rows: [
        { applicationId: "app-1", applied: true, reason: "applied", message: "Đã mời phỏng vấn." },
        {
          applicationId: "app-2",
          applied: false,
          reason: "stale_status",
          message: "Trạng thái đơn đã thay đổi. Vui lòng tải lại trước khi quyết định."
        }
      ]
    });
    const data = new FormData();
    for (const id of ["app-1", "app-2"]) {
      data.append("application_id", id);
      data.set(`expected_status_${id}`, "screening_completed");
      data.set(`applicant_name_${id}`, `Ứng viên ${id}`);
    }
    const result = await bulkInviteInterviewAction(
      { ok: false, message: "", appliedCount: 0, blockedCount: 0, rows: [] },
      data
    );
    expect(result.appliedCount).toBe(1);
    expect(result.blockedCount).toBe(1);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ applicantName: "Ứng viên app-1", applied: true });
    expect(result.rows[1].applied).toBe(false);
    expect(result.rows[1].message).toContain("Trạng thái đơn đã thay đổi");
    // The status is a constant, never taken from the form.
    expect(vi.mocked(applyApplicationDecisions).mock.calls[0][0].newStatus).toBe(
      BULK_INVITE_TARGET_STATUS
    );
  });

  it("mutates nothing when the confirmation is never completed", () => {
    render(
      <BulkInviteForm
        rows={[{ id: "app-1", fullName: "A", role: "mentor", status: "screening_completed", statusLabel: "x", submittedReviews: 1, recommendationLabel: "Mời vào vòng phỏng vấn" }]}
      />
    );
    expect(vi.mocked(applyApplicationDecisions)).not.toHaveBeenCalled();
    expect(screen.getByTestId("bulk-invite-selected").textContent).toContain("0/1");
  });

  it("creates no interview schedule and assigns no interviewer", () => {
    const form = read("app/applications/bulk-invite-interview/bulk-invite-form.tsx");
    const page = read("app/applications/bulk-invite-interview/page.tsx");
    const action = read("app/actions/bulk-invite-interview.ts");
    for (const source of [form, page, action]) {
      expect(source).not.toContain("interview_scheduled");
      expect(source).not.toContain("vam095_assign_application_review");
      expect(source).not.toContain("vam094_assign_selected_application_reviews");
    }
    expect(BULK_INVITE_TARGET_STATUS).toBe("invited_to_interview");
    expect(BULK_INVITE_MAX).toBeLessThanOrEqual(500);
  });
});

// ---------------------------------------------------------------------------
// 21–27 — operator guidance
// ---------------------------------------------------------------------------

describe("operator guidance", () => {
  it("offers 'Giao review hồ sơ' before any review exists", () => {
    renderPanel({ state: state("ready_for_screening", []) });
    const gate = screen.getByTestId("screening-gate");
    expect(gate.textContent).toContain("Chưa đủ review hồ sơ để quyết định.");
    expect(gate.textContent).toContain("0/1");
    expect(within(gate).getByText(/Giao review hồ sơ/).closest("a")?.getAttribute("href")).toBe(
      "#assign-review-card"
    );
  });

  it("offers 'Mở đánh giá của tôi' when the actor owns the open review", () => {
    const s = state("screening_in_progress", [
      review({ id: "mine", status: "in_progress", reviewer_admin_user_id: ACTOR })
    ]);
    expect(s.myOpenReviewId).toBe("mine");
    renderPanel({ state: s });
    const gate = screen.getByTestId("screening-gate");
    expect(within(gate).getByText(/Mở đánh giá của tôi/).closest("a")?.getAttribute("href")).toBe(
      "/reviews/mine"
    );
    expect(within(gate).queryByText(/Giao review hồ sơ/)).toBeNull();
  });

  it("shows another reviewer read-only, with no way to edit as them", () => {
    const s = state("screening_in_progress", [
      review({ id: "theirs", status: "in_progress", reviewer_admin_user_id: OTHER })
    ]);
    expect(s.myOpenReviewId).toBeNull();
    expect(s.otherActiveReviews.map((r) => r.reviewerName)).toEqual(["Nguyễn Hà Như Liễu"]);
    renderPanel({ state: s });
    const gate = screen.getByTestId("screening-gate");
    expect(gate.textContent).toContain("Nguyễn Hà Như Liễu");
    expect(within(gate).queryByText(/Mở đánh giá của tôi/)).toBeNull();
    const hrefs = within(gate).queryAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).not.toContain("/reviews/theirs");
  });

  it("hides the screening surface once the application has been invited", () => {
    expect(state("invited_to_interview", [submitted()]).inProfileStage).toBe(false);
  });

  it("shows submitted review evidence next to the decision", () => {
    renderPanel({ state: state("screening_completed", [submitted()], ALL_ALLOWED) });
    const evidence = screen.getByTestId("screening-evidence");
    expect(evidence.textContent).toContain("Nguyễn Hà Như Liễu");
    expect(evidence.textContent).toContain("Nên mời phỏng vấn");
    expect(evidence.textContent).toContain("21");
    expect(evidence.textContent).toContain("Hồ sơ rõ ràng, nên gặp trực tiếp.");
    expect(evidence.textContent).toContain("2026-09-06T02:00:00Z");
    expect(evidence.textContent).toContain("Động lực");
  });

  it("shows multiple reviews individually and never averages them", () => {
    const s = state(
      "needs_admin_review",
      [
        submitted({ id: "r1", reviewer_admin_user_id: OTHER, recommendation: "pass_to_interview", total_score: 21 }),
        submitted({
          id: "r2",
          reviewer_admin_user_id: ACTOR,
          recommendation: "reject",
          total_score: 11,
          submitted_at: "2026-09-06T03:00:00Z"
        })
      ],
      ALL_ALLOWED
    );
    expect(s.evidence).toHaveLength(2);
    expect(s.evidence[0].reviewId).toBe("r2");
    expect(s.evidence.map((e) => e.recommendationLabel)).toEqual([
      "Không phù hợp",
      "Nên mời phỏng vấn"
    ]);
    renderPanel({ state: s });
    expect(screen.getAllByTestId("screening-evidence-row")).toHaveLength(2);
    expect(screen.getByTestId("screening-evidence").textContent).toContain("không tính trung bình");
  });

  it("avoids internal-state jargon in the operator surface", () => {
    renderPanel({ state: state("screening_completed", [submitted()], ALL_ALLOWED) });
    const panel = screen.getByTestId("screening-decision-select").closest("form")!;
    expect(panel.textContent).not.toContain("screening_passed");
    expect(panel.textContent).not.toContain("screening_completed");
  });
});

// ---------------------------------------------------------------------------
// Export evidence survives the collapse
// ---------------------------------------------------------------------------

describe("recruitment export", () => {
  it("reads a one-step invite as the screening outcome", () => {
    const derived = deriveDecisions([
      { new_status: "invited_to_interview", previous_status: "screening_completed", created_at: "2026-09-06T04:00:00Z" }
    ]);
    expect(derived.screening?.status).toBe("invited_to_interview");
    expect(derived.reachedStage).toBe("interview");
    const classified = classifyOperational("invited_to_interview", derived);
    expect(classified.passedScreening).toBe(true);
    expect(classified.basis).toBe("audit+current_status");
  });

  it("still prefers an explicit screening_passed row from a two-step history", () => {
    const derived = deriveDecisions([
      { new_status: "screening_passed", previous_status: "screening_completed", created_at: "2026-09-05T01:00:00Z" },
      { new_status: "invited_to_interview", previous_status: "screening_passed", created_at: "2026-09-05T02:00:00Z" }
    ]);
    expect(derived.screening?.status).toBe("screening_passed");
    expect(derived.screening?.at).toBe("2026-09-05T01:00:00Z");
  });

  it("leaves an application with no decisions reporting nothing", () => {
    const derived = deriveDecisions([]);
    expect(derived.screening).toBeNull();
    expect(derived.reachedStage).toBe("screening");
  });
});

// ---------------------------------------------------------------------------
// The canonical mirror agrees with the migration
// ---------------------------------------------------------------------------

describe("canonical eligibility mirror", () => {
  const base = {
    submittedProfileReviewers: 1,
    requiredProfileReviews: 1 as number | null,
    submittedInterviewReviewers: 0,
    latestNeedsMoreReviewAt: null as string | null,
    latestProfileSubmissionAt: "2026-09-01T00:00:00Z" as string | null
  };

  it("returns the same reason strings the RPC does", () => {
    const branch = inviteBranch(read(MIGRATION_PATH));
    for (const reason of [
      "profile_review_minimum_not_met",
      "additional_review_not_submitted",
      "invalid_transition"
    ]) {
      expect(branch).toContain(`'${reason}'`);
    }
    expect(
      evaluateDirectInterviewInvite({
        ...base,
        applicationStatus: "screening_completed",
        submittedProfileReviewers: 0
      }).reason
    ).toBe("profile_review_minimum_not_met");
    expect(
      evaluateDirectInterviewInvite({ ...base, applicationStatus: "ready_for_screening" }).reason
    ).toBe("invalid_transition");
    expect(
      evaluateDirectInterviewInvite({
        ...base,
        applicationStatus: "needs_more_review",
        latestNeedsMoreReviewAt: "2026-09-02T00:00:00Z"
      }).reason
    ).toBe("additional_review_not_submitted");
  });
});
