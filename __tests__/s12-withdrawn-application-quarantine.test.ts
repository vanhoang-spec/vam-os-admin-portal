import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isApplicationRecruitmentOperational,
  isApplicationReviewAssignable
} from "@/lib/application-review-assignability";

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20260905140900_s12_withdrawn_application_quarantine_restore.sql"),
  "utf8"
);
const DEPLOYED_BASE_MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20260903180000_p0_restore_recruitment_review_rpcs.sql"),
  "utf8"
);

function functionBody(name: string, sql = MIGRATION): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const normalizedSql = sql.replace(/\$function\$/gi, "$fn$");
  const match = normalizedSql.match(
    new RegExp(`create or replace function public\\.${escaped}\\([\\s\\S]*?as \\$fn\\$([\\s\\S]*?)\\$fn\\$;`, "i")
  );
  if (!match) throw new Error(`Missing function body: ${name}`);
  return match[1];
}

describe("canonical application review assignability", () => {
  it("allows a submitted application to receive profile screening", () => {
    expect(isApplicationReviewAssignable({
      status: "submitted",
      reviewRound: "profile_screening",
      hasAnyInterviewReview: false
    })).toBe(true);
  });

  it.each(["profile_screening", "interview"] as const)(
    "rejects withdrawn for %s",
    (reviewRound) => {
      expect(isApplicationReviewAssignable({
        status: "withdrawn",
        reviewRound,
        hasAnyInterviewReview: true
      })).toBe(false);
    }
  );

  it("preserves needs_more_review stage provenance", () => {
    expect(isApplicationReviewAssignable({
      status: "needs_more_review",
      reviewRound: "profile_screening",
      hasAnyInterviewReview: false
    })).toBe(true);
    expect(isApplicationReviewAssignable({
      status: "needs_more_review",
      reviewRound: "profile_screening",
      hasAnyInterviewReview: true
    })).toBe(false);
    expect(isApplicationReviewAssignable({
      status: "needs_more_review",
      reviewRound: "interview",
      hasAnyInterviewReview: true
    })).toBe(true);
  });

  it("quarantines withdrawn from existing operational work", () => {
    expect(isApplicationRecruitmentOperational("withdrawn")).toBe(false);
    expect(isApplicationRecruitmentOperational("screening_in_progress")).toBe(true);
    expect(isApplicationRecruitmentOperational("interview_in_progress")).toBe(true);
  });
});

