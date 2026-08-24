import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8").toLowerCase();
const migration079 = read("supabase_migrations/079_application_review_states.sql");
const migration080 = read("supabase_migrations/080_r3_fixes.sql");
const migration081 = read("supabase_migrations/081_r3_atomic_review_workflow.sql");
const migration082 = read("supabase_migrations/082_r3_final_gate_remediation.sql");

const allMigrations = migration082 + "\n" + migration081 + "\n" + migration080 + "\n" + migration079;

function functionBody(name: string) {
  const match = allMigrations.match(new RegExp(`create or replace (?:function|view) public\\.${name}[\\s\\S]*?(?=create or replace (?:function|view) public\\.|$)`, "i"));
  expect(match).toBeTruthy();
  return match![0];
}

describe("R3 server-only authorization and blinding", () => {
  it("removes applications_read and explicitly revokes workflow-table DML", () => {
    expect(migration080).toContain('drop policy if exists "applications_read" on public.applications;');
    expect(migration080).not.toContain('create policy "applications_read"');
    expect(migration080).toContain("on table public.applications, public.application_reviews, public.application_answers");
    expect(migration080).toContain("from authenticated, anon, public;");
  });

  it("uses the active-only reviewer uniqueness index", () => {
    const indexStart = migration080.indexOf("create unique index idx_app_reviews_single_reviewer");
    const indexSql = migration080.slice(indexStart, migration080.indexOf(";", indexStart));
    expect(indexSql).toContain("(application_id, reviewer_admin_user_id, review_round)");
    expect(indexSql).toContain("where status <> 'cancelled'");
  });

  it("keeps email values out of the search blob", () => {
    const blobStart = migration082.indexOf("lower(\n");
    const blob = migration082.slice(blobStart, migration082.indexOf(") as search_blob", blobStart));
    expect(blob).toContain("email_primary");
  });
});

describe("R3 final recommendation semantics", () => {
  it("defines conflict as exactly two non-null submitted recommendations that differ", () => {
    const body = functionBody("vam081_evaluate_conflict");
    expect(body).toContain("ar.status = 'submitted' and ar.recommendation is not null");
    expect(body).toContain("count(*) filter");
    expect(body).toContain("count(distinct ar.recommendation)");
    expect((body.match(/= 2/g) ?? [])).toHaveLength(2);
    expect(body).not.toContain(">= 2");
  });

  it("routes draft and submit mutations through locking ownership-checked RPCs", () => {
    const draft = functionBody("vam081_save_application_review_draft");
    const submit = functionBody("vam081_submit_application_review");
    for (const body of [draft, submit]) {
      expect(body).toContain("pg_advisory_xact_lock");
      expect(body).toContain("for update");
      expect(body).toContain("reviewer_admin_user_id is distinct from p_actor");
      expect(body).toContain("v_review.status = 'submitted'");
    }
    // Recompute does the conflict evaluation now, but submit locks the row and calls recompute
    expect(submit).toContain("public.vam081_recompute_application_status");

    const source = read("lib/application-reviews.ts");
    expect(source).toContain('client.rpc("vam081_save_application_review_draft"');
    expect(source).toContain('client.rpc("vam081_submit_application_review"');
    expect(source).not.toContain('.select("recommendation")');
  });

  it("blocks every update whose old review status is submitted", () => {
    const trigger = functionBody("vam081_prevent_submitted_review_update");
    expect(trigger).toContain("if old.status = 'submitted'");
    expect(trigger).not.toContain("current_setting('vam081.unassign_rpc', true) = 'on'");
    expect(allMigrations).toContain("before update on public.application_reviews");
  });
});

describe("R3 assignment lifecycle", () => {
  it("unassigns only unfinished reviews, records cancellation audit columns, and recomputes status", () => {
    const body = functionBody("vam081_unassign_application_review");
    expect(body).toContain("v_review.status = 'submitted'");
    expect(body).toContain("status = 'cancelled'");
    expect(body).toContain("cancelled_at = transaction_timestamp()");
    expect(body).toContain("cancelled_by = p_actor");
    expect(body).toContain("cancel_reason = btrim(p_cancel_reason)");
    expect(body).toContain("insert into public.admin_audit_log");
    expect(body).toContain("actor_admin_user_id");
    expect(body).toContain("before_data");
    expect(body).toContain("after_data");
    expect(body).toContain("public.vam081_recompute_application_status");
  });

  it("performs reassign cancellation and replacement under one application lock", () => {
    const body = functionBody("vam081_reassign_application_review");
    expect((body.match(/pg_advisory_xact_lock/g) ?? [])).toHaveLength(1);
    expect(body.indexOf("pg_advisory_xact_lock")).toBeLessThan(body.indexOf("status = 'cancelled'"));
    expect(body.indexOf("status = 'cancelled'")).toBeLessThan(body.indexOf("insert into public.application_reviews"));
    expect(body).toContain("insert into public.admin_audit_log");
  });
});
