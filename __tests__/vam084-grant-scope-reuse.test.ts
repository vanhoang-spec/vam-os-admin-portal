import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Scope-reuse contract for vam084_grant_recruitment_participation.
 *
 * WHAT BROKE ON PRODUCTION (2026-09-04)
 *   Cấp Interviewer succeeded for Super Admin and failed for every active Core
 *   Team / Admin account with:
 *
 *     23505 duplicate key value violates unique constraint
 *           "admin_scope_access_active_scope_key"
 *
 *   The function inserted a `role='review'` scope guarded by an ON CONFLICT
 *   whose target included `role`, while Production also enforces a
 *   role-AGNOSTIC unique index on (user_id, program_id, season_id) among
 *   active rows. An account already holding an active `operations` scope for
 *   the season therefore did not match the DO NOTHING target but did violate
 *   the other index. Super Admin passed only because it had no scope row to
 *   collide with.
 *
 * WHAT THIS SUITE CAN AND CANNOT PROVE
 *   These are contract assertions over the migration SQL. They pin the
 *   decisions that were wrong — reuse instead of stacking, exact-season
 *   matching, the indexes left intact, authorization unchanged — so a future
 *   edit cannot quietly reintroduce the stacking insert.
 *
 *   They do NOT execute PostgreSQL. Behaviour against the real active-scope
 *   indexes is proven by applying the migration to Staging and running the
 *   grant, which is the gate this change is held to before Production.
 */

const MIGRATION = "supabase/migrations/20260904140000_grant_participation_scope_reuse.sql";
const sql = readFileSync(MIGRATION, "utf8");

/**
 * The scope-handling block, isolated from the rest of the function body.
 *
 * Anchored on statements that exist in BOTH the old and new shapes — the end
 * of the admin_users upsert and the start of the membership lookup — so that
 * reverting the fix produces targeted assertion failures rather than a
 * collection-time crash. A suite that cannot run against the broken version is
 * not evidence that it detects the break.
 */
const scopeBlock = (() => {
  const afterAdminUpsert = sql.lastIndexOf("where id = v_admin_id;");
  const beforeMembership = sql.indexOf("select psm.id, psm.status into v_membership_id");
  if (afterAdminUpsert < 0 || beforeMembership <= afterAdminUpsert) return "";
  return sql.slice(afterAdminUpsert, beforeMembership);
})();

