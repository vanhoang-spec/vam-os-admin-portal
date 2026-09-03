/**
 * P0.1 — profile-screening reviewer eligibility policy.
 *
 * After the P0 restore, Giao Review loaded but the reviewer dropdown was empty:
 * vam084_list_recruitment_participants required
 *   admin_users -> people (by email) -> person_season_memberships
 * for BOTH stages, and UEHM-S12 has zero active reviewer/interviewer
 * memberships. The Owner's policy for PROFILE SCREENING is an admin-account
 * policy that must not depend on participant identity or lifecycle data.
 *
 * Two things are asserted here:
 *   1. the migration's SQL contract — the profile-screening branch must not
 *      touch people/person_season_memberships, the interview branch must still
 *      require them, and the trust boundary must survive;
 *   2. the application boundary — the SAME RPC backs the dropdown, individual
 *      assignment and bulk assignment, so a policy fix in the database is
 *      enough and no UI-only filtering exists.
 *
 * The runtime semantics themselves (cases A–J) were proven by executing the
 * function against a disposable clone of the Production schema; that cannot be
 * reproduced in vitest without a database.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { validateReviewEligibleReviewers, REVIEW_ELIGIBLE_ROLES } from "@/lib/reviewer-eligibility";

const MIGRATION = readFileSync(
  "supabase/migrations/20260903193000_profile_screening_reviewer_eligibility.sql",
  "utf8"
);

/** Executable SQL only — the header comment explains the old people-join. */
const SQL = MIGRATION.replace(/^--.*$/gm, "");

const BODY_START = SQL.indexOf("$function$");
const BODY = SQL.slice(BODY_START, SQL.lastIndexOf("$function$"));
const [SCREENING_BRANCH, INTERVIEW_BRANCH] = BODY.split(/\bunion all\b/i);

const SEASON = "22222222-2222-4222-8222-000000000012";

function rpcClient(rows: unknown[], error: unknown = null) {
  return { rpc: vi.fn().mockResolvedValue({ data: error ? null : rows, error }) };
}

/** An admin account with NO people row and NO membership — the case that broke. */
function adminRow(id: string, role: string, email = `${id}@ops.vam.test`) {
  return { id, email, full_name: `Name ${id}`, role, participation_role: "reviewer" };
}

describe("P0.1 migration — profile-screening branch drops the participant dependency", () => {
  it("does not join people or person_season_memberships for profile screening", () => {
    expect(SCREENING_BRANCH).toContain("p_review_stage = 'profile_screening'");
    expect(SCREENING_BRANCH).not.toMatch(/public\.people/);
    expect(SCREENING_BRANCH).not.toMatch(/person_season_memberships/);
  });

  it("keeps the admin-account policy exactly as the Owner specified", () => {
    expect(SCREENING_BRANCH).toContain("au.status = 'active'");
    expect(SCREENING_BRANCH).toContain("au.role in ('reviewer', 'core_team', 'admin', 'super_admin')");
    expect(SCREENING_BRANCH).toContain("au.role = 'super_admin'");
    expect(SCREENING_BRANCH).toContain("asa.user_id = au.auth_user_id");
    expect(SCREENING_BRANCH).toContain("asa.season_id = p_season_id::text");
    expect(SCREENING_BRANCH).toContain("asa.status = 'active'");
    expect(SCREENING_BRANCH).toContain("asa.role in ('review', 'operations', 'full_access')");
  });

  it("labels profile-screening rows without inventing a membership", () => {
    expect(SCREENING_BRANCH).toContain("'reviewer'::text as participation_role");
    expect(MIGRATION).not.toMatch(/insert\s+into\s+public\.person_season_memberships/i);
    expect(MIGRATION).not.toMatch(/\binsert\s+into\b/i);
  });
});

describe("P0.1 migration — interview policy is untouched", () => {
  it("still requires the people match and an active interviewer membership", () => {
    expect(INTERVIEW_BRANCH).toContain("p_review_stage = 'interview'");
    expect(INTERVIEW_BRANCH).toContain("public.people");
    expect(INTERVIEW_BRANCH).toContain("person_season_memberships");
    expect(INTERVIEW_BRANCH).toContain("psm.status = 'active'");
    expect(INTERVIEW_BRANCH).toContain("psm.role = 'interviewer'");
  });

  it("does not broaden interview eligibility to bare admin accounts", () => {
    // The interview branch must never gain the screening shortcut.
    expect(INTERVIEW_BRANCH).not.toContain("'reviewer'::text as participation_role");
    expect(INTERVIEW_BRANCH).toContain("psm.role");
  });

  it("fails closed for an unrecognised stage — neither branch can match", () => {
    expect(SCREENING_BRANCH).toContain("p_review_stage = 'profile_screening'");
    expect(INTERVIEW_BRANCH).toContain("p_review_stage = 'interview'");
    // No catch-all branch exists.
    expect(BODY.split(/\bunion all\b/i)).toHaveLength(2);
  });
});

