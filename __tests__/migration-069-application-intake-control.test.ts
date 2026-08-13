import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  M069_AUDIT_ACTION_TYPE,
  POST_M069_AUDIT_ACTION_TYPES,
  PRE_M069_AUDIT_ACTION_TYPES,
  refusesVocabulary,
  sqlVocabulary,
  vocabularyDrift
} from "./support/m069-audit-vocabulary";

/**
 * M069 migration package — structural assertions.
 *
 * These do not execute SQL. They pin the properties of the package that a
 * careless edit would silently break: that no artifact can open a form, that
 * the audit vocabulary grows by exactly the value the runtime writes, and
 * that the preflight actually refuses on each named condition.
 */

const ROOT = join(__dirname, "..");
const PKG = join(ROOT, "VAM_OS_M069_S12_APPLICATION_INTAKE_CONTROL_20260812");
const MIGRATION = join(ROOT, "supabase_migrations", "069_application_form_controls.sql");

function read(path: string) {
  return readFileSync(path, "utf8");
}

/** SQL with `--` comments removed, so assertions test code and not prose. */
function code(sql: string) {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

/**
 * True when no statement in the file BEGINS with a mutating verb. Matching
 * the verb anywhere would fire on catalog names (`role_table_grants`) and on
 * vocabulary values (`update_event`), which is why this is anchored.
 */
function hasMutatingStatement(sql: string) {
  return code(sql)
    .split("\n")
    .some((line) => /^\s*(create|alter|drop|insert|update|delete|truncate|grant|revoke)\s/i.test(line));
}

const migration = read(MIGRATION);
const preflight = read(join(PKG, "preflight.sql"));
const apply = read(join(PKG, "apply.sql"));
const verifier = read(join(PKG, "verifier.sql"));
const rollback = read(join(PKG, "rollback.sql"));
const README_TXT = read(join(PKG, "README.md"));

const ALL_SQL: Array<[string, string]> = [
  ["migration", migration],
  ["apply", apply],
  ["preflight", preflight],
  ["verifier", verifier],
  ["rollback", rollback]
];

describe("M069 package — artifacts exist", () => {
  it.each([
    "preflight.sql",
    "apply.sql",
    "verifier.sql",
    "rollback.sql",
    "README.md",
    "SHA256SUMS.txt"
  ])("ships %s", (name) => {
    expect(existsSync(join(PKG, name))).toBe(true);
  });

  it("ships the canonical repository migration too", () => {
    expect(existsSync(MIGRATION)).toBe(true);
  });

  it("SHA256SUMS.txt matches every file it inventories", () => {
    const lines = read(join(PKG, "SHA256SUMS.txt")).split("\n").filter(Boolean);
    expect(lines).toHaveLength(5);
    for (const line of lines) {
      const [digest, name] = line.split(/\s+\*?/);
      const actual = createHash("sha256")
        .update(readFileSync(join(PKG, name)))
        .digest("hex");
      expect(`${name}=${actual}`).toBe(`${name}=${digest}`);
    }
  });
});

describe("M069 — no artifact can open a form", () => {
  it.each(ALL_SQL)("%s never writes a state other than closed", (_name, sql) => {
    // The only state literals that may appear in an INSERT/UPDATE value
    // position are 'closed'. 'pilot' and 'open' appear only inside CHECK
    // vocabularies and comparison predicates.
    const insertSeed = sql.match(/insert into public\.application_form_controls[\s\S]*?;/gi) ?? [];
    for (const stmt of insertSeed) {
      expect(stmt).toContain("'closed'");
      expect(stmt).not.toMatch(/,\s*'open'\s*\)/);
      expect(stmt).not.toMatch(/,\s*'pilot'\s*\)/);
    }
  });

  it("the migration seeds both roles as closed", () => {
    expect(migration).toMatch(/cross join \(values \('mentor'\), \('mentee'\)\)/);
    expect(migration).toMatch(/select s\.program_id, s\.id, b\.id, r\.role, 'closed'/);
  });

  it("the seed is exactly-once safe", () => {
    expect(migration).toContain("on conflict (intake_batch_id, applicant_role) do nothing");
    expect(apply).toContain("on conflict (intake_batch_id, applicant_role) do nothing");
  });

  it.each([
    ["migration", migration],
    ["apply", apply]
  ])("%s aborts if any row is left not-closed", (_name, sql) => {
    expect(sql).toMatch(/A migration must never open a form/);
    expect(sql).toMatch(/from public\.application_form_controls where state <> 'closed'/);
  });

  it("the state column defaults to closed", () => {
    expect(migration).toMatch(/state\s+text not null default 'closed'/);
  });
});

describe("M069 — Season 12 binding and S11 protection", () => {
  it.each([
    ["migration", migration],
    ["apply", apply]
  ])("%s seeds only via the UEHM / UEHM-S12 / UEHM-S12-B1 chain", (_name, sql) => {
    expect(sql).toContain("p.code = 'UEHM'");
    expect(sql).toContain("s.code = 'UEHM-S12'");
    expect(sql).toContain("b.code = 'UEHM-S12-B1'");
  });

  it.each(ALL_SQL)("%s never writes to a Season 11 object", (_name, sql) => {
    // S11 may only appear inside a refusal guard, never as a target.
    const s11Lines = sql.split("\n").filter((line) => /S11/.test(line));
    for (const line of s11Lines) {
      expect(line).toMatch(/refuse|reject|abort|not|like '%S11%'|--/i);
    }
  });

  it("the preflight refuses if the S12 intake resolves to an S11 season", () => {
    expect(preflight).toContain("[S11_BINDING]");
  });

  it("the verifier proves no control row references a Season 11 season", () => {
    expect(verifier).toContain("V18");
    expect(verifier).toContain("no control row references any Season 11 object");
  });
});

