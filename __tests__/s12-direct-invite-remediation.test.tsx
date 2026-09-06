/**
 * @vitest-environment jsdom
 *
 * Regressions for the four blockers Codex found in the direct-invite candidate.
 * Each describe below is one blocker, and each test fails against the code as it
 * stood before this remediation.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
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

import { ScreeningDecisionPanel } from "@/app/applications/[id]/screening-decision-panel";
import { classifyOutcome, deriveDecisions, classifyOperational } from "@/lib/recruitment-export";
import { evaluateDirectInterviewInvite } from "@/lib/direct-interview-eligibility";
import { isBulkInviteCandidate } from "@/lib/bulk-invite-interview";
import {
  buildScreeningDecisionState,
  allScreeningChoicesBlocked,
  isScreeningChoiceBlocked,
  primaryBlockedReason,
  type ScreeningReviewInput
} from "@/lib/screening-decision";

const ACTOR = "aaaaaaaa-0000-4000-8000-00000000000a";
const OTHER = "bbbbbbbb-0000-4000-8000-00000000000b";
const THIRD = "dddddddd-0000-4000-8000-00000000000d";
const NAMES = new Map([
  [ACTOR, "Core Team Ops"],
  [OTHER, "Reviewer Khác"],
  [THIRD, "Reviewer Thứ Ba"]
]);

const CARRIAGE_RETURN = String.fromCharCode(13);
const read = (p: string) =>
  readFileSync(join(process.cwd(), p), "utf8").split(CARRIAGE_RETURN).join("");

function open(id: string, reviewer: string, status = "in_progress"): ScreeningReviewInput {
  return {
    id,
    review_round: "profile_screening",
    status,
    reviewer_admin_user_id: reviewer,
    total_score: null,
    recommendation: null,
    reviewer_note: null,
    submitted_at: null
  };
}

beforeEach(() => {
  mockUseFormState.mockReturnValue([{ ok: false, message: null }, vi.fn()]);
  mockUseFormStatus.mockReturnValue({ pending: false });
});

afterEach(cleanup);

// ---------------------------------------------------------------------------
// BLOCKER 1 — export derivation
// ---------------------------------------------------------------------------

describe("blocker 1: export derivation after a remediation", () => {
  const REMEDIATED = [
    { new_status: "needs_more_review", previous_status: "screening_completed", created_at: "2026-09-01T00:00:00Z" },
    { new_status: "invited_to_interview", previous_status: "needs_more_review", created_at: "2026-09-03T00:00:00Z" }
  ];

  it("reads needs_more_review → later direct invite as SCREENING PASSED", () => {
    // The old guard (`!out.screening`) froze the superseded remediation and lost
    // the real outcome. The stage in progress is what decides now.
    const derived = deriveDecisions(REMEDIATED);
    expect(derived.screening?.status).toBe("invited_to_interview");
    expect(derived.screening?.at).toBe("2026-09-03T00:00:00Z");
    expect(derived.reachedStage).toBe("interview");
  });

  it("classifies a derived direct invite as passed, so the export filter finds it", () => {
    const derived = deriveDecisions(REMEDIATED);
    expect(classifyOutcome(derived.screening)).toBe("passed");
    expect(classifyOperational("invited_to_interview", derived).passedScreening).toBe(true);
  });

  it("never invents a timestamp — every outcome carries its own decision row's", () => {
    const derived = deriveDecisions(REMEDIATED);
    expect(REMEDIATED.map((row) => row.created_at)).toContain(derived.screening?.at);
  });

  it("does not overwrite a later contradictory terminal decision", () => {
    const derived = deriveDecisions([
      ...REMEDIATED,
      { new_status: "rejected_or_not_fit", previous_status: "interview_completed", created_at: "2026-09-09T00:00:00Z" }
    ]);
    // The rejection happened at the interview stage and is attributed there.
    expect(derived.screening?.status).toBe("invited_to_interview");
    expect(derived.interview?.status).toBe("rejected_or_not_fit");
    expect(classifyOutcome(derived.interview)).toBe("rejected");
  });

  it("preserves an explicit historical screening_passed row and its timestamp", () => {
    const derived = deriveDecisions([
      { new_status: "screening_passed", previous_status: "screening_completed", created_at: "2026-08-20T00:00:00Z" },
      { new_status: "invited_to_interview", previous_status: "screening_passed", created_at: "2026-08-21T00:00:00Z" }
    ]);
    expect(derived.screening?.status).toBe("screening_passed");
    expect(derived.screening?.at).toBe("2026-08-20T00:00:00Z");
  });

  it("uses durable chronological ordering, not array order", () => {
    const derived = deriveDecisions([
      { new_status: "invited_to_interview", previous_status: "needs_more_review", created_at: "2026-09-03T00:00:00Z" },
      { new_status: "needs_more_review", previous_status: "screening_completed", created_at: "2026-09-01T00:00:00Z" }
    ]);
    expect(derived.screening?.status).toBe("invited_to_interview");
  });

  it("keeps a still-open remediation reported as needs_more_review", () => {
    const derived = deriveDecisions([REMEDIATED[0]]);
    expect(classifyOutcome(derived.screening)).toBe("needs_more_review");
  });
});

// ---------------------------------------------------------------------------
// BLOCKER 2 — bulk parity
// ---------------------------------------------------------------------------

describe("blocker 2: bulk uses the canonical eligibility model", () => {
  const base = {
    submittedProfileReviewers: 1,
    requiredProfileReviews: 1 as number | null,
    submittedInterviewReviewers: 0,
    latestNeedsMoreReviewAt: null as string | null,
    latestProfileSubmissionAt: "2026-09-05T00:00:00Z" as string | null
  };

  it("includes profile-stage needs_more_review when its provenance holds", () => {
    // The hand-written allowlist omitted this entirely — an application the
    // individual command accepts was invisible in bulk.
    expect(
      isBulkInviteCandidate({
        ...base,
        status: "needs_more_review",
        latestNeedsMoreReviewAt: "2026-09-04T00:00:00Z"
      })
    ).toBe(true);
  });

  it("excludes needs_more_review when the newer review is missing", () => {
    expect(
      isBulkInviteCandidate({
        ...base,
        status: "needs_more_review",
        latestNeedsMoreReviewAt: "2026-09-06T00:00:00Z"
      })
    ).toBe(false);
  });

  it("excludes an interview-stage needs_more_review from the screening bulk", () => {
    expect(
      isBulkInviteCandidate({
        ...base,
        status: "needs_more_review",
        latestNeedsMoreReviewAt: "2026-09-04T00:00:00Z",
        submittedInterviewReviewers: 1
      })
    ).toBe(false);
  });

  it("delegates rather than duplicating: identical answers to the canonical model", () => {
    const cases = [
      { status: "screening_completed" },
      { status: "needs_admin_review" },
      { status: "screening_passed" },
      { status: "ready_for_screening" },
      { status: "needs_more_review", latestNeedsMoreReviewAt: "2026-09-04T00:00:00Z" },
      { status: "needs_more_review", latestNeedsMoreReviewAt: "2026-09-06T00:00:00Z" },
      { status: "screening_completed", submittedProfileReviewers: 0 }
    ];
    for (const override of cases) {
      const input = { ...base, ...override };
      expect(isBulkInviteCandidate(input)).toBe(
        evaluateDirectInterviewInvite({ ...input, applicationStatus: input.status }).eligible
      );
    }
  });

  it("fails closed when the season requirement could not be read", () => {
    expect(
      isBulkInviteCandidate({ ...base, status: "screening_completed", requiredProfileReviews: null })
    ).toBe(false);
  });

  it("carries season, intake batch, role and search filters", () => {
    const page = read("app/applications/bulk-invite-interview/page.tsx");
    for (const field of ["season_id", "intake_batch_id", "role_applied", "q"]) {
      expect(page).toContain(`name="${field}"`);
    }
  });

  it("is discoverable from the Applications area", () => {
    const applications = read("app/applications/page.tsx");
    expect(applications).toContain('href="/applications/bulk-invite-interview"');
    expect(applications).toContain("Mời phỏng vấn hàng loạt");
  });

  it("reports per-applicant results rather than a bare aggregate", () => {
    const form = read("app/applications/bulk-invite-interview/bulk-invite-form.tsx");
    expect(form).toContain("state.rows.map");
    expect(form).toContain("row.applicantName");
    expect(form).toContain("Bị chặn");
  });
});

// ---------------------------------------------------------------------------
// BLOCKER 2b / 9 — the retired "Qua vòng hồ sơ" workflow
// ---------------------------------------------------------------------------

describe("the old screening_passed workflow is retired from normal S12 flow", () => {
  it("is gone from the bulk screening toolbar", () => {
    const controls = read("app/applications/_components/bulk-screening-controls.tsx");
    expect(controls).not.toContain('value="screening_passed"');
    expect(controls).not.toContain("Qua vòng hồ sơ</button>");
  });

  it("is refused by the bulk screening action, so a cached page cannot revive it", () => {
    const action = read("app/actions/s12-screening-bulk.ts");
    const allowlist = action.slice(
      action.indexOf("const ALLOWED_BULK_STATUSES"),
      action.indexOf(";", action.indexOf("const ALLOWED_BULK_STATUSES"))
    );
    expect(allowlist).not.toContain("screening_passed");
    expect(allowlist).toContain("needs_more_review");
    expect(allowlist).toContain("rejected_or_not_fit");
  });

  it("remains available where it must: audit labels and export filters", () => {
    // The status is historical fact. Removing it from these would rewrite the past.
    expect(read("lib/ui-labels.ts")).toContain('key === "screening_passed"');
    expect(read("app/applications/exports/export-panels.tsx")).toContain('value="screening_passed"');
  });
});

// ---------------------------------------------------------------------------
// BLOCKER 3 — no edit-as-other
// ---------------------------------------------------------------------------

describe("blocker 3: an unfinished review is never editable by anyone else", () => {
  it("shows the owner's name instead of an action on the application detail", () => {
    const page = read("app/applications/[id]/page.tsx");
    expect(page).toContain("review-owned-by-other");
    expect(page).toContain("đang thực hiện");
    expect(page).toContain("Mở đánh giá của tôi");
    // The unconditional "perform this review" link is gone. (The phrase still
    // appears in the explanatory comment above the fix, so this asserts the
    // rendered form rather than the raw substring.)
    expect(page).not.toContain(': "Thực hiện đánh giá"');
    expect(page).not.toContain("> Thực hiện đánh giá");
  });

  it("keeps the corrective cancel available on a withdrawn parent", () => {
    const page = read("app/applications/[id]/page.tsx");
    expect(page).toContain("Huỷ phân công");
    expect(page).toContain("isWithdrawn && isOpen");
  });

  it("restricts the review editor to the assignee", () => {
    const reviewPage = read("app/reviews/[id]/page.tsx");
    const canEdit = reviewPage.slice(
      reviewPage.indexOf("const canEdit ="),
      reviewPage.indexOf("const canManageAssignment")
    );
    expect(canEdit).toContain("isOwner");
    expect(canEdit).not.toContain("core_team");
    expect(canEdit).not.toContain("super_admin");
  });

  it("still lets an authorized operator cancel or reassign", () => {
    const reviewPage = read("app/reviews/[id]/page.tsx");
    expect(reviewPage).toContain("canManageAssignment");
    expect(reviewPage).toContain("canAssignReview(adminUser.role)");
  });

  it("explains why the form is read-only for a non-owner", () => {
    expect(read("app/reviews/[id]/page.tsx")).toContain("không chỉnh sửa hay nộp thay");
  });
});

// ---------------------------------------------------------------------------
// BLOCKER 4 — UI gating matches the server
// ---------------------------------------------------------------------------

describe("blocker 4: the UI never disagrees with the server", () => {
  const DENY = { eligible: false, reason: "profile_review_minimum_not_met" as const };

  it("gates ALL THREE decisions on the server's answer, not just the invite", () => {
    const s = buildScreeningDecisionState({
      applicationStatus: "screening_completed",
      reviews: [],
      requiredCount: 1,
      actorAdminUserId: ACTOR,
      eligibility: {
        invited_to_interview: DENY,
        needs_more_review: DENY,
        rejected_or_not_fit: DENY
      }
    });
    // The old model declared reject/needs-more as never review-gated, which the
    // database contradicts.
    expect(isScreeningChoiceBlocked("rejected_or_not_fit", s)).toBe(true);
    expect(isScreeningChoiceBlocked("needs_more_review", s)).toBe(true);
    expect(allScreeningChoicesBlocked(s)).toBe(true);
  });

  it("enables exactly what the server enables, per decision", () => {
    const s = buildScreeningDecisionState({
      applicationStatus: "needs_more_review",
      reviews: [],
      requiredCount: 1,
      actorAdminUserId: ACTOR,
      eligibility: {
        invited_to_interview: { eligible: false, reason: "additional_review_not_submitted" },
        needs_more_review: { eligible: true, reason: "eligible" },
        rejected_or_not_fit: { eligible: true, reason: "eligible" }
      }
    });
    expect(isScreeningChoiceBlocked("invited_to_interview", s)).toBe(true);
    expect(isScreeningChoiceBlocked("rejected_or_not_fit", s)).toBe(false);
    expect(allScreeningChoicesBlocked(s)).toBe(false);
  });

  it("fails closed and says so when the requirement cannot be read", () => {
    const s = buildScreeningDecisionState({
      applicationStatus: "screening_completed",
      reviews: [],
      requiredCount: null,
      actorAdminUserId: ACTOR,
      eligibility: {}
    });
    expect(primaryBlockedReason(s)).toBe("eligibility_unknown");
    expect(allScreeningChoicesBlocked(s)).toBe(true);

    render(
      <ScreeningDecisionPanel
        applicationId="app-1"
        currentStatus="screening_completed"
        state={s}
        canAssignReview
      />
    );
    const gate = screen.getByTestId("screening-gate");
    expect(gate.textContent).toContain("Không đọc được yêu cầu số lượng review");
    // No apparently-usable control.
    const select = screen.getByTestId("screening-decision-select") as HTMLSelectElement;
    expect(Array.from(select.options).filter((o) => o.value && !o.disabled)).toHaveLength(0);
  });

  it("never assumes a minimum of 1 when the requirement is missing", () => {
    const page = read("app/applications/[id]/page.tsx");
    const block = page.slice(
      page.indexOf("const requiredProfileReviews"),
      page.indexOf("const personId")
    );
    expect(block).toContain("stageRequirementsResult.error");
    expect(block).toContain("? null");
    expect(block).not.toContain("?? 1");
  });

  it("finds the actor's own open review regardless of array order", () => {
    // Somebody else's review sorts first; the actor's must still be found.
    const s = buildScreeningDecisionState({
      applicationStatus: "screening_in_progress",
      reviews: [open("theirs", OTHER), open("mine", ACTOR), open("third", THIRD)],
      requiredCount: 1,
      actorAdminUserId: ACTOR,
      reviewerNameById: NAMES,
      eligibility: {}
    });
    expect(s.myOpenReviewId).toBe("mine");
    expect(s.otherActiveReviews.map((r) => r.id).sort()).toEqual(["theirs", "third"]);
  });

  it("lists every other open reviewer, not just the first", () => {
    const s = buildScreeningDecisionState({
      applicationStatus: "screening_in_progress",
      reviews: [open("theirs", OTHER), open("third", THIRD, "assigned")],
      requiredCount: 1,
      actorAdminUserId: ACTOR,
      reviewerNameById: NAMES,
      eligibility: {
        invited_to_interview: DENY,
        needs_more_review: DENY,
        rejected_or_not_fit: DENY
      }
    });
    expect(s.myOpenReviewId).toBeNull();
    expect(s.otherActiveReviews.map((r) => r.reviewerName)).toEqual([
      "Reviewer Khác",
      "Reviewer Thứ Ba"
    ]);
    expect(s.otherActiveReviews.map((r) => r.statusLabel)).toEqual(["Đang làm", "Chưa bắt đầu"]);

    render(
      <ScreeningDecisionPanel
        applicationId="app-1"
        currentStatus="screening_in_progress"
        state={s}
        canAssignReview
      />
    );
    const others = screen.getByTestId("screening-other-reviewers");
    expect(within(others).getAllByRole("listitem")).toHaveLength(2);
    expect(others.textContent).toContain("Reviewer Khác");
    expect(others.textContent).toContain("Reviewer Thứ Ba");
    // Read-only: no link into anybody else's review.
    expect(within(others).queryAllByRole("link")).toHaveLength(0);
  });

  it("shows both the actor's own CTA and the other reviewers, together", () => {
    const s = buildScreeningDecisionState({
      applicationStatus: "screening_in_progress",
      reviews: [open("theirs", OTHER), open("mine", ACTOR)],
      requiredCount: 1,
      actorAdminUserId: ACTOR,
      reviewerNameById: NAMES,
      eligibility: {
        invited_to_interview: DENY,
        needs_more_review: DENY,
        rejected_or_not_fit: DENY
      }
    });
    render(
      <ScreeningDecisionPanel
        applicationId="app-1"
        currentStatus="screening_in_progress"
        state={s}
        canAssignReview
      />
    );
    const gate = screen.getByTestId("screening-gate");
    expect(within(gate).getByText(/Mở đánh giá của tôi/).closest("a")?.getAttribute("href")).toBe(
      "/reviews/mine"
    );
    expect(gate.textContent).toContain("Reviewer Khác");
  });

  it("asks the database rather than re-deriving SQL logic in the page", () => {
    const page = read("app/applications/[id]/page.tsx");
    expect(page).toContain("getApplicationDecisionEligibility");
    expect(page).toContain("SCREENING_DECISION_CHOICES.map");
    // The page must not re-implement the provenance rule itself.
    expect(page).not.toContain("latestNeedsMoreReviewAt");
  });

  it("treats an unreadable eligibility answer as a refusal", () => {
    const source = read("lib/application-decisions.ts");
    expect(source).toContain("eligibility_unknown");
    const fn = source.slice(source.indexOf("export async function getApplicationDecisionEligibility"));
    expect(fn).toContain('if (!client) return { eligible: false, reason: "eligibility_unknown" }');
    expect(fn).toContain("if (error)");
  });
});

// ---------------------------------------------------------------------------
// Migration ordering and non-collision
// ---------------------------------------------------------------------------

describe("migration ordering", () => {
  const QUARANTINE = "supabase/migrations/20260905140900_s12_withdrawn_application_quarantine_restore.sql";
  const DIRECT = "supabase/migrations/20260906090000_s12_direct_interview_invite.sql";

  function definedFunctions(sql: string): string[] {
    const names = new Set<string>();
    const pattern = /create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(sql))) names.add(match[1].toLowerCase());
    return Array.from(names).sort();
  }

  it("the direct-invite migration sorts after the quarantine one", () => {
    expect("20260906090000" > "20260905140900").toBe(true);
  });

  it("redefines no function the quarantine migration changed", () => {
    const quarantine = definedFunctions(read(QUARANTINE));
    const direct = definedFunctions(read(DIRECT));
    expect(direct).toEqual(["vam084_application_decision_eligibility"]);
    expect(quarantine).not.toContain("vam084_application_decision_eligibility");
    expect(direct.filter((name) => quarantine.includes(name))).toEqual([]);
  });

  it("keeps the quarantine migration's own guarantees intact in this candidate", () => {
    const sql = read(QUARANTINE);
    expect(sql).toContain("if v_app.status <> 'withdrawn' then");
    expect(sql).toContain("APPLICATION_WITHDRAWN");
    expect(sql).toContain("public.vam095_application_review_assignability");
    expect(sql).toContain("Trusted server context required");
    expect(sql).toContain("set search_path = ''");
  });
});