describe("vam084_grant_recruitment_participation — scope reuse", () => {
  it("A/B/C. an existing qualifying scope is REUSED, not supplemented", () => {
    // operations (A), full_access (B) and review (C) all qualify.
    expect(scopeBlock).toMatch(
      /count\(\*\) filter \(where asa\.role in \('review','operations','full_access'\)\) > 0/
    );
    expect(scopeBlock).toContain("if v_has_qualifying_scope then");
    // The qualifying branch performs no write at all.
    const qualifyingBranch = scopeBlock.slice(
      scopeBlock.indexOf("if v_has_qualifying_scope then"),
      scopeBlock.indexOf("elsif v_has_active_scope then")
    );
    expect(qualifyingBranch).not.toMatch(/insert\s+into/i);
    expect(qualifyingBranch).not.toMatch(/update\s+public\.admin_scope_access/i);
    expect(qualifyingBranch).not.toMatch(/delete\s+from/i);
  });

  it("D. a review scope is created only when no qualifying scope exists", () => {
    const elseIndex = scopeBlock.lastIndexOf("else");
    expect(elseIndex).toBeGreaterThan(-1);
    const elseBranch = scopeBlock.slice(elseIndex);
    expect(elseBranch).toMatch(/insert into public\.admin_scope_access/);
    expect(elseBranch).toMatch(/'review',\s*'active'/);
    // Exactly one insert into admin_scope_access in the whole function.
    expect(sql.match(/insert into public\.admin_scope_access/g) ?? []).toHaveLength(1);
  });

  it("E. super_admin needs no season scope at all", () => {
    expect(scopeBlock).toContain("if v_target_role is distinct from 'super_admin' then");
    // The role is re-read after the admin_users upsert, so a just-promoted
    // viewer/support_team account is classified on its NEW role.
    expect(sql).toMatch(/select au\.role into v_target_role[\s\S]{0,120}where au\.id = v_admin_id/);
  });

  it("F. a scope for a DIFFERENT season does not count", () => {
    expect(scopeBlock).toMatch(/asa\.season_id = p_season_id::text/);
    expect(scopeBlock).toMatch(/asa\.program_id = v_program_id::text/);
  });

  it("G. an INACTIVE scope does not count", () => {
    expect(scopeBlock).toMatch(/asa\.status = 'active'/);
  });

  it("DUPLICATE_SCOPE_CREATED=NO: the stacking insert and its ON CONFLICT are gone", () => {
    // The old guard targeted an index that Production's role-agnostic index
    // does not match, which is precisely why the insert raised instead of
    // being skipped.
    expect(sql).not.toMatch(/on conflict \(user_id, \(coalesce\(program_id/);
    // A concurrent grant for the other participation role must be absorbed,
    // not surfaced as a 23505.
    expect(scopeBlock).toContain("exception when unique_violation then");
  });

  it("does not drop, alter or weaken either active-scope index", () => {
    expect(sql).not.toMatch(/drop\s+index/i);
    expect(sql).not.toMatch(/alter\s+table\s+public\.admin_scope_access/i);
    expect(sql).not.toMatch(/drop\s+constraint/i);
    expect(sql).not.toMatch(/admin_scope_access_active_scope_key[^\n]*drop/i);
  });

  it("preserves existing operations/full_access scopes unchanged", () => {
    // admin_scope_access is only ever read or inserted into — never updated,
    // never deleted from.
    expect(sql).not.toMatch(/update public\.admin_scope_access/i);
    expect(sql).not.toMatch(/delete from public\.admin_scope_access/i);
  });

  it("does not weaken authorization: every pre-existing check survives verbatim", () => {
    for (const check of [
      "if p_participation_role not in ('reviewer', 'interviewer') then",
      "if not public.vam084_operator_for_season(p_actor, p_season_id) then",
      "raise exception 'Recruitment participation grant rejected'",
      "raise exception 'Recruitment participant identity or season is invalid'",
      "raise exception 'Auth identity is already linked to another account'",
      "raise exception 'Duplicate admin account emails must be reconciled first'",
      "raise exception 'Account email is linked to a different Auth identity'",
      "raise exception 'Existing account role cannot join recruitment'",
      "raise exception 'Inactive privileged accounts require super-admin reactivation'"
    ]) {
      expect(sql).toContain(check);
    }
  });

  it("fails closed when an active scope exists but none of its roles qualify", () => {
    // Silently succeeding would return an account the stage predicates still
    // reject; inserting would violate the active-scope index.
    expect(scopeBlock).toContain("elsif v_has_active_scope then");
    expect(scopeBlock).toMatch(/raise exception 'Account holds a non-qualifying active scope/);
  });

  it("H. the participation membership stays scoped to the target season and role", () => {
    expect(sql).toMatch(/and psm\.season_id = p_season_id/);
    expect(sql).toMatch(/and psm\.role = p_participation_role/);
    expect(sql).toMatch(
      /insert into public\.person_season_memberships[\s\S]{0,400}p_person_id, v_program_id, p_season_id, p_participation_role/
    );
  });

  it("I. creates no duplicate person, admin account or Auth identity", () => {
    expect(sql).not.toMatch(/insert into public\.people/i);
    // admin_users is inserted only on the no-existing-account path, and only
    // from an existing people row.
    expect(sql.match(/insert into public\.admin_users/g) ?? []).toHaveLength(1);
    expect(sql).toMatch(/from public\.people p where p\.id = p_person_id/);
    expect(sql).toMatch(/set auth_user_id = coalesce\(auth_user_id, p_auth_user_id\)/);
  });

  it("preserves the audit log and the membership transition log", () => {
    expect(sql).toMatch(/insert into public\.admin_audit_log/);
    expect(sql).toContain("'operation', 'grant_recruitment_participation'");
    expect(sql).toMatch(/insert into public\.person_season_membership_log/);
  });

  it("stays additive: same name, signature, return type and service_role-only ACL", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.vam084_grant_recruitment_participation/);
    expect(sql).toMatch(/RETURNS uuid/);
    expect(sql).toMatch(/SET search_path TO ''/);
    expect(sql).toMatch(
      /revoke all on function public\.vam084_grant_recruitment_participation\(uuid, uuid, uuid, text, uuid, text\) from public, anon, authenticated/
    );
    expect(sql).toMatch(
      /grant execute on function public\.vam084_grant_recruitment_participation\(uuid, uuid, uuid, text, uuid, text\) to service_role/
    );
    // SECURITY DEFINER would silently widen this function's authority.
    expect(sql).not.toMatch(/security\s+definer/i);
  });

  it("is the latest definition of this function, so it wins on apply", () => {
    const defining = readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .filter((f) =>
        /create or replace function public\.vam084_grant_recruitment_participation/i.test(
          readFileSync(join("supabase/migrations", f), "utf8")
        )
      )
      .sort();
    expect(defining[defining.length - 1]).toBe(
      "20260904140000_grant_participation_scope_reuse.sql"
    );
  });
});