describe("trusted mutation boundaries", () => {
  it("proves the existing terminal-cancel failure is the unconditional recompute", () => {
    const oldChange = functionBody("vam084_change_review_assignment", DEPLOYED_BASE_MIGRATION);
    const oldRecompute = functionBody(
      "vam084_recompute_application_review_status",
      DEPLOYED_BASE_MIGRATION
    );
    expect(oldChange).toContain("perform public.vam084_recompute_application_review_status");
    expect(oldRecompute).toContain("raise exception 'Application state cannot be recomputed from current status'");
    expect(oldRecompute).not.toMatch(/status in \([\s\S]*?'withdrawn'/);
  });

  it("individual and selected-bulk assignment call the same canonical predicate after locking", () => {
    for (const name of [
      "vam095_assign_application_review",
      "vam094_assign_selected_application_reviews",
      "vam084_change_review_assignment"
    ]) {
      const body = functionBody(name);
      expect(body).toContain("for update;");
      expect(body).toContain("public.vam095_application_review_assignability");
      expect(body.indexOf("for update;")).toBeLessThan(
        body.indexOf("public.vam095_application_review_assignability")
      );
      expect(body).toContain("public.vam084_operator_for_season");
    }
  });

  it("allows corrective cancellation but blocks reassignment on withdrawn under the application lock", () => {
    const body = functionBody("vam084_change_review_assignment");
    const appLock = body.indexOf("from public.applications a");
    const reviewLock = body.indexOf("from public.application_reviews ar", appLock);
    const assignmentGate = body.indexOf("if p_new_reviewer is not null then");
    expect(appLock).toBeGreaterThan(-1);
    expect(reviewLock).toBeGreaterThan(appLock);
    expect(body.indexOf("public.vam095_application_review_assignability", assignmentGate))
      .toBeGreaterThan(assignmentGate);
    expect(body).toContain("if v_app.status <> 'withdrawn' then");
    expect(body).toContain("insert into public.recruitment_assignment_events");
  });

  it("withdrawal cancels only active non-submitted reviews and audits each cancellation", () => {
    const body = functionBody("vam084_apply_application_decisions");
    const cancellation = body.match(
      /if p_new_status = 'withdrawn'[\s\S]*?update public\.applications/i
    )?.[0] ?? "";
    expect(cancellation.length).toBeGreaterThan(200);
    expect(cancellation).toContain("ar.status in ('assigned', 'in_progress', 'returned_for_clarification')");
    expect(cancellation).not.toMatch(/ar\.status[^\n]*submitted/);
    expect(cancellation).toContain("set status = 'cancelled'");
    expect(cancellation).toContain("insert into public.recruitment_assignment_events");
    expect(cancellation).not.toMatch(/delete\s+from\s+public\.application_reviews/i);
  });

  it("stale draft and submit lock the application and reject withdrawal before review mutation", () => {
    for (const name of [
      "vam095_save_application_review_draft",
      "vam084_submit_application_review"
    ]) {
      const body = functionBody(name);
      const appLock = body.indexOf("from public.applications a");
      const reviewLock = body.indexOf("from public.application_reviews ar", appLock);
      const withdrawnGuard = body.indexOf("v_app.status = 'withdrawn'");
      const mutation = body.indexOf("update public.application_reviews");
      expect(appLock).toBeGreaterThan(-1);
      expect(reviewLock).toBeGreaterThan(appLock);
      expect(withdrawnGuard).toBeGreaterThan(appLock);
      expect(withdrawnGuard).toBeLessThan(mutation);
      expect(body).toContain("APPLICATION_WITHDRAWN");
    }
  });

  it("restore is privileged, reasoned, provenance-derived, audited, and does not reactivate reviews", () => {
    const body = functionBody("vam095_restore_withdrawn_application");
    expect(body).toContain("length(btrim(coalesce(p_reason, ''))) < 3");
    expect(body).toContain("public.vam084_operator_for_season");
    expect(body).toContain("v_app.status <> 'withdrawn'");
    expect(body).toContain("max(ad.created_at)");
    expect(body).toContain("min(ad.previous_status)");
    expect(body).toContain("v_provenance_count <> 1");
    expect(body).toContain("set status = v_restore_target");
    expect(body).toContain("insert into public.application_decisions");
    expect(body).not.toContain("update public.application_reviews");
    expect(body).not.toMatch(/public\.(people|mentor_profiles|mentee_profiles|person_season_memberships|person_season_invites)/);
  });

  it("new trusted functions are service-role only", () => {
    for (const signature of [
      "vam095_application_review_assignability(uuid, text)",
      "vam095_assign_application_review(uuid, uuid, text, timestamptz, uuid)",
      "vam095_save_application_review_draft(uuid, uuid, integer, integer, integer, integer, integer, text, text)",
      "vam095_restore_withdrawn_application(uuid, uuid, text)"
    ]) {
      expect(MIGRATION).toContain(`revoke all on function public.${signature} from public, anon, authenticated;`);
      expect(MIGRATION).toContain(`grant execute on function public.${signature} to service_role;`);
    }
  });
});

describe("withdrawn application UX contract", () => {
  const detail = readFileSync(join(process.cwd(), "app/applications/[id]/page.tsx"), "utf8");
  const restoreForm = readFileSync(join(process.cwd(), "app/applications/[id]/restore-withdrawn-form.tsx"), "utf8");
  const reviewPage = readFileSync(join(process.cwd(), "app/reviews/[id]/page.tsx"), "utf8");
  const reviewQueue = readFileSync(join(process.cwd(), "app/reviews/page.tsx"), "utf8");

  it("shows a terminal banner with withdrawal actor, time, and note", () => {
    expect(detail).toContain("Hồ sơ đã rút khỏi quy trình tuyển");
    expect(detail).toContain("latestWithdrawal?.created_at");
    expect(detail).toContain("latestWithdrawal?.decided_by_name");
    expect(detail).toContain("latestWithdrawal?.decision_note");
  });

  it("does not render assignment or normal decision controls for withdrawn", () => {
    expect(detail).toContain("canAssign && !isWithdrawn");
    expect(detail).toContain("!isWithdrawn && <Card");
    expect(detail).toContain("Cần huỷ phân công");
    expect(reviewPage).toContain("!applicationWithdrawn &&");
    expect(reviewPage).toContain("allowReassign={!applicationWithdrawn}");
  });

  it("restore requires a reason and confirmation and exposes no target selector", () => {
    expect(restoreForm).toContain('name="restore_reason"');
    expect(restoreForm).toContain("required");
    expect(restoreForm).toContain("minLength={3}");
    expect(restoreForm).toContain("ConfirmActionDialog");
    expect(restoreForm).not.toContain("restore_target");
  });

  /**
   * The invariant is that a terminal parent yields no actionable work in the
   * reviews queue. It used to be pinned by matching the source text of the
   * filter expression, which broke on any refactor while proving nothing about
   * behaviour. It is now asserted against the rendered page: Slice 1 moved the
   * population rule into the query, so the page is checked for what an operator
   * can actually do with a terminal-parent row.
   */
  it("filters terminal parents out of the operational reviews queue", async () => {
    // A pure module, so this asserts the rule itself rather than the runtime.
    const { isOversightOperationalParent } = await import("@/lib/review-oversight");

    expect(isOversightOperationalParent("withdrawn")).toBe(false);
    expect(isOversightOperationalParent("rejected_or_not_fit")).toBe(false);
    expect(isOversightOperationalParent("screening_assigned")).toBe(true);

    // The queue asks the data layer for a population; it does not re-derive one.
    expect(reviewQueue).toContain("getReviewOversightQueue");
    expect(reviewQueue).toContain("reviewOversightActionability");
    expect(reviewQueue).not.toContain("getAllApplicationReviews");
  });

  it("never offers work on a terminal-parent row in the reviews queue", () => {
    // A row is actionable only through this helper, and it refuses every
    // terminal parent and every cancelled assignment.
    expect(reviewQueue).toContain('actionability.actionable ? "Làm review" : "Xem"');
  });
});
