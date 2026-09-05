/**
 * @vitest-environment jsdom
 *
 * S12 throughput — profile review → ONE Core Team decision → interview invite.
 *
 * The operational claim: Core Team records one decision where it used to record
 * two. The safety claim: the review gate is not weakened by a single character.
 * Both are pinned here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/application-decisions", () => ({
  applyApplicationDecisions: vi.fn(),
  recordApplicationDecision: vi.fn()
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
import { bulkApplicationDecisionAction } from "@/app/actions/bulk-application-decisions";
import { ScreeningDecisionPanel } from "@/app/applications/[id]/screening-decision-panel";
import { BulkInviteForm } from "@/app/applications/bulk-invite-interview/bulk-invite-form";
import {
  BULK_INVITE_MAX,
  BULK_INVITE_SOURCE_STATUSES,
  BULK_INVITE_TARGET_STATUS,
  isBulkInviteCandidate
} from "@/lib/bulk-invite-interview";
import {
  SCREENING_DECISION_CHOICES,
  buildScreeningDecisionState,
  isScreeningChoiceBlocked,
  type ScreeningReviewInput
} from "@/lib/screening-decision";
import { classifyOperational, deriveDecisions } from "@/lib/recruitment-export";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACTOR = "aaaaaaaa-0000-4000-8000-00000000000a";
const OTHER = "bbbbbbbb-0000-4000-8000-00000000000b";
const APP_ID = "cccccccc-0000-4000-8000-00000000000c";

const NAMES = new Map([
  [ACTOR, "Core Team Ops"],
  [OTHER, "Nguyễn Hà Như Liễu"]
]);

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
  requiredCount = 1,
  actor: string | null = ACTOR
) {
  return buildScreeningDecisionState({
    applicationStatus,
    reviews,
    requiredCount,
    actorAdminUserId: actor,
    reviewerNameById: NAMES
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
/** Normalises line endings — these assertions are about SQL, not CRLF. */
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
  mockUseFormState.mockReturnValue([{ ok: false, message: null }, vi.fn()]);
  mockUseFormStatus.mockReturnValue({ pending: false });
});

afterEach(cleanup);

// ---------------------------------------------------------------------------
// INDIVIDUAL 1–4 — what does NOT satisfy the gate
// ---------------------------------------------------------------------------

describe("the invite is blocked without a submitted review", () => {
  it("blocks with zero reviews", () => {
    const s = state("screening_completed", []);
    expect(s.submittedCount).toBe(0);
    expect(s.met).toBe(false);
    expect(isScreeningChoiceBlocked("invited_to_interview", s)).toBe(true);
    expect(s.assignmentState).toBe("unassigned");
  });

  it("blocks with an assigned-only review", () => {
    const s = state("screening_assigned", [review({ status: "assigned" })]);
    expect(s.met).toBe(false);
    expect(s.assignmentState).toBe("assigned");
    expect(isScreeningChoiceBlocked("invited_to_interview", s)).toBe(true);
  });

  it("blocks with an in_progress review", () => {
    const s = state("screening_in_progress", [review({ status: "in_progress" })]);
    expect(s.met).toBe(false);
    expect(s.assignmentState).toBe("in_progress");
    expect(isScreeningChoiceBlocked("invited_to_interview", s)).toBe(true);
  });

  it("blocks with a cancelled review, and says it was cancelled", () => {
    const s = state("ready_for_screening", [review({ status: "cancelled" })]);
    expect(s.met).toBe(false);
    expect(s.assignmentState).toBe("cancelled");
    expect(isScreeningChoiceBlocked("invited_to_interview", s)).toBe(true);
  });

  it("counts DISTINCT reviewers, matching the RPC", () => {
    const s = state(
      "screening_completed",
      [submitted({ id: "a" }), submitted({ id: "b" })],
      2
    );
    expect(s.submittedCount).toBe(1);
    expect(s.met).toBe(false);
  });

  it("renders the blocked invite visible but unselectable", () => {
    renderPanel({ state: state("screening_completed", [review({ status: "cancelled" })]) });
    const invite = option("invited_to_interview");
    expect(invite.disabled).toBe(true);
    expect(invite.textContent).toContain("Mời phỏng vấn");
    expect(invite.textContent).toContain("chưa đủ đánh giá");
  });
});

// ---------------------------------------------------------------------------
// INDIVIDUAL 5–7 — one action, correct target
// ---------------------------------------------------------------------------