describe("M069 — preflight refusal conditions", () => {
  it.each([
    "[ENV_NOT_PRODUCTION]",
    "[SEASON_MISSING]",
    "[BATCH_MISSING]",
    "[S11_BINDING]",
    "[ALREADY_APPLIED]",
    "[AUDIT_TABLE_MISSING]",
    "[AUDIT_COLUMNS]",
    "[AUDIT_ACTION_NOT_NULL]",
    "[AUDIT_VOCAB_MISSING]",
    "[AUDIT_VOCAB_UNEXPECTED]",
    "[ADMIN_USERS_MISSING]",
    "[FUNCTION_PRESENT]",
    "[CONFLICTING_ROWS]"
  ])("refuses on %s", (token) => {
    expect(preflight).toContain(token);
  });

  it("is read-only — no statement begins with a mutating verb", () => {
    expect(hasMutatingStatement(preflight)).toBe(false);
  });

  it("emits a pass token and an audit column seal", () => {
    expect(preflight).toContain("preflight_token");
    expect(preflight).toContain("audit_column_seal");
  });

  it("documents the expected token for the reviewed baseline", () => {
    // Versioned when the vocabulary proof became an exact set comparison:
    // VOCAB52EXACT is emitted only when the admitted set is set-equal to the
    // canonical 52, where the old field emitted 52 for ANY 52-value list.
    expect(preflight).toContain("M069:ABSENT:VOCAB52EXACT:VALIDATED:NULLABLE4:S12OK");
    expect(preflight).not.toContain("M069:ABSENT:52:VALIDATED");
  });

  it("emits VOCABDRIFT, and names the offending values, when the set is not exact", () => {
    expect(preflight).toContain("VOCABDRIFT");
    expect(preflight).toContain("audit_vocab_missing");
    expect(preflight).toContain("audit_vocab_unexpected");
    expect(preflight).toContain("audit_vocab_seal");
  });
});

describe("M069 — apply does not assume preflight ran", () => {
  it("re-asserts the environment inside its own transaction", () => {
    expect(apply).toContain("Section 0");
    expect(apply).toContain("[ENV_NOT_PRODUCTION]");
    expect(apply).toContain("[AUDIT_COLUMNS]");
    expect(apply).toContain("[AUDIT_ACTION_NOT_NULL]");
    expect(apply).toContain("[S12_BINDING]");
    expect(apply).toContain("[BATCH_AMBIGUOUS]");
  });

  it("runs as a single transaction", () => {
    expect(apply.trimStart().startsWith("--") || apply.includes("begin;")).toBe(true);
    expect(apply).toContain("begin;");
    expect(apply.trimEnd().endsWith("commit;")).toBe(true);
  });

  it("pins lock and statement timeouts", () => {
    expect(apply).toContain("set local statement_timeout");
    expect(apply).toContain("set local lock_timeout");
    expect(apply).toContain("set local timezone          = 'UTC'");
  });

  it("reloads the PostgREST schema cache", () => {
    expect(apply).toContain("notify pgrst, 'reload schema'");
    expect(migration).toContain("notify pgrst, 'reload schema'");
  });
});

describe("M069 — the table is locked down", () => {
  it.each([
    ["migration", migration],
    ["apply", apply]
  ])("%s enables RLS and adds no policy", (_name, sql) => {
    expect(sql).toContain("enable row level security");
    expect(sql).not.toMatch(/create policy/i);
  });

  it.each([
    ["migration", migration],
    ["apply", apply]
  ])("%s revokes from public, anon and authenticated", (_name, sql) => {
    for (const role of ["public", "anon", "authenticated"]) {
      expect(sql).toContain(`revoke all on public.application_form_controls from ${role}`);
    }
  });

  it.each([
    ["migration", migration],
    ["apply", apply]
  ])("%s grants execute on the mutation function to service_role only", (_name, sql) => {
    expect(sql).toMatch(/grant execute on function public\.vam069_set_application_form_state[\s\S]*?to service_role/);
    expect(sql).not.toMatch(/grant execute[\s\S]{0,200}to (anon|authenticated|public)/i);
  });

  it("the verifier proves RLS on, zero policies, and no web-role grant", () => {
    expect(verifier).toContain("RLS enabled on the control table");
    expect(verifier).toContain("zero RLS policies on the control table");
    expect(verifier).toContain("no anon/authenticated/PUBLIC grant on the control table");
    expect(verifier).toContain("no anon/authenticated/PUBLIC execute on the mutation function");
  });
});

