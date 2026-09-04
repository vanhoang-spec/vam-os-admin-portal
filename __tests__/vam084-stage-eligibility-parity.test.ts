import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Recruitment eligibility: one policy, two thin callers.
 *
 * WHAT KEPT BREAKING
 *   `vam084_list_recruitment_participants` fills every assignee dropdown; every
 *   assignment RPC re-checks `vam084_participant_for_stage`. They used to carry
 *   SEPARATE COPIES of the same policy. Migration 20260903193000 moved the
 *   profile-screening half of the list onto the Owner's admin-account policy
 *   and left the predicate demanding an active 'reviewer' membership, so the UI
 *   offered reviewers the database then refused with P0001 — and UEHM-S12,
 *   which has zero active 'reviewer' memberships, could not assign a single
 *   profile review. 20260904100000 re-synced them by hand, which fixed that
 *   instance and left the trap armed for the next edit.
 *
 * WHAT THIS SUITE NOW GUARDS
 *   20260904143000 makes parity STRUCTURAL: one canonical set-returning
 *   function, `vam084_recruitment_eligible_admins`, and two callers that are
 *   thin derivations of it. So these assertions are no longer "do these two
 *   policy blocks happen to agree" but "is there still only ONE policy block".
 *   An edit that re-inlines policy into either caller fails here even if the
 *   two copies agree on the day it is written.
 *
 *   These are contract assertions over migration SQL. They do NOT execute
 *   PostgreSQL. Behaviour against the real catalog is proven by applying the
 *   migration to Staging and running the flow. No test that reads only
 *   migration files can detect a database whose catalog is behind the
 *   repository — the 2026-09-04 Staging incident was exactly that.
 */

const MIGRATIONS_DIR = "supabase/migrations";
const CANONICAL_MIGRATION = "20260904143000_privileged_recruitment_automatic_eligibility.sql";

/** The last migration (in applied order) that redefines `fn`, with its text. */
function latestDefinitionOf(fn: string) {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // timestamp-prefixed, so lexical order is apply order

  let found: { file: string; sql: string } | null = null;
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    if (new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\b`, "i").test(sql)) {
      found = { file, sql };
    }
  }
  if (!found) throw new Error(`no migration defines ${fn}`);
  return found;
}

/** Body of the dollar-quoted block belonging to `fn` in `sql`. */
function functionBody(sql: string, fn: string) {
  const start = sql.search(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\b`, "i"));
  if (start < 0) throw new Error(`definition of ${fn} not found`);
  const rest = sql.slice(start);
  const tag = rest.match(/\$([a-z_]*)\$/i);
  if (!tag) throw new Error(`no dollar-quoted body for ${fn}`);
  const open = rest.indexOf(tag[0]);
  const close = rest.indexOf(tag[0], open + tag[0].length);
  if (close < 0) throw new Error(`unterminated body for ${fn}`);
  return rest.slice(open + tag[0].length, close);
}

const CANONICAL = "vam084_recruitment_eligible_admins";
const canonical = latestDefinitionOf(CANONICAL);
const predicate = latestDefinitionOf("vam084_participant_for_stage");
const lister = latestDefinitionOf("vam084_list_recruitment_participants");

const canonicalBody = functionBody(canonical.sql, CANONICAL);
const predicateBody = functionBody(predicate.sql, "vam084_participant_for_stage");
const listerBody = functionBody(lister.sql, "vam084_list_recruitment_participants");

/** The UNION arm of the canonical body that emits `source`. */
function arm(source: string) {
  const at = canonicalBody.indexOf(`'${source}'::text`);
  expect(at, `no arm emitting ${source}`).toBeGreaterThan(-1);
  const next = canonicalBody.indexOf("\n  union", at);
  return canonicalBody.slice(at, next < 0 ? undefined : next);
}

const profileArm = arm("account");
const privilegedArm = arm("privileged_role");
const participationArm = arm("participation");

