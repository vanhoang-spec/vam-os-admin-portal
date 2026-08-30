import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260830070430_s12_recruitment_operational_remediation.sql");

describe("M090 database boundary", () => {
  it("configures S12 minimum one per stage without a maximum-two rule", () => {
    expect(migration).toContain("(v_s12, 'profile_screening', 1)");
    expect(migration).toContain("minimum_submitted_reviews between 1 and 20");
    expect(migration).toContain("v_submitted >= v_required");
    expect(migration).not.toMatch(/v_submitted\s*=\s*2/);
  });

  it("requires exact season and distinct stage membership", () => {
    expect(migration).toContain("psm.season_id = p_season_id");
    expect(migration).toContain("when 'profile_screening' then 'reviewer'");
    expect(migration).toContain("when 'interview' then 'interviewer'");
    expect(migration).toContain("asa.season_id = p_season_id::text");
  });

  it("keeps privileged RPCs off public/authenticated execution", () => {
    expect(migration).not.toContain("security definer");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("revoke all on function public.vam084_change_review_assignment");
    expect(migration).toContain("to service_role");
  });

  it("preserves cancel/reassign history in one database transaction", () => {
    expect(migration).toContain("create table if not exists public.recruitment_assignment_events");
    expect(migration).toContain("previous_review_id uuid not null");
    expect(migration).toContain("replacement_review_id uuid null");
    expect(migration).toContain("reason text not null");
    expect(migration).toContain("create or replace function public.vam084_change_review_assignment");
  });

  it("moves completed interview requirements to final-decision readiness", () => {
    expect(migration).toContain("when v_submitted >= v_required then 'ready_for_final_decision'");
    expect(migration).toContain("v_app.status = 'ready_for_final_decision'");
  });

  it("uses the same lifecycle predicate for individual and bulk decisions", () => {
    expect(migration).toContain("vam084_application_decision_eligibility(v_row.id, p_new_status)");
    expect(read("lib/application-decisions.ts")).toContain('client.rpc("vam084_apply_application_decisions"');
    expect(read("app/actions/application-decisions.ts")).toContain("recordApplicationDecision");
    expect(read("app/actions/bulk-application-decisions.ts")).toContain("applyApplicationDecisions");
  });

  it("reports mixed bulk results without allowing an ineligible write", () => {
    expect(migration).toContain("return query select v_row.id::uuid, v_row.status::text, p_new_status, false");
    expect(migration).toMatch(/if not coalesce\(v_gate\.eligible, false\)[\s\S]*continue;[\s\S]*update public\.applications/);
  });

  it("removes unassigned self-claim and filters reviewer queue to owned rows", () => {
    const claim = read("lib/interview-claim.ts");
    expect(claim).toContain("Bạn chưa được phân công phỏng vấn ứng viên này");
    expect(claim).not.toContain('.insert({\n      application_id: appId');
    expect(read("lib/data.ts")).toContain("appList.filter((application) => ownedReviewByAppId.has(application.id))");
  });
});

describe("M090 participant list contract", () => {
  it("validates IDs from the exact season/stage RPC", async () => {
    vi.resetModules();
    const { validateReviewEligibleReviewers } = await import("@/lib/reviewer-eligibility");
    const rpc = vi.fn().mockResolvedValue({
      data: [{ id: "reviewer-a", email: "a@example.test", full_name: "A", role: "reviewer" }],
      error: null
    });
    const result = await validateReviewEligibleReviewers({ rpc }, ["reviewer-a"], "season-s12", "interview");
    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("vam084_list_recruitment_participants", {
      p_season_id: "season-s12",
      p_review_stage: "interview"
    });
  });

  it("fails closed when a requested reviewer is absent", async () => {
    const { validateReviewEligibleReviewers } = await import("@/lib/reviewer-eligibility");
    const result = await validateReviewEligibleReviewers(
      { rpc: vi.fn().mockResolvedValue({ data: [], error: null }) },
      ["reviewer-b"], "season-s12", "interview"
    );
    expect(result.ok).toBe(false);
  });
});