describe("M069 — audit compatibility with the post-release Production schema", () => {
  it("extends the vocabulary rather than assuming one", () => {
    expect(migration).toContain("set_application_form_state");
    expect(migration).toContain("drop constraint admin_audit_log_action_type_check");
    expect(migration).toContain("add constraint admin_audit_log_action_type_check");
  });

  it("installs exactly 53 values", () => {
    const block = migration.slice(
      migration.indexOf("add constraint admin_audit_log_action_type_check")
    );
    const values = new Set(
      (block.slice(0, block.indexOf("]")).match(/'[a-z_]+'/g) ?? []).map((v) => v.slice(1, -1))
    );
    expect(values.size).toBe(53);
    expect(values.has("set_application_form_state")).toBe(true);
  });

  it("preserves every one of the 52 release values", () => {
    const RELEASE_52 = [
      "accept_registration_proof","add_event_participation","add_manual_recap","add_membership_role",
      "approve_application_as_mentee","approve_application_as_mentor","bulk_add_event_participants",
      "cancel_event","cancel_event_registration","cancel_match","cancel_membership",
      "close_event_registration","confirm_event_registration","confirm_registration_payment",
      "create_action_item","create_admin_user","create_event","create_event_checkin_link",
      "create_event_registration_link","create_manual_match","create_membership","create_mentee_profile",
      "create_mentor_profile","deactivate_admin_user","edit_recap","import_participant_membership",
      "link_person_auth","open_event_registration","opt_out_membership","pause_membership",
      "reactivate_admin_user","reactivate_membership","reconcile_person_auth","reject_event_registration",
      "reject_registration_payment","reject_registration_proof","remove_admin_access",
      "remove_event_participation","remove_membership_role","soft_delete_recap","sync_auth","unknown",
      "update_action_item","update_admin_user","update_admin_user_access","update_event",
      "update_event_participation","update_mentee_profile","update_mentor_profile",
      "update_registration_review_note","waitlist_event_registration","withdraw_membership"
    ];
    expect(RELEASE_52).toHaveLength(52);
    for (const value of RELEASE_52) {
      expect(migration).toContain(`'${value}'`);
    }
  });

  it("does not reuse the event-registration vocabulary for form state", () => {
    // open_event_registration / close_event_registration are about EVENTS.
    // Reusing them would corrupt every event audit query.
    const rpcBlock = migration.slice(migration.indexOf("insert into public.admin_audit_log"));
    expect(rpcBlock).not.toContain("open_event_registration");
    expect(rpcBlock).not.toContain("close_event_registration");
  });

  it("populates the legacy NOT-NULL-prone `action` column", () => {
    expect(migration).toMatch(/insert into public\.admin_audit_log \([\s\S]*?\baction\b/);
  });

  it("records every field the audit contract requires", () => {
    const rpcBlock = migration.slice(migration.indexOf("insert into public.admin_audit_log"));
    for (const field of [
      "applicant_role",
      "previous_state",
      "new_state",
      "program_id",
      "season_id",
      "intake_batch_id",
      "actor_admin_user_id",
      "changed_at"
    ]) {
      expect(rpcBlock).toContain(field);
    }
  });

  it("writes the audit row in the SAME transaction as the state change", () => {
    const fn = migration.slice(
      migration.indexOf("create or replace function public.vam069_set_application_form_state")
    );
    const updateAt = fn.indexOf("update public.application_form_controls");
    const auditAt = fn.indexOf("insert into public.admin_audit_log");
    expect(updateAt).toBeGreaterThan(-1);
    expect(auditAt).toBeGreaterThan(updateAt);
    // No COMMIT between them — the whole function body is one transaction.
    expect(fn.slice(updateAt, auditAt)).not.toMatch(/\bcommit\b/i);
  });

  it.each(ALL_SQL)("%s has no executable reference to the pilot token", (_name, sql) => {
    // `preflight_token` is the emitted pass token, unrelated to the secret.
    // Anything else matching /token/ in executable SQL would mean a secret
    // reached the database layer.
    const executable = code(sql).replace(/preflight_token/g, "");
    expect(executable).not.toMatch(/token/i);
  });

  it("the mutation function takes no token parameter", () => {
    const signature = migration.slice(
      migration.indexOf("create or replace function public.vam069_set_application_form_state"),
      migration.indexOf("returns table (")
    );
    expect(signature).not.toMatch(/token/i);
    expect(signature).toContain("p_actor_admin_user_id");
    expect(signature).toContain("p_applicant_role");
    expect(signature).toContain("p_new_state");
  });
});

describe("M069 — the mutation function's own guarantees", () => {
  const fn = migration.slice(
    migration.indexOf("create or replace function public.vam069_set_application_form_state")
  );

  it("is SECURITY DEFINER with a pinned search_path", () => {
    expect(fn).toContain("security definer");
    expect(fn).toContain("set search_path = public, pg_temp");
  });

  it("re-checks the actor is active and permitted, independently of the caller", () => {
    expect(fn).toContain("v_actor.status <> 'active'");
    expect(fn).toContain("array['super_admin', 'admin']");
    expect(fn).toContain("42501");
  });

  it("does NOT admit core_team", () => {
    const authBlock = fn.slice(fn.indexOf("v_actor.role"), fn.indexOf("42501"));
    expect(authBlock).not.toContain("core_team");
  });

  it("locks the control row FOR UPDATE before deciding", () => {
    expect(fn).toContain("for update");
    expect(fn.indexOf("for update")).toBeLessThan(fn.indexOf("update public.application_form_controls"));
  });

  it("enforces optimistic concurrency against a stale admin page", () => {
    expect(fn).toContain("state changed since page load");
    expect(fn).toContain("40001");
  });

  it("rejects an unsupported state or role before doing anything", () => {
    expect(fn).toContain("unsupported target state");
    expect(fn).toContain("unsupported applicant role");
  });

  it("returns a no-op instead of writing a duplicate audit row", () => {
    expect(fn).toContain("'noop'");
  });
});

describe("M069 — verifier completeness", () => {
  it.each(["V01","V02","V03","V04","V05","V06","V07","V08","V09","V10","V11","V12","V13","V14","V15","V16","V17","V18"])(
    "includes check %s",
    (id) => {
      expect(verifier).toContain(`'${id}'`);
    }
  );

  it("proves both controls exist and both are CLOSED", () => {
    expect(verifier).toContain("exactly 2 control rows for UEHM-S12-B1");
    expect(verifier).toContain("every control row is CLOSED");
  });

  it("proves uniqueness is enforced by an index", () => {
    expect(verifier).toContain("application_form_controls_batch_role_key");
  });

  it("is read-only — no statement begins with a mutating verb", () => {
    expect(hasMutatingStatement(verifier)).toBe(false);
  });
});

describe("M069 — rollback safety", () => {
  it("refuses to run while any form is not closed", () => {
    expect(rollback).toContain("[FORM_NOT_CLOSED]");
  });

  it("states plainly that rollback leaves both forms CLOSED", () => {
    expect(rollback).toMatch(/resolve CLOSED|forms .*CLOSED|CLOSES IT/);
  });

  it("never deletes audit history to satisfy a constraint", () => {
    expect(rollback).not.toMatch(/delete from public\.admin_audit_log/i);
    expect(rollback).toContain("audit history is not deleted to satisfy a constraint");
  });

  it("restores exactly the 52-value release vocabulary", () => {
    const block = rollback.slice(rollback.indexOf("add constraint admin_audit_log_action_type_check"));
    const values = new Set(
      (block.slice(0, block.indexOf("]")).match(/'[a-z_]+'/g) ?? []).map((v) => v.slice(1, -1))
    );
    expect(values.size).toBe(52);
    expect(values.has("set_application_form_state")).toBe(false);
  });

  it("drops the table, the trigger function and the mutation function", () => {
    expect(rollback).toContain("drop table if exists public.application_form_controls");
    expect(rollback).toContain("drop function if exists public.vam069_assert_control_binding");
    expect(rollback).toContain("drop function if exists public.vam069_set_application_form_state");
  });
});

// ===========================================================================
// R2 — the three independent-review MEDIUMs
//
// These assertions are STATIC: no Postgres runs here, and none may (running
// Production SQL is out of scope for this repository's test suite). What they
// prove is the specification each guard implements — the set algebra, the
// catalog columns read, the refusal tag raised — and that every copy of the
// canonical vocabulary in the package agrees with one source of truth. The
// adversarial cases below drive the SAME set comparison the SQL performs
// (`expected EXCEPT actual` and `actual EXCEPT expected`, both empty) through
// `refusesVocabulary`, and separately prove the SQL computes both directions.
// ===========================================================================

/** Every `array[...]` literal that follows an occurrence of `marker`. */
function arraysAfter(sql: string, marker: string): string[][] {
  const out: string[][] = [];
  let at = sql.indexOf(marker);
  while (at !== -1) {
    const open = sql.indexOf("array[", at);
    const close = sql.indexOf("]", open);
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
    out.push(sqlVocabulary(sql.slice(open, close)));
    at = sql.indexOf(marker, at + marker.length);
  }
  return out;
}

/** Bracketed refusal tags, e.g. `[AUDIT_VOCAB_UNEXPECTED]`. */
function tagsIn(sql: string): Set<string> {
  return new Set((sql.match(/\[[A-Z][A-Z0-9_]+\]/g) ?? []).map((t) => t.slice(1, -1)));
}

const APPLY_SECTION_0 = apply.slice(
  apply.indexOf("do $m069_guard$"),
  apply.indexOf("$m069_guard$;") + "$m069_guard$;".length
);

/** Every place in the package that spells out the pre-M069 52. */
const CANONICAL_52_COPIES: Array<[string, string[]]> = [
  ...arraysAfter(preflight, "v_expected_vocab constant text[] :=").map(
    (v, i) => [`preflight guard #${i + 1}`, v] as [string, string[]]
  ),
  ...arraysAfter(preflight, "expected_vocab(value) as (").map(
    (v, i) => [`preflight token CTE #${i + 1}`, v] as [string, string[]]
  ),
  ...arraysAfter(apply, "v_expected_vocab constant text[] :=").map(
    (v, i) => [`apply guard #${i + 1}`, v] as [string, string[]]
  ),
  ...arraysAfter(migration, "v_expected_vocab constant text[] :=").map(
    (v, i) => [`migration guard #${i + 1}`, v] as [string, string[]]
  ),
  ...arraysAfter(verifier, "expected_vocab(value) as (").map(
    (v, i) => [`verifier CTE #${i + 1}`, v] as [string, string[]]
  )
];

describe("M069 R2 — ONE canonical 52-value vocabulary, proven identical everywhere", () => {
  it("the canonical list is the exact vocabulary the S12 release T1 installed", () => {
    const t1 = read(
      join(ROOT, "VAM_OS_PROD_S12_RELEASE_20260809", "apply", "T1_audit_action_type_compat.sql")
    );
    const block = t1.slice(t1.indexOf("add constraint admin_audit_log_action_type_check"));
    const installed = sqlVocabulary(block.slice(0, block.indexOf("]")));
    expect(installed).toHaveLength(52);
    expect(installed).toEqual([...PRE_M069_AUDIT_ACTION_TYPES].sort());
  });

  it("finds a copy of the 52 in preflight, apply, the migration and the verifier", () => {
    const names = CANONICAL_52_COPIES.map(([name]) => name);
    expect(names.some((n) => n.startsWith("preflight guard"))).toBe(true);
    expect(names.some((n) => n.startsWith("preflight token CTE"))).toBe(true);
    // apply carries two: Section 0 and Section 4.
    expect(names.filter((n) => n.startsWith("apply guard"))).toHaveLength(1 + 1);
    expect(names.filter((n) => n.startsWith("migration guard"))).toHaveLength(1);
    // verifier carries two: the checks CTE and the summary CTE.
    expect(names.filter((n) => n.startsWith("verifier CTE"))).toHaveLength(2);
  });

  it.each(CANONICAL_52_COPIES)("%s is set-equal to the canonical 52", (_name, values) => {
    const { missing, unexpected } = vocabularyDrift(PRE_M069_AUDIT_ACTION_TYPES, values);
    expect({ missing, unexpected }).toEqual({ missing: [], unexpected: [] });
    expect(values).toHaveLength(52);
    expect(values).not.toContain(M069_AUDIT_ACTION_TYPE);
  });

  it.each([
    ["migration", migration],
    ["apply", apply]
  ])("%s installs exactly the canonical 52 plus set_application_form_state", (_name, sql) => {
    const block = sql.slice(sql.indexOf("add constraint admin_audit_log_action_type_check"));
    const installed = sqlVocabulary(block.slice(0, block.indexOf("]")));
    expect(installed).toEqual([...POST_M069_AUDIT_ACTION_TYPES]);
    expect(installed).toHaveLength(53);
  });

  it("rollback restores exactly the canonical 52 and nothing else", () => {
    const block = rollback.slice(rollback.indexOf("add constraint admin_audit_log_action_type_check"));
    const restored = sqlVocabulary(block.slice(0, block.indexOf("]")));
    expect(restored).toEqual([...PRE_M069_AUDIT_ACTION_TYPES].sort());
  });

  it("points every SQL copy at the one TypeScript source of truth", () => {
    for (const sql of [preflight, apply, migration, verifier]) {
      expect(sql).toContain("__tests__/support/m069-audit-vocabulary.ts");
    }
  });
});

// ---------------------------------------------------------------------------
// MEDIUM 1 — preflight proves the exact vocabulary, not a count
// ---------------------------------------------------------------------------

describe("M069 R2 / MEDIUM 1 — preflight proves SET EQUALITY, not a count", () => {
  it("compares in BOTH directions and names what is missing and what is extra", () => {
    // expected \ actual
    expect(preflight).toContain("from unnest(v_expected_vocab) x");
    expect(preflight).toContain("where x <> all (coalesce(v_actual_vocab, array[]::text[]))");
    // actual \ expected — coalesced so an unparseable/empty list yields the
    // full missing set rather than a vacuously empty comparison.
    expect(preflight).toContain("from unnest(coalesce(v_actual_vocab, array[]::text[])) x");
    expect(preflight).toContain("where x <> all (v_expected_vocab)");
    expect(preflight).toContain("v_missing is not null or v_unexpected is not null");
    expect(preflight).toContain("MISSING (expected, not present)");
    expect(preflight).toContain("UNEXPECTED (present, not expected)");
  });

  it("derives the actual set from pg_get_constraintdef, not from a count", () => {
    expect(preflight).toContain("pg_get_constraintdef");
    expect(preflight).toContain("select array_agg(distinct m[1]) into v_actual_vocab");
  });

  it("proves the parse is complete before trusting the parsed set", () => {
    // Every quote character in the definition must belong to a captured
    // 'value'::text element, or the definition was not fully understood.
    expect(preflight).toContain("v_quote_n := length(v_def) - length(replace(v_def, '''', ''))");
    expect(preflight).toContain("if v_quote_n <> 2 * v_raw_n then");
    expect(preflight).toContain("v_def not ilike '%= ANY (ARRAY[%'");
  });

  it("refuses a duplicate value inside the list", () => {
    expect(preflight).toContain("v_raw_n <> coalesce(array_length(v_actual_vocab, 1), 0)");
    expect(preflight).toContain("the vocabulary contains duplicates");
  });

  it("does not depend on the constraint NAME to find the vocabulary", () => {
    // The constraint is located by definition (any CHECK mentioning
    // action_type); the name is then asserted, not assumed.
    expect(preflight).toContain("pg_get_constraintdef(c.oid) ilike '%action_type%'");
    expect(preflight).toContain("v_conname is distinct from v_vocab_conname");
    expect(preflight).toContain("CHECK constraints govern action_type");
  });

  it("refuses a NOT VALID vocabulary", () => {
    expect(preflight).toContain("[AUDIT_VOCAB_NOT_VALIDATED]");
    expect(preflight).toContain("v_validated is not true");
  });

  it.each([
    "[AUDIT_VOCAB_SHAPE]",
    "[AUDIT_VOCAB_NOT_VALIDATED]",
    "[AUDIT_VOCAB_M069_PRESENT]",
    "[ADMIN_USERS_COLUMNS]",
    "[ADMIN_USERS_KEY]",
    "[PARTIAL_M069]",
    "[PROGRAM_MISSING]",
    "[PROGRAM_AMBIGUOUS]",
    "[SEASON_AMBIGUOUS]",
    "[SEASON_PARENT]",
    "[BATCH_AMBIGUOUS]",
    "[BATCH_PARENT]"
  ])("adds refusal condition %s", (tag) => {
    expect(preflight).toContain(tag);
  });
});

/**
 * The ten adversarial baselines the review named. Each one is either a
 * vocabulary mutation — driven through the same set comparison the SQL
 * performs — or a catalog condition, for which the guard's predicate and
 * refusal tag are pinned. Every case is asserted against preflight.sql AND
 * against apply.sql Section 0, because Section 0 must refuse independently.
 */
const VOCAB_ADVERSARIES: Array<[string, string[]]> = [
  [
    "1. 52 values but one expected value replaced by a different one",
    PRE_M069_AUDIT_ACTION_TYPES.map((v) => (v === "cancel_match" ? "cancel_matches" : v))
  ],
  [
    "2a. 52 values but one expected value missing and one unexpected added",
    [...PRE_M069_AUDIT_ACTION_TYPES.filter((v) => v !== "sync_auth"), "sync_authentication"]
  ],
  [
    "2b. one expected value simply missing (51)",
    PRE_M069_AUDIT_ACTION_TYPES.filter((v) => v !== "approve_application_as_mentor")
  ],
  [
    "2c. one unexpected value simply added (53)",
    [...PRE_M069_AUDIT_ACTION_TYPES, "delete_everything"]
  ],
  [
    "3. the M069 value is already present",
    [...PRE_M069_AUDIT_ACTION_TYPES, M069_AUDIT_ACTION_TYPE]
  ],
  [
    "3b. the M069 value is present in place of a release value (still 52)",
    [
      ...PRE_M069_AUDIT_ACTION_TYPES.filter((v) => v !== "unknown"),
      M069_AUDIT_ACTION_TYPE
    ]
  ]
];

describe("M069 R2 / MEDIUM 1 — adversarial baselines the vocabulary gate must refuse", () => {
  it("the canonical 52 itself passes, so the gate is not vacuously refusing", () => {
    expect(refusesVocabulary(PRE_M069_AUDIT_ACTION_TYPES, [...PRE_M069_AUDIT_ACTION_TYPES])).toBe(
      false
    );
    // Order is irrelevant to a set comparison; a count check would also pass
    // here, which is exactly why a count check is not enough.
    expect(
      refusesVocabulary(PRE_M069_AUDIT_ACTION_TYPES, [...PRE_M069_AUDIT_ACTION_TYPES].reverse())
    ).toBe(false);
  });

  it.each(VOCAB_ADVERSARIES)("refuses %s", (label, actual) => {
    expect(refusesVocabulary(PRE_M069_AUDIT_ACTION_TYPES, actual)).toBe(true);
    // Cases 1, 3b hold exactly 52 values: a count check would have passed them.
    if (actual.length === 52) {
      expect(label).toBeTruthy();
      const { missing, unexpected } = vocabularyDrift(PRE_M069_AUDIT_ACTION_TYPES, actual);
      expect(missing.length).toBeGreaterThan(0);
      expect(unexpected.length).toBeGreaterThan(0);
    }
  });

  it("case 3 is caught by its own tag before the generic set comparison", () => {
    for (const [name, sql] of [
      ["preflight", preflight],
      ["apply Section 0", APPLY_SECTION_0]
    ] as const) {
      expect(sql, name).toContain("[AUDIT_VOCAB_M069_PRESENT]");
      expect(sql, name).toContain("if v_m069_value = any (v_actual_vocab) then");
    }
  });
});

const CATALOG_ADVERSARIES: Array<[string, string, string]> = [
  ["4. wrong UEHM-S12 program parent", "[SEASON_PARENT]", "v_season_program_id is distinct from v_program_id"],
  ["5. duplicate UEHM-S12", "[SEASON_AMBIGUOUS]", "from public.seasons where code = 'UEHM-S12'"],
  ["6. duplicate UEHM-S12-B1", "[BATCH_AMBIGUOUS]", "from public.intake_batches where code = 'UEHM-S12-B1'"],
  ["7. batch code correct but season wrong", "[BATCH_PARENT]", "v_batch_season_id is distinct from v_season_id"],
  ["8a. admin_users absent", "[ADMIN_USERS_MISSING]", "to_regclass('public.admin_users') is null"],
  ["8b. admin_users authorization columns absent or mistyped", "[ADMIN_USERS_COLUMNS]", "v_cols is distinct from v_admin_user_cols"],
  ["8c. admin_users.id is not a key", "[ADMIN_USERS_KEY]", "c.contype in ('p','u')"],
  ["9a. audit column set changed", "[AUDIT_COLUMNS]", "v_cols is distinct from v_audit_cols"],
  ["9b. audit nullability assumption changed", "[AUDIT_ACTION_NOT_NULL]", "a.attnotnull and a.atthasdef is false"],
  ["10a. M069 table already exists", "[ALREADY_APPLIED]", "to_regclass('public.application_form_controls') is not null"],
  ["10b. an M069 function already exists", "[FUNCTION_PRESENT]", "p.proname like 'vam069\\_%'"],
  ["10c. a partial M069 relation/trigger/constraint exists", "[PARTIAL_M069]", "c.relname like 'application\\_form\\_controls%'"]
];

describe("M069 R2 / MEDIUM 1 — catalog baselines the preflight must refuse", () => {
  it.each(CATALOG_ADVERSARIES)("refuses %s with %s", (_label, tag, predicate) => {
    expect(preflight).toContain(tag);
    expect(preflight).toContain(predicate);
  });

  it("proves exactly-one cardinality at every level of the chain", () => {
    for (const level of [
      "from public.programs where code = 'UEHM'",
      "from public.seasons where code = 'UEHM-S12'",
      "from public.intake_batches where code = 'UEHM-S12-B1'"
    ]) {
      expect(preflight).toContain(`select count(*) into v_n ${level}`);
    }
    // Within the chain section: one "is it absent" and one "is it ambiguous"
    // guard for each of program, season and intake batch.
    const chainSection = preflight.slice(
      preflight.indexOf("4. Program / season / intake"),
      preflight.indexOf("5. Audit prerequisites")
    );
    expect((chainSection.match(/if v_n = 0 then/g) ?? []).length).toBe(3);
    expect((chainSection.match(/if v_n > 1 then/g) ?? []).length).toBe(3);
  });

  it("is still read-only after the strengthening", () => {
    expect(hasMutatingStatement(preflight)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MEDIUM 2 — apply Section 0 is self-contained
// ---------------------------------------------------------------------------

describe("M069 R2 / MEDIUM 2 — apply Section 0 stands alone", () => {
  it("no longer claims that preflight must have passed", () => {
    expect(apply).not.toMatch(/preflight\.sql MUST\s+have passed/i);
    expect(apply).toContain("THIS FILE DOES NOT DEPEND ON preflight.sql HAVING BEEN RUN");
    expect(README_TXT).not.toMatch(/preflight\.sql MUST have passed/i);
  });

  it("re-asserts every refusal condition the standalone preflight tests", () => {
    const preflightTags = tagsIn(preflight);
    const sectionTags = tagsIn(APPLY_SECTION_0);
    const notReasserted = Array.from(preflightTags)
      .filter((t) => !sectionTags.has(t))
      .sort();
    expect(notReasserted).toEqual([]);
  });

  it.each([
    ["A. environment identity", "[ENV_NOT_PRODUCTION]"],
    ["B. admin_users exists", "[ADMIN_USERS_MISSING]"],
    ["B. admin_users columns", "[ADMIN_USERS_COLUMNS]"],
    ["B. admin_users key", "[ADMIN_USERS_KEY]"],
    ["C. table absent", "[ALREADY_APPLIED]"],
    ["C. functions absent", "[FUNCTION_PRESENT]"],
    ["C. no partial surface", "[PARTIAL_M069]"],
    ["D. one UEHM", "[PROGRAM_AMBIGUOUS]"],
    ["D. one UEHM-S12", "[SEASON_AMBIGUOUS]"],
    ["D. UEHM-S12 parent", "[SEASON_PARENT]"],
    ["D. one UEHM-S12-B1", "[BATCH_AMBIGUOUS]"],
    ["D. UEHM-S12-B1 parent", "[BATCH_PARENT]"],
    ["D. no S11 confusion", "[S11_BINDING]"],
    ["D. one resolved chain", "[S12_BINDING]"],
    ["E. audit table", "[AUDIT_TABLE_MISSING]"],
    ["E. audit columns", "[AUDIT_COLUMNS]"],
    ["E. audit nullability", "[AUDIT_ACTION_NOT_NULL]"],
    ["E. vocabulary present", "[AUDIT_VOCAB_MISSING]"],
    ["E. vocabulary shape", "[AUDIT_VOCAB_SHAPE]"],
    ["E. vocabulary validated", "[AUDIT_VOCAB_NOT_VALIDATED]"],
    ["E. M069 value absent", "[AUDIT_VOCAB_M069_PRESENT]"],
    ["E. exact 52 set equality", "[AUDIT_VOCAB_UNEXPECTED]"],
    ["F. no conflicting rows", "[CONFLICTING_ROWS]"]
  ])("Section 0 covers %s via %s", (_what, tag) => {
    expect(APPLY_SECTION_0).toContain(tag);
  });

  it.each(CATALOG_ADVERSARIES)("Section 0 independently refuses %s (%s)", (_label, tag, predicate) => {
    expect(APPLY_SECTION_0).toContain(tag);
    expect(APPLY_SECTION_0).toContain(predicate);
  });

  it("Section 0 carries the same both-direction vocabulary comparison", () => {
    expect(APPLY_SECTION_0).toContain("from unnest(v_expected_vocab) x");
    expect(APPLY_SECTION_0).toContain("where x <> all (coalesce(v_actual_vocab, array[]::text[]))");
    expect(APPLY_SECTION_0).toContain("from unnest(coalesce(v_actual_vocab, array[]::text[])) x");
    expect(APPLY_SECTION_0).toContain("where x <> all (v_expected_vocab)");
    expect(APPLY_SECTION_0).toContain("MISSING (expected, not present)");
    expect(APPLY_SECTION_0).toContain("UNEXPECTED (present, not expected)");
  });

  it("runs entirely before the first mutation", () => {
    const lines = apply.split("\n");
    const guardEndLine = lines.findIndex((line) => line.includes("$m069_guard$;"));
    const firstMutationLine = lines.findIndex((line) =>
      /^\s*(create|alter|drop|insert|update|delete|truncate|grant|revoke)\s/i.test(
        line.replace(/--.*$/, "")
      )
    );
    expect(guardEndLine).toBeGreaterThan(-1);
    expect(firstMutationLine).toBeGreaterThan(guardEndLine);
  });

  it("still opens the transaction before Section 0, so a refusal rolls back", () => {
    expect(apply.indexOf("begin;")).toBeLessThan(apply.indexOf("do $m069_guard$"));
  });

  it("Section 4 proves the list it replaces is the canonical 52 before dropping it", () => {
    for (const [name, sql] of [
      ["apply", apply],
      ["migration", migration]
    ] as const) {
      const vocabBlock = sql.slice(sql.indexOf("do $vocab$"), sql.indexOf("$vocab$;"));
      const dropAt = vocabBlock.indexOf("drop constraint admin_audit_log_action_type_check");
      const proofAt = vocabBlock.indexOf("[AUDIT_VOCAB_UNEXPECTED]");
      expect(proofAt, name).toBeGreaterThan(-1);
      expect(proofAt, name).toBeLessThan(dropAt);
      expect(vocabBlock, name).toContain("[AUDIT_VOCAB_SHAPE]");
      // and re-proves the result afterwards
      expect(vocabBlock.indexOf("[AUDIT_VOCAB_POST]"), name).toBeGreaterThan(dropAt);
    }
  });

  it("keeps apply.sql = the canonical migration + Section 0 and header only", () => {
    const from = "-- ── 1. The control table";
    expect(apply.slice(apply.indexOf(from))).toBe(migration.slice(migration.indexOf(from)));
  });
});

// ---------------------------------------------------------------------------
// MEDIUM 3 — the verifier proves the actual post-apply objects
// ---------------------------------------------------------------------------

describe("M069 R2 / MEDIUM 3 — verifier proves definitions, not names", () => {
  it.each(["V19", "V20", "V21", "V22", "V23", "V24"])("adds check %s", (id) => {
    expect(verifier).toContain(`'${id}'`);
  });

  it("declares 24 checks", () => {
    expect(verifier).toContain("24 checks");
    expect(verifier).toContain("Expect: 24 checks, 0 failures");
  });

  it("11 — a same-named applicant_role CHECK with wrong values FAILs (V07 reads the expression)", () => {
    expect(verifier).toContain("applicant_role CHECK expression admits exactly mentor+mentee");
    expect(verifier).toContain("bool_and(v.vals = array['mentee','mentor'])");
    expect(verifier).toContain("pg_get_constraintdef(c.oid) ilike '%applicant_role%'");
  });

  it("12 — a same-named state CHECK with wrong values FAILs (V08 reads the expression)", () => {
    expect(verifier).toContain("state CHECK expression admits exactly closed+pilot+open");
    expect(verifier).toContain("bool_and(v.vals = array['closed','open','pilot'])");
  });

  it("13/14 — a same-named trigger on the wrong function or with wrong timing FAILs", () => {
    expect(verifier).toContain("fn.proname = 'vam069_assert_control_binding'");
    expect(verifier).toContain("join pg_proc fn on fn.oid = t.tgfoid");
    expect(verifier).toContain("t.tgrelid = to_regclass('public.application_form_controls')");
    for (const bit of ["(t.tgtype & 1) = 1", "(t.tgtype & 2) = 2", "(t.tgtype & 4) = 4", "(t.tgtype & 16) = 16"]) {
      expect(verifier).toContain(bit);
    }
    for (const bit of ["(t.tgtype & 8) = 0", "(t.tgtype & 32) = 0", "(t.tgtype & 64) = 0"]) {
      expect(verifier).toContain(bit);
    }
    expect(verifier).toContain("t.tgenabled = 'O'");
  });

  it("14 — the trigger FUNCTION identity and body are proven too (V19)", () => {
    expect(verifier).toContain("binding trigger function is the intended SECURITY DEFINER body");
    expect(verifier).toContain("f.prorettype = 'pg_catalog.trigger'::regtype");
    expect(verifier).toContain("f.prosrc like '%does not own intake_batch%'");
    expect(verifier).toContain("f.prosrc like '%does not own season%'");
    expect(verifier).toContain("md5(f.prosrc)");
  });

  it("15 — a same-named RPC with a different signature FAILs (V13)", () => {
    expect(verifier).toContain("pg_get_function_identity_arguments(p.oid)");
    expect(verifier).toContain("r.arg_signature = 'uuid, text, text, text, text'");
    expect(verifier).toContain("r.schema_name = 'public'");
    expect(verifier).toContain("r.fn_name = 'vam069_set_application_form_state'");
  });

  it("15b — the RPC result contract is proven (V20)", () => {
    expect(verifier).toContain("pg_get_function_result(p.oid)");
    expect(verifier).toContain(
      "TABLE(outcome_status text, previous_state text, new_state text, updated_at timestamp with time zone, actor_email text)"
    );
  });

  it("16/17 — SECURITY DEFINER and the exact pinned search_path are proven (V14)", () => {
    expect(verifier).toContain("bool_and(r.prosecdef)");
    expect(verifier).toContain("= 'search_path=public,pg_temp'");
    // exactly one per-function setting, so nothing else can be pinned alongside
    expect(verifier).toContain("coalesce(array_length(r.proconfig, 1), 0) = 1");
  });

  it("18 — the owner is part of the contract (V21)", () => {
    expect(verifier).toContain("mutation function owner is not a web role");
    expect(verifier).toContain("r.fn_owner not in ('anon', 'authenticated', 'service_role')");
    expect(verifier).toContain("r.fn_owner = t.table_owner");
  });

  it("19 — the affirmative service_role EXECUTE grant is proven present (V22)", () => {
    expect(verifier).toContain("service_role holds EXECUTE on the mutation function");
    expect(verifier).toContain("grantee_name = 'service_role'");
  });

  it("20 — an un-revoked default PUBLIC execute is caught, not just an explicit grant (V15)", () => {
    // proacl is NULL when nothing was ever revoked, and the built-in default
    // for a function grants EXECUTE to PUBLIC. Reading acldefault() closes it.
    expect(verifier).toContain("aclexplode(coalesce(r.proacl, acldefault('f', r.proowner)))");
    expect(verifier).toContain("grantee_name in ('anon', 'authenticated', 'PUBLIC')");
  });

  it("21/22 — V17 proves SET EQUALITY of the post-M069 vocabulary, not a count", () => {
    expect(verifier).toContain(
      "audit vocabulary is exactly the 52 release values + set_application_form_state"
    );
    expect(verifier).toContain("select value from expected_post except select value from actual_post");
    expect(verifier).toContain("select value from actual_post except select value from expected_post");
    expect(verifier).toContain("(select raw_n = 53 and quote_n = 106 from audit_shape)");
    expect(verifier).toContain("missing=");
    expect(verifier).toContain("unexpected=");
  });

  it("23 — control rows on a same-code batch under the wrong chain FAIL (V24)", () => {
    expect(verifier).toContain("UEHM -> UEHM-S12 -> UEHM-S12-B1 is one chain and owns both control rows");
    expect(verifier).toContain("join chain ch on ch.batch_id = c.intake_batch_id");
    expect(verifier).toContain("and ch.season_id = c.season_id");
    expect(verifier).toContain("and ch.program_id = c.program_id");
    expect(verifier).toContain("(select count(*) from chain) = 1");
    expect(verifier).toContain("(select count(*) from public.application_form_controls) = 2");
  });

  it("the RPC body seal detects a replaced same-signature function (V23)", () => {
    for (const marker of [
      "r.prosrc like '%''active''%'",
      "r.prosrc like '%super_admin%'",
      "r.prosrc like '%42501%'",
      "r.prosrc like '%for update%'",
      "r.prosrc like '%p_expected_state%'",
      "r.prosrc like '%40001%'",
      "r.prosrc like '%admin_audit_log%'",
      "r.prosrc not like '%core_team%'"
    ]) {
      expect(verifier).toContain(marker);
    }
    expect(verifier).toContain("md5(r.prosrc)");
  });

  it("is still read-only after the strengthening", () => {
    expect(hasMutatingStatement(verifier)).toBe(false);
  });
});

describe("M069 R2 — the post-apply vocabulary adversaries V17 must reject", () => {
  it("the intended 53 passes", () => {
    expect(refusesVocabulary(POST_M069_AUDIT_ACTION_TYPES, [...POST_M069_AUDIT_ACTION_TYPES])).toBe(
      false
    );
  });

  it.each([
    [
      "21. 53 values but an original value was replaced",
      POST_M069_AUDIT_ACTION_TYPES.map((v) => (v === "edit_recap" ? "edit_recaps" : v))
    ],
    [
      "22a. 53 values but one original missing and one unexpected added",
      [...POST_M069_AUDIT_ACTION_TYPES.filter((v) => v !== "link_person_auth"), "link_person"]
    ],
    [
      "22b. an original value went missing (52)",
      POST_M069_AUDIT_ACTION_TYPES.filter((v) => v !== "cancel_membership")
    ],
    [
      "22c. an unexpected value was added (54)",
      [...POST_M069_AUDIT_ACTION_TYPES, "drop_all_audit"]
    ],
    [
      "22d. the M069 value never landed",
      PRE_M069_AUDIT_ACTION_TYPES.slice()
    ]
  ])("rejects %s", (_label, actual) => {
    expect(refusesVocabulary(POST_M069_AUDIT_ACTION_TYPES, actual)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Preserved guarantees — unchanged by the R2 hardening
// ---------------------------------------------------------------------------

describe("M069 R2 — the R1 guarantees are preserved", () => {
  it("both seeded rows are still CLOSED and the verifier still proves it", () => {
    expect(verifier).toContain("every control row is CLOSED");
    expect(verifier).toContain("control_rows_not_closed");
    for (const sql of [migration, apply]) {
      expect(sql).toContain("A migration must never open a form");
    }
  });

  it("Season 11 is still untouched", () => {
    expect(verifier).toContain("no control row references any Season 11 object");
    expect(preflight).toContain("[S11_BINDING]");
    expect(APPLY_SECTION_0).toContain("[S11_BINDING]");
  });

  it("RLS is still on with zero policies and no web-role grant", () => {
    expect(verifier).toContain("zero RLS policies on the control table");
    expect(verifier).toContain("no anon/authenticated/PUBLIC grant on the control table");
    for (const sql of [migration, apply]) {
      expect(sql).not.toMatch(/create policy/i);
    }
  });

  it("no artifact writes a state other than closed", () => {
    for (const [, sql] of ALL_SQL) {
      const inserts = sql.match(/insert into public\.application_form_controls[\s\S]*?;/gi) ?? [];
      for (const stmt of inserts) {
        expect(stmt).toContain("'closed'");
      }
    }
  });

  it("still has no executable reference to the pilot secret anywhere", () => {
    for (const [, sql] of ALL_SQL) {
      expect(code(sql).replace(/preflight_token/g, "")).not.toMatch(/token/i);
    }
  });
});