describe("eligibility parity is structural", () => {
  it("all three definitions land in the same canonical migration", () => {
    expect(canonical.file).toBe(CANONICAL_MIGRATION);
    expect(predicate.file).toBe(CANONICAL_MIGRATION);
    expect(lister.file).toBe(CANONICAL_MIGRATION);
  });

  it("G. both callers derive from the canonical function and carry no policy of their own", () => {
    for (const [name, body] of [
      ["predicate", predicateBody],
      ["lister", listerBody]
    ] as const) {
      // Derives from the single source of truth...
      expect(body, name).toContain(`public.${CANONICAL}(p_season_id, p_review_stage)`);
      // ...and re-implements none of it. These are the tables the policy is
      // made of; a caller touching them again is a second copy by definition.
      expect(body, name).not.toMatch(/admin_scope_access/i);
      expect(body, name).not.toMatch(/person_season_memberships/i);
      // Policy is never re-branched on stage outside the canonical function.
      expect(body, name).not.toMatch(/p_review_stage\s*=\s*'profile_screening'/);
    }
    // The lister may branch on stage for its DISPLAY label only.
    expect(listerBody).toMatch(/case when p_review_stage = 'interview' then 'interviewer'/);
  });

  it("the predicate is exactly a membership test over the canonical set", () => {
    expect(predicateBody).toMatch(/select exists \(/);
    expect(predicateBody).toMatch(/where e\.admin_user_id = p_admin_user_id/);
  });

  it("the policy fingerprint appears in the canonical function and nowhere else", () => {
    const fingerprint = /asa\.role in \('review', 'operations', 'full_access'\)/;
    expect(canonicalBody).toMatch(fingerprint);
    expect(predicateBody).not.toMatch(fingerprint);
    expect(listerBody).not.toMatch(fingerprint);
  });
});

describe("the policy itself", () => {
  it("shared gate: active account, participating role, exact-season active scope", () => {
    expect(canonicalBody).toMatch(/au\.status = 'active'/);
    expect(canonicalBody).toMatch(/au\.role in \('reviewer', 'core_team', 'admin', 'super_admin'\)/);
    expect(canonicalBody).toMatch(/asa\.status = 'active'/);
    // D. exact target season only — a scope for another season cannot qualify.
    expect(canonicalBody).toMatch(/asa\.season_id = p_season_id::text/);
  });

  it("C/E. super_admin is globally eligible and needs no season scope", () => {
    expect(canonicalBody).toMatch(/au\.role = 'super_admin'\s*\n?\s*or exists/);
  });

  it("A/B. profile screening requires no people row and no membership row", () => {
    expect(profileArm).toMatch(/p_review_stage = 'profile_screening'/);
    expect(profileArm).not.toMatch(/person_season_memberships/i);
    expect(profileArm).not.toMatch(/public\.people/i);
  });

  it("A/B/C. INTERVIEW is automatic for active core_team / admin / super_admin", () => {
    expect(privilegedArm).toMatch(/p_review_stage = 'interview'/);
    expect(privilegedArm).toMatch(/ea\.role in \('core_team', 'admin', 'super_admin'\)/);
    // The whole point: no identity or membership prerequisite on this arm.
    expect(privilegedArm).not.toMatch(/person_season_memberships/i);
    expect(privilegedArm).not.toMatch(/public\.people/i);
  });

  it("F. a STANDALONE reviewer still needs explicit interviewer participation", () => {
    expect(participationArm).toMatch(/ea\.role = 'reviewer'/);
    expect(participationArm).toMatch(/public\.people/);
    expect(participationArm).toMatch(/lower\(btrim\(p\.email_primary\)\) = lower\(btrim\(au\.email\)\)/);
    expect(participationArm).toMatch(/psm\.role = 'interviewer'/);
    expect(participationArm).toMatch(/psm\.status = 'active'/);
    expect(participationArm).toMatch(/psm\.season_id = p_season_id/);
  });

  it("F. being a reviewer does not by itself confer interview eligibility", () => {
    // The only interview arm admitting role='reviewer' is the one joined to an
    // active interviewer membership.
    const reviewerArms = [privilegedArm, participationArm].filter((a) =>
      /ea\.role = 'reviewer'/.test(a)
    );
    expect(reviewerArms).toHaveLength(1);
    expect(reviewerArms[0]).toMatch(/psm\.role = 'interviewer'/);
  });

  it("E. an inactive privileged account is excluded by the shared gate", () => {
    // Exactly one account-status test, in the shared CTE, so no arm can admit
    // an inactive account by omission.
    expect(canonicalBody.match(/au\.status = 'active'/g) ?? []).toHaveLength(1);
    expect(canonicalBody.indexOf("au.status = 'active'")).toBeLessThan(
      canonicalBody.indexOf("'account'::text")
    );
  });

  it("an unknown stage matches no arm and returns nothing", () => {
    // Every arm is guarded by an explicit stage equality; none is a fallback.
    const stageGuards = canonicalBody.match(/p_review_stage = '[a-z_]+'/g) ?? [];
    expect(stageGuards.length).toBeGreaterThanOrEqual(3);
    for (const guard of stageGuards) {
      expect(guard).toMatch(/'(profile_screening|interview)'/);
    }
    expect(canonicalBody).not.toMatch(/p_review_stage\s+(not\s+)?in\s*\(/);
  });
});

describe("J. human name display precedence", () => {
  it("people.full_name, then admin_users.full_name, then email", () => {
    expect(listerBody).toMatch(
      /coalesce\(\s*nullif\(btrim\(p\.full_name\), ''\),\s*nullif\(btrim\(au\.full_name\), ''\),\s*au\.email\s*\)/
    );
    // Matched on NORMALISED email, so casing or stray whitespace cannot lose
    // the human name and silently fall back to the mailbox string.
    expect(listerBody).toMatch(/lower\(btrim\(pp\.email_primary\)\) = lower\(btrim\(au\.email\)\)/);
    // Deterministic pick, so a duplicated people email cannot make the
    // displayed name flip between reads.
    expect(listerBody).toMatch(/order by pp\.id\s*\n?\s*limit 1/);
  });
});

describe("trusted context and contract preservation", () => {
  it("the canonical function is service_role-only", () => {
    expect(canonical.sql).toMatch(
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${CANONICAL}\\(uuid, text\\) FROM public, anon, authenticated`)
    );
    expect(canonical.sql).toMatch(
      new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${CANONICAL}\\(uuid, text\\) TO service_role`)
    );
  });

  it("both callers keep their ACL and search_path, and the lister keeps its guard", () => {
    expect(predicate.sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.vam084_participant_for_stage\(uuid, uuid, text\) FROM public, anon, authenticated/
    );
    expect(lister.sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.vam084_list_recruitment_participants\(uuid, text\) FROM public, anon, authenticated/
    );
    expect(canonical.sql.match(/SET search_path TO ''/g) ?? []).toHaveLength(3);
    expect(listerBody).toContain("current_user = 'service_role'");
    expect(canonical.sql).not.toMatch(/security\s+definer/i);
  });

  it("the lister's published return shape is unchanged", () => {
    expect(lister.sql).toMatch(
      /RETURNS TABLE\(id uuid, email text, full_name text, role text, participation_role text\)/
    );
  });

  it("no table DDL, no backfill, no index change", () => {
    for (const forbidden of [
      /create\s+table/i,
      /alter\s+table/i,
      /drop\s+table/i,
      /create\s+(unique\s+)?index/i,
      /drop\s+index/i,
      /insert\s+into/i,
      /update\s+public\./i,
      /delete\s+from/i
    ]) {
      expect(canonical.sql).not.toMatch(forbidden);
    }
  });
});

describe("L. the explicit grant path is untouched", () => {
  const grant = latestDefinitionOf("vam084_grant_recruitment_participation");

  it("the scope-reuse remediation is still the latest grant definition", () => {
    expect(grant.file).toBe("20260904140000_grant_participation_scope_reuse.sql");
    expect(grant.sql).toContain("v_has_qualifying_scope");
  });

  it("H. privileged eligibility does not route through the grant RPC", () => {
    expect(canonicalBody).not.toMatch(/vam084_grant_recruitment_participation/);
    expect(canonicalBody).not.toMatch(/insert/i);
  });

  it("VAM094 still gates on the predicate, which now derives from the canonical set", () => {
    const vam094 = readFileSync(
      "supabase/migrations/20260904120000_manual_bulk_assignment.sql",
      "utf8"
    );
    expect(vam094).toContain(
      "public.vam084_participant_for_stage(p_reviewer_id, v_season_id, p_review_round)"
    );
    expect(CANONICAL_MIGRATION > "20260904100000_profile_screening_reviewer_eligibility_helper.sql").toBe(true);
    expect(CANONICAL_MIGRATION > "20260903193000_profile_screening_reviewer_eligibility.sql").toBe(true);
  });
});