describe("P0.1 migration — trust boundary preserved", () => {
  it("keeps the service_role guard on both branches", () => {
    expect(SCREENING_BRANCH).toContain("current_user = 'service_role'");
    expect(INTERVIEW_BRANCH).toContain("current_user = 'service_role'");
  });

  it("keeps the empty search_path and the same signature and return contract", () => {
    expect(SQL).toContain("set search_path to ''");
    expect(SQL).toContain("p_season_id uuid,");
    expect(SQL).toContain("p_review_stage text");
    expect(SQL).toContain(
      "returns table(id uuid, email text, full_name text, role text, participation_role text)"
    );
  });

  it("re-asserts service_role-only execute and never grants anon or authenticated", () => {
    expect(SQL).toMatch(/revoke all on function public\.vam084_list_recruitment_participants[^;]*from public;/);
    expect(SQL).toMatch(/revoke all on function public\.vam084_list_recruitment_participants[^;]*from anon, authenticated;/);
    expect(SQL).toMatch(/grant execute on function public\.vam084_list_recruitment_participants[^;]*to service_role;/);
    expect(SQL).not.toMatch(/grant execute[^;]*to (anon|authenticated|public)/i);
  });

  it("changes only this one function and creates no schema objects", () => {
    expect((SQL.match(/create or replace function/gi) ?? [])).toHaveLength(1);
    expect(SQL).not.toMatch(/create table/i);
    expect(SQL).not.toMatch(/drop /i);
    expect(SQL).not.toMatch(/alter table/i);
  });
});

describe("P0.1 application boundary — the RPC result is the whole policy", () => {
  it("accepts profile-screening accounts that have no people row and no membership", async () => {
    const rows = [adminRow("admin-1", "admin"), adminRow("core-1", "core_team"), adminRow("super-1", "super_admin")];
    const client = rpcClient(rows);
    const result = await validateReviewEligibleReviewers(
      client,
      ["admin-1", "core-1", "super-1"],
      SEASON,
      "profile_screening"
    );
    expect(result.ok).toBe(true);
    expect(client.rpc).toHaveBeenCalledWith("vam084_list_recruitment_participants", {
      p_season_id: SEASON,
      p_review_stage: "profile_screening"
    });
  });

  it("refuses an account the RPC did not return, so assignment cannot bypass the policy", async () => {
    const client = rpcClient([adminRow("admin-1", "admin")]);
    const result = await validateReviewEligibleReviewers(
      client,
      ["admin-1", "not-eligible-1"],
      SEASON,
      "profile_screening"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/không tồn tại|không hoạt động|vai trò/i);
  });

  it("refuses an ineligible admin role even if the RPC somehow returned it", async () => {
    const client = rpcClient([adminRow("viewer-1", "viewer")]);
    const result = await validateReviewEligibleReviewers(client, ["viewer-1"], SEASON, "profile_screening");
    expect(result.ok).toBe(false);
  });

  it("passes the review round through, so interview keeps its own policy", async () => {
    const client = rpcClient([adminRow("core-1", "core_team")]);
    await validateReviewEligibleReviewers(client, ["core-1"], SEASON, "interview");
    expect(client.rpc).toHaveBeenCalledWith("vam084_list_recruitment_participants", {
      p_season_id: SEASON,
      p_review_stage: "interview"
    });
  });

  it("fails closed when the RPC errors rather than allowing the assignment", async () => {
    const client = rpcClient([], { message: "boom" });
    const result = await validateReviewEligibleReviewers(client, ["admin-1"], SEASON, "profile_screening");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toContain("boom");
  });

  it("agrees with the roles the migration admits", () => {
    for (const role of REVIEW_ELIGIBLE_ROLES) {
      expect(SCREENING_BRANCH).toContain(`'${role}'`);
    }
  });
});

describe("P0.1 — one canonical eligibility boundary, no UI-only filtering", () => {
  const DATA = readFileSync("lib/data.ts", "utf8");
  const REVIEWS = readFileSync("lib/application-reviews.ts", "utf8");
  const ELIGIBILITY = readFileSync("lib/reviewer-eligibility.ts", "utf8");

  it("sources the dropdown from the same RPC", () => {
    expect(DATA).toContain('"vam084_list_recruitment_participants"');
  });

  it("validates individual and bulk assignment through the same helper", () => {
    expect(REVIEWS).toContain("validateReviewEligibleReviewers");
    expect(ELIGIBILITY).toContain('client.rpc("vam084_list_recruitment_participants"');
  });

  it("does not re-derive eligibility from people or memberships in the app layer", () => {
    const executable = ELIGIBILITY.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(executable).not.toContain("person_season_memberships");
    expect(executable).not.toMatch(/from\(["']people["']\)/);
  });
});
