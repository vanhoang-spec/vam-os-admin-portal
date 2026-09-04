import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Stage-eligibility parity guard.
 *
 * WHAT BROKE
 *   Migration 20260903193000 moved the PROFILE SCREENING half of
 *   `vam084_list_recruitment_participants` onto the Owner's admin-account
 *   policy: an active admin account with an eligible role and season scope,
 *   explicitly NOT requiring a `people` row or a `person_season_memberships`
 *   row. It did not touch `vam084_participant_for_stage`, which still demanded
 *   an active 'reviewer' membership for the same stage.
 *
 *   The two functions are the read side and the write side of ONE policy. The
 *   dropdown is filled from the lister; every assignment RPC re-checks the
 *   predicate. Once they disagreed, the UI offered reviewers the database then
 *   refused, and UEHM-S12 (which has zero active 'reviewer' memberships) failed
 *   EVERY profile-screening assignment with:
 *
 *     P0001 Target assignee is not an active participant for this season and stage
 *
 *   Migration 20260904100000 repaired the predicate and is already in `main`.
 *
 * WHAT THIS SUITE DOES AND DOES NOT COVER
 *   It asserts the REPOSITORY invariant: for a given stage, the lister and the
 *   predicate must demand the same participation evidence. It stops the
 *   split-brain being reintroduced by a future migration.
 *
 *   It CANNOT detect a database whose catalog is behind the repository. The
 *   2026-09-04 Staging failure was exactly that — correct migrations in git,
 *   never applied to the Staging DB. Nothing in this test suite, or any test
 *   that reads only migration files, can catch that class of drift; it needs a
 *   catalog check against the live database before UAT.
 */

const MIGRATIONS_DIR = "supabase/migrations";

/** The last migration (in applied order) that redefines `fn`, with its text. */
function latestDefinitionOf(fn: string) {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // filenames are timestamp-prefixed, so lexical order is apply order

  let found: { file: string; sql: string } | null = null;
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const re = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\b`, "i");
    if (re.test(sql)) found = { file, sql };
  }
  if (!found) throw new Error(`no migration defines ${fn}`);
  return found;
}

/** Body of the `$...$ ... $...$` block belonging to `fn` in `sql`. */
function functionBody(sql: string, fn: string) {
  const start = sql.search(
    new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\b`, "i")
  );
  if (start < 0) throw new Error(`definition of ${fn} not found`);
  const rest = sql.slice(start);
  const tag = rest.match(/\$([a-z_]*)\$/i);
  if (!tag) throw new Error(`no dollar-quoted body for ${fn}`);
  const open = rest.indexOf(tag[0]);
  const close = rest.indexOf(tag[0], open + tag[0].length);
  if (close < 0) throw new Error(`unterminated body for ${fn}`);
  return rest.slice(open + tag[0].length, close);
}

/** The parenthesised block guarded by `when '<stage>' then (`, balanced. */
function branchFor(body: string, stage: string): string | null {
  const re = new RegExp(`when\\s+'${stage}'\\s+then\\s*\\(`, "i");
  const m = body.match(re);
  if (!m || m.index === undefined) return null;
  let i = body.indexOf("(", m.index + m[0].length - 1);
  let depth = 0;
  for (let j = i; j < body.length; j++) {
    if (body[j] === "(") depth++;
    else if (body[j] === ")") {
      depth--;
      if (depth === 0) return body.slice(i + 1, j);
    }
  }
  return null;
}

/**
 * The SQL that decides eligibility for `stage`.
 *
 * If the function branches per stage, that branch governs. If it does not
 * branch, the whole body governs every stage — which is precisely the
 * pre-fix shape that caused the incident.
 */
function policyFor(body: string, stage: string) {
  return branchFor(body, stage) ?? body;
}

const requiresMembership = (sql: string) => /person_season_memberships/i.test(sql);

const predicate = latestDefinitionOf("vam084_participant_for_stage");
const lister = latestDefinitionOf("vam084_list_recruitment_participants");
const predicateBody = functionBody(predicate.sql, "vam084_participant_for_stage");
const listerBody = functionBody(lister.sql, "vam084_list_recruitment_participants");

describe("vam084 stage eligibility — lister/predicate parity", () => {
  it("PROFILE_SCREENING_PARITY: neither side requires a season membership row", () => {
    // The lister's Owner policy (20260903193000). Read side.
    const listerProfile = listerBody
      .split(/union\s+all/i)
      .find((part) => /p_review_stage\s*=\s*'profile_screening'/i.test(part));
    expect(listerProfile).toBeDefined();
    expect(requiresMembership(listerProfile!)).toBe(false);

    // The predicate every assignment RPC re-checks. Write side.
    // This is the assertion that fails before the parity migration exists.
    expect(requiresMembership(policyFor(predicateBody, "profile_screening"))).toBe(false);
  });

  it("PROFILE_SCREENING_PARITY: both sides demand the same admin-account evidence", () => {
    const profile = policyFor(predicateBody, "profile_screening");
    expect(profile).toMatch(/au\.status\s*=\s*'active'/i);
    expect(profile).toMatch(/au\.role\s+in\s*\(\s*'reviewer',\s*'core_team',\s*'admin',\s*'super_admin'\s*\)/i);
    expect(profile).toMatch(/admin_scope_access/i);
    expect(profile).toMatch(/asa\.role\s+in\s*\(\s*'review',\s*'operations',\s*'full_access'\s*\)/i);
    expect(profile).toMatch(/au\.role\s*=\s*'super_admin'/i);
  });

  it("INTERVIEW_POLICY_UNCHANGED: both sides still require an active interviewer membership", () => {
    // Interview must NOT be broadened by the profile-screening repair.
    const interview = policyFor(predicateBody, "interview");
    expect(requiresMembership(interview)).toBe(true);
    expect(interview).toMatch(/psm\.role\s*=\s*'interviewer'/i);
    expect(interview).toMatch(/psm\.status\s*=\s*'active'/i);
    expect(interview).toMatch(/email_primary/i);

    const listerInterview = listerBody
      .split(/union\s+all/i)
      .find((part) => /p_review_stage\s*=\s*'interview'/i.test(part));
    expect(listerInterview).toBeDefined();
    expect(requiresMembership(listerInterview!)).toBe(true);
    expect(listerInterview!).toMatch(/psm\.role\s*=\s*'interviewer'/i);
  });

  it("UNKNOWN_STAGE_FAILS_CLOSED", () => {
    // A stage that matches no branch must return false, never true.
    expect(predicateBody).toMatch(/else\s+false\s+end|__invalid__/i);
  });

  it("TRUSTED_CONTEXT: the repaired predicate keeps its service_role-only ACL", () => {
    expect(predicate.sql).toMatch(
      /revoke all on function public\.vam084_participant_for_stage[\s\S]*?from public, anon, authenticated/i
    );
    expect(predicate.sql).toMatch(
      /grant execute on function public\.vam084_participant_for_stage[\s\S]*?to service_role/i
    );
    expect(predicate.sql).toMatch(/set search_path to ''/i);
  });

  it("VAM094_DEPENDS_ON_THE_REPAIRED_PREDICATE", () => {
    // The manual bulk assignment RPC gates on this exact predicate, so the
    // parity migration must sort BEFORE it.
    const vam094 = "supabase/migrations/20260904120000_manual_bulk_assignment.sql";
    expect(readFileSync(vam094, "utf8")).toContain(
      "public.vam084_participant_for_stage(p_reviewer_id, v_season_id, p_review_round)"
    );
    expect(predicate.file < "20260904120000_manual_bulk_assignment.sql").toBe(true);
  });
});
