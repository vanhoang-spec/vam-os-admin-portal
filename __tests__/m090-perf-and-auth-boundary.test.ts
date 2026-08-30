import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

const perfMigration = read(
  "supabase/migrations/20260830150000_s12_recruitment_performance_indexes.sql"
);
const m090Migration = read(
  "supabase/migrations/20260830070430_s12_recruitment_operational_remediation.sql"
);

// ---------------------------------------------------------------------------
// M090-A  Performance index coverage
// ---------------------------------------------------------------------------
describe("M090-A performance indexes", () => {
  it("adds covering index on application_answers.application_id (Advisor candidate 1)", () => {
    expect(perfMigration).toContain("application_answers_application_id_idx");
    expect(perfMigration).toContain("on public.application_answers (application_id)");
  });

  it("adds partial index on applications.person_id (Advisor candidate 2)", () => {
    expect(perfMigration).toContain("applications_person_id_idx");
    expect(perfMigration).toContain("on public.applications (person_id)");
    expect(perfMigration).toContain("where person_id is not null");
  });

  it("adds applications.season_id index for recruitment list load hot path", () => {
    expect(perfMigration).toContain("applications_season_id_idx");
    expect(perfMigration).toContain("on public.applications (season_id)");
  });

  it("adds composite index for application_reviews hot path (Advisor candidate 3)", () => {
    expect(perfMigration).toContain("application_reviews_app_round_status_idx");
    expect(perfMigration).toContain(
      "on public.application_reviews (application_id, review_round, status)"
    );
  });

  it("adds composite index for admin_scope_access RLS hot path (Advisor candidate 4)", () => {
    expect(perfMigration).toContain("admin_scope_access_user_season_role_status_idx");
    expect(perfMigration).toContain(
      "on public.admin_scope_access (user_id, season_id, role, status)"
    );
    // Partial: only active rows matter for auth evaluation
    expect(perfMigration).toContain("where status = 'active'");
  });

  it("adds reviewer isolation composite index for M090-B authorization boundary", () => {
    expect(perfMigration).toContain("application_reviews_reviewer_round_status_idx");
    expect(perfMigration).toContain(
      "on public.application_reviews (reviewer_admin_user_id, review_round, status)"
    );
    expect(perfMigration).toContain("where reviewer_admin_user_id is not null");
  });

  it("uses IF NOT EXISTS on every index (safe to apply idempotently)", () => {
    const indexStatements = perfMigration
      .split("\n")
      .filter((l) => l.trim().toLowerCase().startsWith("create index"));
    expect(indexStatements.length).toBeGreaterThanOrEqual(6);
    for (const stmt of indexStatements) {
      expect(stmt.toLowerCase()).toContain("if not exists");
    }
  });

  it("wraps all indexes in a single transaction (begin/commit)", () => {
    expect(perfMigration).toContain("begin;");
    expect(perfMigration).toContain("commit;");
  });
});

// ---------------------------------------------------------------------------
// M090-B  Authorization boundary (reviewer isolation)
// ---------------------------------------------------------------------------
describe("M090-B reviewer isolation boundary", () => {
  it("enforces season-scoped participant check in interview submit path", () => {
    // vam084_submit_application_review checks vam084_participant_for_stage
    expect(m090Migration).toContain(
      "not public.vam084_participant_for_stage(p_actor, v_season_id, v_review.review_round)"
    );
    expect(m090Migration).toContain("Review submission actor is not the authorized assignee");
  });

  it("enforces reviewer_admin_user_id = p_actor identity check on submit", () => {
    // Only the assigned reviewer may submit
    expect(m090Migration).toContain("v_review.reviewer_admin_user_id <> p_actor");
  });

  it("prevents a reviewer being assigned to their own active application", () => {
    // Reassignment check: new reviewer must not have an active non-cancelled row
    expect(m090Migration).toContain("Replacement reviewer rejected");
    expect(m090Migration).toContain("ar.reviewer_admin_user_id = p_new_reviewer");
    expect(m090Migration).toContain("ar.status <> 'cancelled'");
  });

  it("checks participant membership for bulk assignment (no global reviewer role)", () => {
    expect(m090Migration).toContain(
      "not public.vam084_participant_for_stage(v_reviewer_id, v_season_id, p_review_round)"
    );
    expect(m090Migration).toContain(
      "Reviewer is not an active participant for this season and stage"
    );
  });

  it("does NOT grant interview assignment via self-claim insert", () => {
    const claim = read("lib/interview-claim.ts");
    // The final return must be a rejection, not an insert
    expect(claim).toContain("Bạn chưa được phân công phỏng vấn ứng viên này");
    expect(claim).not.toContain(".insert({");
  });

  it("filters interview queue to reviewer-owned rows only (IDOR boundary)", () => {
    const data = read("lib/data.ts");
    // Reviewer queue shows only applications where ownedReviewByAppId.has(app.id)
    expect(data).toContain("appList.filter((application) => ownedReviewByAppId.has(application.id))");
    // Ownership is established only for rows where reviewer_admin_user_id === actor
    expect(data).toContain("row.reviewer_admin_user_id !== filters?.actor.adminUserId");
  });

  it("contact PII is only returned for applications the reviewer owns", () => {
    const data = read("lib/data.ts");
    // ownedContacts: email_primary and phone_primary fetched only for owned app IDs
    expect(data).toContain("const ownedAppIds = Array.from(ownedReviewByAppId.keys())");
    expect(data).toContain('"id,email_primary,phone_primary"');
    // contactByAppId is keyed on ownedAppIds, so non-owned apps get no contact
    expect(data).toContain("const contactByAppId = new Map(ownedContacts.data.map");
  });

  it("operator_for_season requires service_role context + active operator scope", () => {
    // Security: cannot be invoked from client-side (anon/authenticated)
    expect(m090Migration).toContain("current_user = 'service_role'");
    expect(m090Migration).toContain("vam084_operator_for_season");
    expect(m090Migration).toContain("asa.role in ('operations', 'full_access')");
  });

  it("preserves Core Team / Admin operator visibility for all assignments", () => {
    expect(m090Migration).toContain("au.role in ('super_admin', 'admin', 'core_team')");
    // Reviewer-pool revoke is also operator-gated
    expect(m090Migration).toContain("not public.vam084_operator_for_season(p_actor, p_season_id)");
    expect(m090Migration).toContain("Recruitment participation revoke rejected");
  });

  it("unique active-reviewer-round constraint prevents double-assignment", () => {
    expect(m090Migration).toContain("application_reviews_active_reviewer_round_uidx");
    expect(m090Migration).toContain(
      "on public.application_reviews (application_id, reviewer_admin_user_id, review_round)"
    );
    expect(m090Migration).toContain("where status is distinct from 'cancelled'");
  });
});