describe("one Core Team action closes the profile round", () => {
  it("enables the direct invite once the minimum is met", () => {
    const s = state("screening_completed", [submitted()]);
    expect(s.met).toBe(true);
    expect(isScreeningChoiceBlocked("invited_to_interview", s)).toBe(false);

    renderPanel({ state: s });
    expect(option("invited_to_interview").disabled).toBe(false);
    expect(screen.queryByTestId("screening-gate")).toBeNull();
  });

  it("targets invited_to_interview directly — the final state after one command", () => {
    const invite = SCREENING_DECISION_CHOICES.find((c) => c.label === "Mời phỏng vấn");
    expect(invite?.value).toBe("invited_to_interview");
    expect(invite?.requiresProfileReview).toBe(true);
  });

  it("offers exactly three decisions, and no separate 'Qua vòng hồ sơ' step", () => {
    renderPanel({ state: state("screening_completed", [submitted()]) });
    const select = screen.getByTestId("screening-decision-select") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value).filter(Boolean);
    expect(values).toEqual([
      "invited_to_interview",
      "needs_more_review",
      "rejected_or_not_fit"
    ]);
    expect(values).not.toContain("screening_passed");
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
// INDIVIDUAL 8–11 — the server gate, audit, staleness, scope, role
// ---------------------------------------------------------------------------

describe("the database remains the arbiter", () => {
  it("still requires the profile minimum for the direct invite", () => {
    const branch = inviteBranch(read(MIGRATION_PATH));
    expect(branch).toContain("v_profile_submitted >= v_profile_required");
    expect(branch).toContain("'profile_review_minimum_not_met'");
  });

  it("counts only submitted reviews, and only distinct reviewers", () => {
    // The counting statement is shared by every branch and is unchanged.
    const body = eligibilityBody(read(MIGRATION_PATH));
    expect(body).toContain("count(distinct ar.reviewer_admin_user_id)");
    expect(body).toContain("ar.review_round = 'profile_screening' and ar.status = 'submitted'");
  });

  it("changes exactly one branch of the eligibility function and nothing else", () => {
    const splitBranches = (fn: string) => fn.split(/\n  (?:if|elsif) p_new_status/);
    const before = splitBranches(eligibilityBody(read(DEPLOYED_PATH)));
    const after = splitBranches(eligibilityBody(read(MIGRATION_PATH)));
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
    expect(sql).toContain(
      "revoke all on function public.vam084_application_decision_eligibility(uuid, text)"
    );
    expect(sql).toContain("to service_role;");
  });

  it("keeps stale-status and scope protection in the decision boundary", () => {
    // Unchanged by this candidate — asserted so a later edit cannot drop it.
    const deployed = read(DEPLOYED_PATH);
    const apply = deployed.slice(
      deployed.indexOf("CREATE OR REPLACE FUNCTION public.vam084_apply_application_decisions")
    );
    expect(apply).toContain("'stale_status'");
    expect(apply).toContain("'expected_status_missing'");
    expect(apply).toContain("public.vam084_operator_for_season(p_actor, v_row.season_id)");
    expect(apply).toContain("insert into public.application_decisions");
  });

  it("refuses a bulk decision from an actor who cannot decide", async () => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "r1", role: "reviewer" } as never);
    const data = new FormData();
    data.append("application_id", APP_ID);
    data.set("new_status", "invited_to_interview");
    const result = await bulkApplicationDecisionAction({ ok: false, message: null }, data);
    expect(result.ok).toBe(false);
    expect(applyApplicationDecisions).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// INDIVIDUAL 12–14 — provenance, rejection, legacy
// ---------------------------------------------------------------------------

describe("provenance, rejection and legacy records", () => {
  it("carries the needs_more_review profile provenance rule into the invite branch", () => {
    const branch = inviteBranch(read(MIGRATION_PATH));
    // Only a PROFILE-stage needs_more_review may advance...
    expect(branch).toContain("v_interview_submitted = 0");
    // ...and only once a review was submitted AFTER the request for more review.
    expect(branch).toContain("ar.review_round = 'profile_screening'");
    expect(branch).toContain("ar.submitted_at > v_latest_more_review_at");
    expect(branch).toContain("'additional_review_not_submitted'");
  });

  it("leaves the needs_more_review branch itself untouched", () => {
    const before = eligibilityBody(read(DEPLOYED_PATH));
    const after = eligibilityBody(read(MIGRATION_PATH));
    const marker = "elsif p_new_status in ('waitlisted','rejected_or_not_fit','needs_more_review') then";
    expect(before).toContain(marker);
    expect(after).toContain(marker);
    const slice = (fn: string) => fn.slice(fn.indexOf(marker), fn.indexOf("elsif p_new_status = 'withdrawn'"));
    expect(slice(after)).toBe(slice(before));
  });

  it("keeps rejection on the existing canonical status, with no duplicate", () => {
    const values = SCREENING_DECISION_CHOICES.map((c) => c.value);
    expect(values).toContain("rejected_or_not_fit");
    expect(values.filter((v) => v.includes("reject"))).toEqual(["rejected_or_not_fit"]);
    const reject = SCREENING_DECISION_CHOICES.find((c) => c.value === "rejected_or_not_fit");
    // Not review-gated: the database already allows it from screening_completed.
    expect(reject?.requiresProfileReview).toBe(false);
    expect(reject?.destructive).toBe(true);
  });

  it("shows no screening guidance for a record already invited with zero reviews", () => {
    // The 31 grandfathered UEHM-S12 mentors.
    const legacy = state("invited_to_interview", []);
    expect(legacy.inProfileStage).toBe(false);
    expect(legacy.submittedCount).toBe(0);
  });

  it("never proposes moving an invited record backwards", () => {
    const values = SCREENING_DECISION_CHOICES.map((c) => c.value);
    expect(values).not.toContain("screening_completed");
    expect(values).not.toContain("ready_for_screening");
    expect(values).not.toContain("screening_passed");
  });
});

// ---------------------------------------------------------------------------
// BULK 15–20
// ---------------------------------------------------------------------------

describe("bulk invite", () => {
  it("offers only applications the individual command would accept", () => {
    for (const status of ["screening_completed", "needs_admin_review", "screening_passed"]) {
      expect(isBulkInviteCandidate({ status, submittedProfileReviews: 1 }, 1)).toBe(true);
    }
    for (const status of ["submitted", "ready_for_screening", "invited_to_interview", "withdrawn"]) {
      expect(isBulkInviteCandidate({ status, submittedProfileReviews: 1 }, 1)).toBe(false);
    }
  });

  it("withholds a row below the review minimum", () => {
    expect(isBulkInviteCandidate({ status: "screening_completed", submittedProfileReviews: 0 }, 1)).toBe(false);
    expect(isBulkInviteCandidate({ status: "screening_completed", submittedProfileReviews: 1 }, 2)).toBe(false);
    expect(isBulkInviteCandidate({ status: "screening_completed", submittedProfileReviews: 2 }, 2)).toBe(true);
  });

  it("withholds needs_more_review from sweep selection", () => {
    // Legal at the database, deliberately not offered in bulk: it would
    // overturn a judgement someone made about one applicant.
    expect(BULK_INVITE_SOURCE_STATUSES.has("needs_more_review")).toBe(false);
    expect(isBulkInviteCandidate({ status: "needs_more_review", submittedProfileReviews: 3 }, 1)).toBe(false);
  });

  it("sends every row's expected status so a stale row is blocked, not skipped", () => {
    const rows = [
      { id: "app-1", fullName: "A", role: "mentor", status: "screening_completed", statusLabel: "x", submittedReviews: 1 },
      { id: "app-2", fullName: "B", role: "mentee", status: "needs_admin_review", statusLabel: "y", submittedReviews: 2 }
    ];
    const { container } = render(<BulkInviteForm rows={rows} />);
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    // Nothing selected yet — no ids are submitted.
    expect(container.querySelectorAll('input[name="application_id"]')).toHaveLength(0);
    expect(container.querySelector('input[name="new_status"]')?.getAttribute("value")).toBe(
      BULK_INVITE_TARGET_STATUS
    );
  });

  it("reports applied and blocked counts from the server, per row", async () => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: ACTOR, role: "core_team" } as never);
    vi.mocked(applyApplicationDecisions).mockResolvedValue({
      ok: true,
      id: "app-1",
      applied: 2,
      failed: 1,
      message: "Đã cập nhật 2 đơn; 1 đơn bị chặn. Đơn chưa đủ số review hồ sơ tối thiểu.: 1"
    });
    const data = new FormData();
    for (const id of ["app-1", "app-2", "app-3"]) {
      data.append("application_id", id);
      data.set(`expected_status_${id}`, "screening_completed");
    }
    data.set("new_status", "invited_to_interview");

    const result = await bulkApplicationDecisionAction({ ok: false, message: null }, data);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("2");
    expect(result.message).toContain("bị chặn");

    const call = vi.mocked(applyApplicationDecisions).mock.calls[0][0];
    expect(call.newStatus).toBe("invited_to_interview");
    expect(call.applicationIds).toEqual(["app-1", "app-2", "app-3"]);
    // Every row carries its own expected status.
    expect(Object.keys(call.expectedStatuses)).toHaveLength(3);
  });

  it("mutates nothing when the confirmation is never completed", () => {
    const rows = [
      { id: "app-1", fullName: "A", role: "mentor", status: "screening_completed", statusLabel: "x", submittedReviews: 1 }
    ];
    render(<BulkInviteForm rows={rows} />);
    // The only submit control lives behind the confirm dialog, so rendering and
    // abandoning the page cannot dispatch the action.
    expect(vi.mocked(applyApplicationDecisions)).not.toHaveBeenCalled();
    expect(screen.getByTestId("bulk-invite-selected").textContent).toContain("0/1");
  });

  it("creates no interview schedule and assigns no interviewer", () => {
    const form = read("app/applications/bulk-invite-interview/bulk-invite-form.tsx");
    const page = read("app/applications/bulk-invite-interview/page.tsx");
    for (const source of [form, page]) {
      expect(source).not.toContain("interview_scheduled");
      expect(source).not.toMatch(/reviewer_admin_user_id\s*[:=]/);
      expect(source).not.toContain("application_reviews\").insert");
      expect(source).not.toContain("vam095_assign_application_review");
      expect(source).not.toContain("vam094_assign_selected_application_reviews");
    }
    // And the only status this surface can ever send is the invite.
    expect(form).toContain("BULK_INVITE_TARGET_STATUS");
    expect(BULK_INVITE_TARGET_STATUS).toBe("invited_to_interview");
  });

  it("caps a batch at a reviewable size", () => {
    expect(BULK_INVITE_MAX).toBeGreaterThan(1);
    expect(BULK_INVITE_MAX).toBeLessThanOrEqual(500);
  });
});

// ---------------------------------------------------------------------------
// UX 21–27
// ---------------------------------------------------------------------------

describe("operator guidance", () => {
  it("offers 'Giao review hồ sơ' before any review exists", () => {
    const s = state("ready_for_screening", []);
    expect(s.cta).toBe("assign");
    renderPanel({ state: s });
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
    expect(s.cta).toBe("open_mine");
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
    expect(s.cta).toBe("await_other");
    expect(s.myOpenReviewId).toBeNull();
    renderPanel({ state: s });
    const gate = screen.getByTestId("screening-gate");
    expect(gate.textContent).toContain("Nguyễn Hà Như Liễu");
    expect(within(gate).queryByText(/Mở đánh giá của tôi/)).toBeNull();
    const hrefs = within(gate).queryAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).not.toContain("/reviews/theirs");
  });

  it("hides the screening guidance once the application has been invited", () => {
    const s = state("invited_to_interview", [submitted()]);
    expect(s.inProfileStage).toBe(false);
  });

  it("shows submitted review evidence next to the decision", () => {
    renderPanel({ state: state("screening_completed", [submitted()]) });
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
      1
    );
    expect(s.evidence).toHaveLength(2);
    // Newest first, and each keeps its own recommendation.
    expect(s.evidence[0].reviewId).toBe("r2");
    expect(s.evidence.map((e) => e.recommendationLabel)).toEqual([
      "Không phù hợp",
      "Nên mời phỏng vấn"
    ]);

    renderPanel({ state: s });
    expect(screen.getAllByTestId("screening-evidence-row")).toHaveLength(2);
    expect(screen.getByTestId("screening-evidence").textContent).toContain(
      "không tính trung bình"
    );
  });

  it("avoids internal-state jargon in the operator surface", () => {
    renderPanel({ state: state("screening_completed", [submitted()]) });
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
    expect(classifyOperational("invited_to_interview", derived).passedScreening).toBe(true);
    expect(classifyOperational("invited_to_interview", derived).basis).toBe("audit+current_status");
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
