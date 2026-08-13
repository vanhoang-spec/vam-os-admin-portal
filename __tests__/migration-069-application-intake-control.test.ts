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
import {
  BINDING_FUNCTION_CONTRACT,
  CANONICAL_BINDING_BODY,
  CANONICAL_ROLE_CHECK,
  CANONICAL_RPC_BODY,
  CANONICAL_STATE_CHECK,
  CONTRACT_ARRAY_MARKERS,
  EXPECTED_BINDING_BODY_SEAL,
  EXPECTED_RPC_BODY_SEAL,
  M069_AUDIT_CONTRACT,
  M069_AUDIT_CONTRACT_ROWS,
  RPC_FUNCTION_CONTRACT,
  auditContractViolations,
  bodySealSha256,
  commentOutBlock,
  constraintAccepted,
  deparseCheckAnyArray,
  functionAccepted,
  insertValueType,
  m069AuditInsert,
  makeUnreachable,
  parseSqlAuditContract,
  productionAuditCatalog,
  replaceExactly,
  type AuditColumnCatalog,
  type CandidateConstraint,
  type CandidateFunction
} from "./support/m069-canonical-definitions";

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
    // Versioned twice. VOCAB52EXACT (R2) is emitted only when the admitted set
    // is set-equal to the canonical 52, where the old field emitted 52 for ANY
    // 52-value list. AUDITCONTRACT13 (R3) is emitted only when all 13
    // admin_audit_log columns satisfy the full INSERT contract, where
    // NULLABLE4 spoke for four legacy columns and said nothing about the three
    // omitted NOT NULL columns whose defaults the INSERT depends on.
    expect(preflight).toContain(
      "M069:ABSENT:VOCAB52EXACT:VALIDATED:NULLABLE4:AUDITCONTRACT13:S12OK"
    );
    expect(preflight).not.toContain("M069:ABSENT:52:VALIDATED");
    expect(preflight).not.toContain("VALIDATED:NULLABLE4:S12OK");
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
    // Superseded and strengthened by R3: V07 no longer judges the extracted
    // literals, it compares the whole normalised definition. See the R3
    // sections below for the mechanism and its adversarial cases.
    expect(verifier).toContain("applicant_role CHECK is the exact canonical definition");
    expect(verifier).toContain("bool_and(v.attached_to = 'applicant_role')");
    expect(verifier).toContain("pg_get_constraintdef(c.oid, true)");
  });

  it("12 — a same-named state CHECK with wrong values FAILs (V08 reads the expression)", () => {
    expect(verifier).toContain("state CHECK is the exact canonical definition");
    expect(verifier).toContain("bool_and(v.attached_to = 'state')");
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
    // Superseded and strengthened by R3: the return type is read through
    // pg_get_function_result and the body through a compared SHA-256 seal,
    // not through marker substrings.
    expect(verifier).toContain("binding trigger function is the canonical definition (sealed body)");
    expect(verifier).toContain("bool_and(f.result_type = 'trigger')");
    expect(verifier).toContain("f.prosrc like '%does not own intake_batch%'");
    expect(verifier).toContain("f.prosrc like '%does not own season%'");
    expect(verifier).toContain("encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex')");
  });

  it("15 — a same-named RPC with a different signature FAILs (V13)", () => {
    expect(verifier).toContain("pg_get_function_identity_arguments(p.oid)");
    // R3: the identity arguments PostgreSQL renders include the parameter
    // names, and the runtime calls this RPC by name, so both the named
    // signature and the bare type vector are asserted.
    expect(verifier).toContain(
      "r.arg_signature = 'p_actor_admin_user_id uuid, p_intake_batch_code text, " +
        "p_applicant_role text, p_expected_state text, p_new_state text'"
    );
    expect(verifier).toContain("r.arg_types = 'uuid, text, text, text, text'");
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
      "r.prosrc like '%admin_audit_log%'"
    ]) {
      expect(verifier).toContain(marker);
    }
    // R2's `not like '%core_team%'` clause is gone — see the R3 section that
    // proves the canonical body itself failed it.
    expect(verifier).not.toContain("r.prosrc not like '%core_team%'");
    // R3: the markers above are retained as diagnostics; the PASS is now
    // conditional on the body seal, proven by the R3 sections below.
    expect(verifier).toContain("md5(p.prosrc)");
    expect(verifier).toContain("bool_and(r.body_seal = (select body_seal from expected_seal");
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

// ===========================================================================
// R3 — the two independent-review MEDIUMs against R2
//
// The R2 tests inspected verifier SOURCE. These do not. They import the
// mechanism the SQL implements — full-definition comparison, body sealing, the
// per-column audit contract — from
// __tests__/support/m069-canonical-definitions.ts and drive real fixture
// definitions through it: catalog renderings a hostile or careless change
// would actually produce, and real mutated function bodies built from the
// canonical migration's own source.
//
// Two things are proven together, and the second is the point:
//   1. the R3 mechanism REJECTS each adversary, and
//   2. the R2 mechanism ACCEPTED it.
// Without (2) the new checks would be unfalsifiable ceremony.
//
// Separately, the constants hard-coded in verifier.sql / preflight.sql /
// apply.sql are compared against values DERIVED from the canonical migration
// and from the accepted Production baseline artifacts, so editing the SQL
// without editing the verifier fails here rather than in Production.
// ===========================================================================

/** Reads the next SQL string literal after `from`, un-doubling `''`. */
function sqlStringAfter(text: string, from: number): string {
  const start = text.indexOf("'", from);
  if (start === -1) throw new Error("no SQL string literal found");
  let out = "";
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === "'") {
      if (text[i + 1] === "'") {
        out += "'";
        i += 2;
        continue;
      }
      return out;
    }
    out += text[i];
    i += 1;
  }
  throw new Error("unterminated SQL string literal");
}

/** The constant verifier.sql requires for `object`, out of expected_def / expected_seal. */
function verifierConstantFor(object: string): string {
  const at = verifier.indexOf(`('${object}',`);
  expect(at, `verifier.sql declares no expected value for ${object}`).toBeGreaterThan(-1);
  return sqlStringAfter(verifier, at + `('${object}',`.length);
}

// ---------------------------------------------------------------------------
// R3 / MEDIUM 1 — the verifier proves exact definitions, not markers
// ---------------------------------------------------------------------------

describe("M069 R3 / MEDIUM 1 — verifier constants are derived from the canonical migration", () => {
  it("V07's expected definition is the deparse of migration 069's own role CHECK", () => {
    expect(verifierConstantFor("application_form_controls_role_check")).toBe(
      CANONICAL_ROLE_CHECK.definition
    );
    expect(CANONICAL_ROLE_CHECK.column).toBe("applicant_role");
    expect(CANONICAL_ROLE_CHECK.values).toEqual(["mentor", "mentee"]);
  });

  it("V08's expected definition is the deparse of migration 069's own state CHECK", () => {
    expect(verifierConstantFor("application_form_controls_state_check")).toBe(
      CANONICAL_STATE_CHECK.definition
    );
    expect(CANONICAL_STATE_CHECK.column).toBe("state");
    expect(CANONICAL_STATE_CHECK.values).toEqual(["closed", "pilot", "open"]);
  });

  it("V19's expected seal is SHA-256 of migration 069's trigger function body", () => {
    expect(verifierConstantFor("vam069_assert_control_binding")).toBe(
      EXPECTED_BINDING_BODY_SEAL
    );
    expect(EXPECTED_BINDING_BODY_SEAL).toBe(bodySealSha256(CANONICAL_BINDING_BODY));
  });

  it("V23's expected seal is SHA-256 of migration 069's RPC body", () => {
    expect(verifierConstantFor("vam069_set_application_form_state")).toBe(
      EXPECTED_RPC_BODY_SEAL
    );
    expect(EXPECTED_RPC_BODY_SEAL).toBe(bodySealSha256(CANONICAL_RPC_BODY));
  });

  it("the sealed bodies are the bytes between the $$ delimiters, and nothing else", () => {
    // Documents precisely what is sealed: prosrc, which starts at the newline
    // after the opening `$$` and ends at the newline before the closing one.
    for (const body of [CANONICAL_BINDING_BODY, CANONICAL_RPC_BODY]) {
      expect(body.startsWith("\ndeclare\n")).toBe(true);
      expect(body.endsWith("\nend;\n")).toBe(true);
      expect(body).not.toContain("security definer");
      expect(body).not.toContain("set search_path");
    }
  });

  it("apply.sql ships the identical bodies, so one seal covers both files", () => {
    for (const fn of [
      "public.vam069_assert_control_binding",
      "public.vam069_set_application_form_state"
    ]) {
      const marker = `create or replace function ${fn}`;
      const start = apply.indexOf(marker);
      const open = apply.indexOf("\nas $$", start) + "\nas $$".length;
      const close = apply.indexOf("$$;", open);
      const packaged = apply.slice(open, close);
      const canonical =
        fn.endsWith("assert_control_binding") ? CANONICAL_BINDING_BODY : CANONICAL_RPC_BODY;
      expect(bodySealSha256(packaged)).toBe(bodySealSha256(canonical));
    }
  });

  it("changing the canonical SQL changes the derived value, so a stale constant FAILs", () => {
    // The drift lock, demonstrated rather than asserted: a one-value edit to
    // the migration's CHECK, and a one-word edit to a function body, both
    // move the derived expectation away from the constant in verifier.sql.
    const extraRole = deparseCheckAnyArray("applicant_role", ["mentor", "mentee", "observer"]);
    expect(extraRole).not.toBe(verifierConstantFor("application_form_controls_role_check"));

    const editedBody = replaceExactly(CANONICAL_RPC_BODY, "'42501'", "'42502'");
    expect(bodySealSha256(editedBody)).not.toBe(
      verifierConstantFor("vam069_set_application_form_state")
    );
  });
});

// --- A. CHECK constraints --------------------------------------------------

const CONTROL_TABLE = "application_form_controls";

/** A catalog rendering of the canonical role CHECK, as V07 would read it. */
function roleCandidate(patch: Partial<CandidateConstraint> = {}): CandidateConstraint {
  return {
    definition: CANONICAL_ROLE_CHECK.definition,
    name: "application_form_controls_role_check",
    table: CONTROL_TABLE,
    attachedTo: "applicant_role",
    validated: true,
    ...patch
  };
}

function stateCandidate(patch: Partial<CandidateConstraint> = {}): CandidateConstraint {
  return {
    definition: CANONICAL_STATE_CHECK.definition,
    name: "application_form_controls_state_check",
    table: CONTROL_TABLE,
    attachedTo: "state",
    validated: true,
    ...patch
  };
}

/**
 * The R2 mechanism: pull the quoted literals out of the definition and compare
 * the resulting SET. Reproduced faithfully so each adversary can be shown to
 * have passed it.
 */
function r2ConstraintAccepted(
  expectedValues: readonly string[],
  candidates: readonly CandidateConstraint[]
): boolean {
  if (candidates.length !== 1) return false;
  const literals = Array.from(candidates[0].definition.matchAll(/'([^']*)'::text/g))
    .map((m) => m[1])
    .sort();
  const unique = Array.from(new Set(literals));
  const expected = [...expectedValues].sort();
  return unique.length === expected.length && unique.every((v, i) => v === expected[i]);
}

describe("M069 R3 / MEDIUM 1A — the CHECK mechanism rejects altered definitions", () => {
  it("the canonical definitions pass, so the gate is not vacuously refusing", () => {
    expect(constraintAccepted(CANONICAL_ROLE_CHECK, CONTROL_TABLE, [roleCandidate()])).toBe(true);
    expect(constraintAccepted(CANONICAL_STATE_CHECK, CONTROL_TABLE, [stateCandidate()])).toBe(true);
  });

  it("only whitespace is normalised away — a line-wrapped rendering still passes", () => {
    const wrapped = CANONICAL_ROLE_CHECK.definition.replace(/, /g, ",\n    ");
    expect(wrapped).not.toBe(CANONICAL_ROLE_CHECK.definition);
    expect(
      constraintAccepted(CANONICAL_ROLE_CHECK, CONTROL_TABLE, [roleCandidate({ definition: wrapped })])
    ).toBe(true);
  });

  const ROLE_ADVERSARIES: Array<[string, CandidateConstraint, boolean]> = [
    [
      "1. the intended CHECK plus OR length(applicant_role) > 0",
      roleCandidate({
        definition:
          "CHECK ((applicant_role = ANY (ARRAY['mentor'::text, 'mentee'::text])) " +
          "OR (length(applicant_role) > 0))"
      }),
      true
    ],
    [
      "3a. the same literals in a materially different expression (<> ALL)",
      roleCandidate({
        definition: "CHECK (applicant_role <> ALL (ARRAY['mentor'::text, 'mentee'::text]))"
      }),
      true
    ],
    [
      "3b. the same literals, negated with IS NOT FALSE so NULL is admitted",
      roleCandidate({
        definition:
          "CHECK (((applicant_role = ANY (ARRAY['mentor'::text, 'mentee'::text])) IS NOT FALSE))"
      }),
      true
    ],
    [
      "4. the same constraint name over a wholly different definition",
      roleCandidate({ definition: "CHECK (applicant_role IS NOT NULL)" }),
      false
    ],
    [
      "4b. an extra admitted value",
      roleCandidate({
        definition: deparseCheckAnyArray("applicant_role", ["mentor", "mentee", "observer"])
      }),
      false
    ],
    [
      "5. the canonical expression, but NOT VALID",
      roleCandidate({
        definition: `${CANONICAL_ROLE_CHECK.definition} NOT VALID`,
        validated: false
      }),
      true
    ],
    [
      "6. the canonical expression attached to the wrong column",
      roleCandidate({ attachedTo: "state" }),
      true
    ],
    [
      "7. the canonical expression on the wrong table",
      roleCandidate({ table: "application_form_controls_archive" }),
      true
    ],
    [
      "8. the canonical expression under an unexpected constraint name",
      roleCandidate({ name: "application_form_controls_role_check2" }),
      true
    ]
  ];

  it.each(ROLE_ADVERSARIES)(
    "applicant_role: rejects %s",
    (_label, candidate, r2WouldHavePassed) => {
      expect(constraintAccepted(CANONICAL_ROLE_CHECK, CONTROL_TABLE, [candidate])).toBe(false);
      // …and R2's literal-set check accepted it, which is why this is a fix.
      expect(r2ConstraintAccepted(CANONICAL_ROLE_CHECK.values, [candidate])).toBe(
        r2WouldHavePassed
      );
    }
  );

  const STATE_ADVERSARIES: Array<[string, CandidateConstraint, boolean]> = [
    [
      "2. the intended CHECK plus OR state IS NULL",
      stateCandidate({
        definition:
          "CHECK ((state = ANY (ARRAY['closed'::text, 'pilot'::text, 'open'::text])) " +
          "OR (state IS NULL))"
      }),
      true
    ],
    [
      "2b. the intended CHECK weakened with a fourth reachable state",
      stateCandidate({
        definition:
          "CHECK ((state = ANY (ARRAY['closed'::text, 'pilot'::text, 'open'::text])) " +
          "OR (state = 'draft'::text))"
      }),
      false
    ],
    [
      "3. the same literals in a materially different expression",
      stateCandidate({
        definition: "CHECK ((state)::text ~~ ANY (ARRAY['closed'::text, 'pilot'::text, 'open'::text]))"
      }),
      true
    ],
    [
      "4. the same constraint name over a wholly different definition",
      stateCandidate({ definition: "CHECK (length(state) > 0)" }),
      false
    ],
    [
      "5. the canonical expression, but NOT VALID",
      stateCandidate({
        definition: `${CANONICAL_STATE_CHECK.definition} NOT VALID`,
        validated: false
      }),
      true
    ],
    [
      "6. the canonical expression attached to the wrong column",
      stateCandidate({ attachedTo: "applicant_role" }),
      true
    ]
  ];

  it.each(STATE_ADVERSARIES)("state: rejects %s", (_label, candidate, r2WouldHavePassed) => {
    expect(constraintAccepted(CANONICAL_STATE_CHECK, CONTROL_TABLE, [candidate])).toBe(false);
    expect(r2ConstraintAccepted(CANONICAL_STATE_CHECK.values, [candidate])).toBe(
      r2WouldHavePassed
    );
  });

  it("a second CHECK alongside the canonical one is a refusal, not a pass", () => {
    expect(
      constraintAccepted(CANONICAL_ROLE_CHECK, CONTROL_TABLE, [
        roleCandidate(),
        roleCandidate({
          name: "application_form_controls_role_escape",
          definition: "CHECK (applicant_role IS NOT NULL)"
        })
      ])
    ).toBe(false);
  });

  it("an absent CHECK is a refusal", () => {
    expect(constraintAccepted(CANONICAL_ROLE_CHECK, CONTROL_TABLE, [])).toBe(false);
    expect(constraintAccepted(CANONICAL_STATE_CHECK, CONTROL_TABLE, [])).toBe(false);
  });

  it("V07/V08 PASS is CONDITIONAL on the equality, not merely reporting it", () => {
    for (const object of [
      "application_form_controls_role_check",
      "application_form_controls_state_check"
    ]) {
      expect(verifier).toContain(
        `and bool_and(v.norm_def = (select definition from expected_def\n` +
          `                                    where object = '${object}'))`
      );
    }
    expect(verifier).toContain("and bool_and(v.convalidated)");
  });
});

// --- B/C. Function bodies --------------------------------------------------

/** A catalog rendering of the canonical binding function, as V19 would read it. */
function bindingCandidate(patch: Partial<CandidateFunction> = {}): CandidateFunction {
  return {
    schema: "public",
    name: "vam069_assert_control_binding",
    argSignature: "",
    argTypes: "",
    resultType: "trigger",
    language: "plpgsql",
    securityDefiner: true,
    config: ["search_path=public, pg_temp"],
    owner: "postgres",
    body: CANONICAL_BINDING_BODY,
    ...patch
  };
}

function rpcCandidate(patch: Partial<CandidateFunction> = {}): CandidateFunction {
  return {
    schema: "public",
    name: "vam069_set_application_form_state",
    argSignature:
      "p_actor_admin_user_id uuid, p_intake_batch_code text, p_applicant_role text, " +
      "p_expected_state text, p_new_state text",
    argTypes: "uuid, text, text, text, text",
    resultType:
      "TABLE(outcome_status text, previous_state text, new_state text, updated_at timestamp with time zone, actor_email text)",
    language: "plpgsql",
    securityDefiner: true,
    config: ["search_path=public, pg_temp"],
    owner: "postgres",
    body: CANONICAL_RPC_BODY,
    ...patch
  };
}

/** The R2 mechanism for V19: does the body contain each marker phrase? */
function r2BindingBodyAccepted(body: string): boolean {
  return (
    body.includes("does not resolve to a season") &&
    body.includes("does not own intake_batch") &&
    body.includes("does not own season") &&
    body.includes("23514")
  );
}

/**
 * The R2 mechanism for V23: the eight affirmative marker phrases. R2 also
 * carried a ninth clause, `prosrc not like '%core_team%'`, which the canonical
 * body itself failed — proven separately below — so it is not part of the
 * comparison the adversaries are measured against.
 */
function r2RpcBodyAccepted(body: string): boolean {
  return (
    body.includes("'active'") &&
    body.includes("super_admin") &&
    body.includes("42501") &&
    body.includes("for update") &&
    body.includes("p_expected_state") &&
    body.includes("40001") &&
    body.includes("admin_audit_log") &&
    body.includes("set_application_form_state")
  );
}

describe("M069 R3 / MEDIUM 1B — the binding trigger function is proven, not pattern-matched", () => {
  it("9. the canonical body passes", () => {
    expect(functionAccepted(BINDING_FUNCTION_CONTRACT, [bindingCandidate()])).toBe(true);
    expect(r2BindingBodyAccepted(CANONICAL_BINDING_BODY)).toBe(true);
  });

  const BINDING_BODY_ADVERSARIES: Array<[string, string]> = [
    [
      "5. markers preserved only in comments, the season-ownership refusal removed",
      commentOutBlock(CANONICAL_BINDING_BODY, "if new.season_id is distinct from v_season_id then", 4)
    ],
    [
      "6. markers preserved in unreachable code, the program-ownership refusal never runs",
      makeUnreachable(
        CANONICAL_BINDING_BODY,
        "if new.program_id is distinct from v_program_id then",
        4
      )
    ],
    [
      "7. one critical binding comparison changed — program_id compared to itself",
      replaceExactly(
        CANONICAL_BINDING_BODY,
        "new.program_id is distinct from v_program_id",
        "new.program_id is distinct from new.program_id"
      )
    ],
    [
      "7b. the resolve-to-a-season guard inverted",
      replaceExactly(CANONICAL_BINDING_BODY, "if v_season_id is null then", "if false then")
    ]
  ];

  it.each(BINDING_BODY_ADVERSARIES)("rejects %s", (_label, body) => {
    // The mutation is real: it is not the canonical body.
    expect(body).not.toBe(CANONICAL_BINDING_BODY);
    // R2 accepted every one of these — the marker words all survive.
    expect(r2BindingBodyAccepted(body)).toBe(true);
    // R3 does not.
    expect(functionAccepted(BINDING_FUNCTION_CONTRACT, [bindingCandidate({ body })])).toBe(false);
  });

  it("8. the same name and signature over a wholly different body is rejected", () => {
    const body = "\ndeclare\n  v_season_id uuid;\nbegin\n  return new;\nend;\n";
    expect(functionAccepted(BINDING_FUNCTION_CONTRACT, [bindingCandidate({ body })])).toBe(false);
  });

  it.each([
    ["a different schema", { schema: "app" }],
    ["a different name", { name: "vam069_assert_binding" }],
    ["an unexpected argument", { argSignature: "flag boolean", argTypes: "boolean" }],
    ["a non-trigger result type", { resultType: "boolean" }],
    ["a different language", { language: "sql" }],
    ["SECURITY INVOKER", { securityDefiner: false }],
    ["an unpinned search_path", { config: [] }],
    ["a second pinned setting", { config: ["search_path=public, pg_temp", "role=postgres"] }],
    ["a different pinned search_path", { config: ["search_path=public"] }],
    ["a web-role owner", { owner: "service_role" }]
  ])("rejects the canonical body with %s", (_label, patch) => {
    expect(
      functionAccepted(BINDING_FUNCTION_CONTRACT, [bindingCandidate(patch as Partial<CandidateFunction>)])
    ).toBe(false);
  });

  it("rejects zero, and two, functions of that name", () => {
    expect(functionAccepted(BINDING_FUNCTION_CONTRACT, [])).toBe(false);
    expect(
      functionAccepted(BINDING_FUNCTION_CONTRACT, [bindingCandidate(), bindingCandidate()])
    ).toBe(false);
  });
});

describe("M069 R3 / MEDIUM 1C — the toggle RPC is proven, not pattern-matched", () => {
  it("14. the canonical body passes", () => {
    expect(functionAccepted(RPC_FUNCTION_CONTRACT, [rpcCandidate()])).toBe(true);
    expect(r2RpcBodyAccepted(CANONICAL_RPC_BODY)).toBe(true);
  });

  // The third field records whether R2's marker search accepted the body, so
  // the cases that were genuinely invisible to it are distinguished from the
  // one that happened to delete a marker along with the enforcement.
  const RPC_BODY_ADVERSARIES: Array<[string, string, boolean]> = [
    [
      "10. authorization markers retained in comments, the actor check removed",
      commentOutBlock(
        CANONICAL_RPC_BODY,
        "if v_actor.id is null or v_actor.status <> 'active'",
        5
      ),
      true
    ],
    [
      "10b. the actor check kept but never reached",
      makeUnreachable(CANONICAL_RPC_BODY, "if v_actor.id is null or v_actor.status <> 'active'", 5),
      true
    ],
    [
      "11. the active-admin comparison weakened — OR became AND, so an inactive admin passes",
      replaceExactly(
        CANONICAL_RPC_BODY,
        "if v_actor.id is null or v_actor.status <> 'active'",
        "if v_actor.id is null and v_actor.status <> 'active'"
      ),
      true
    ],
    [
      "11b. the active-admin comparison replaced by a NULL test",
      replaceExactly(CANONICAL_RPC_BODY, "v_actor.status <> 'active'", "v_actor.status is null"),
      false
    ],
    [
      "12. the role restriction widened to a role that was never reviewed",
      replaceExactly(
        CANONICAL_RPC_BODY,
        "array['super_admin', 'admin']",
        "array['super_admin', 'admin', 'reviewer']"
      ),
      true
    ],
    [
      "13. the expected_state concurrency check moved behind a branch that never runs",
      makeUnreachable(
        CANONICAL_RPC_BODY,
        "if p_expected_state is not null and v_control.state <> p_expected_state then",
        4
      ),
      true
    ],
    [
      "13b. the expected_state comparison changed so a stale page always wins",
      replaceExactly(
        CANONICAL_RPC_BODY,
        "v_control.state <> p_expected_state",
        "v_control.state <> v_control.state"
      ),
      true
    ],
    [
      "13c. the row lock dropped while the words FOR UPDATE stay in a comment",
      replaceExactly(CANONICAL_RPC_BODY, "  for update;", "  ; -- for update"),
      true
    ],
    [
      "13d. the atomic audit INSERT commented out",
      commentOutBlock(CANONICAL_RPC_BODY, "insert into public.admin_audit_log (", 24),
      true
    ]
  ];

  it.each(RPC_BODY_ADVERSARIES)("rejects %s", (_label, body, r2WouldHavePassed) => {
    expect(body).not.toBe(CANONICAL_RPC_BODY);
    // All but 11b keep 'active', super_admin, 42501, for update,
    // p_expected_state, 40001, admin_audit_log and set_application_form_state
    // somewhere in prosrc — so R2's V23 read PASS on them.
    expect(r2RpcBodyAccepted(body)).toBe(r2WouldHavePassed);
    expect(functionAccepted(RPC_FUNCTION_CONTRACT, [rpcCandidate({ body })])).toBe(false);
  });

  it("a core_team grant is rejected by the seal", () => {
    const body = replaceExactly(
      CANONICAL_RPC_BODY,
      "array['super_admin', 'admin']",
      "array['super_admin', 'admin', 'core_team']"
    );
    expect(functionAccepted(RPC_FUNCTION_CONTRACT, [rpcCandidate({ body })])).toBe(false);
  });

  it("R2's `prosrc not like '%core_team%'` clause FAILED the canonical body itself", () => {
    // The body explains, in a comment, that core_team / reviewer /
    // support_team / viewer are NOT allowed. A substring test over prosrc
    // cannot tell that sentence from a grant, so V23 would have reported FAIL
    // against a correctly applied Production — and, symmetrically, would have
    // reported PASS for a body that admitted core_team without naming it.
    expect(CANONICAL_RPC_BODY).toContain("core_team");
    expect(CANONICAL_RPC_BODY).toContain("core_team, reviewer, support_team and viewer are NOT");
    // The executable authorization list does not admit it.
    const authorization = CANONICAL_RPC_BODY.slice(
      CANONICAL_RPC_BODY.indexOf("if v_actor.id is null"),
      CANONICAL_RPC_BODY.indexOf("42501")
    );
    expect(authorization).not.toContain("core_team");
    expect(authorization).toContain("array['super_admin', 'admin']");
    // R3 removed the clause and proves the same fact by exact body identity.
    // No EXECUTABLE line of the verifier mentions core_team any more; the
    // explanation of why the clause was removed remains, in a comment.
    expect(code(verifier)).not.toContain("core_team");
    expect(verifier).toContain("core_team, reviewer, support_team and viewer are NOT");
  });

  it.each([
    [
      "a renamed parameter — the runtime calls this RPC by name",
      {
        argSignature:
          "p_actor_id uuid, p_intake_batch_code text, p_applicant_role text, " +
          "p_expected_state text, p_new_state text"
      }
    ],
    ["a dropped parameter", { argTypes: "uuid, text, text, text" }],
    ["a widened type vector", { argTypes: "uuid, text, text, text, text, boolean" }],
    ["a different result contract", { resultType: "TABLE(outcome_status text)" }],
    ["SECURITY INVOKER", { securityDefiner: false }],
    ["an unpinned search_path", { config: [] }],
    ["a different pinned search_path", { config: ["search_path=public, extensions, pg_temp"] }],
    ["a web-role owner", { owner: "authenticated" }],
    ["a different schema", { schema: "extensions" }],
    ["a different language", { language: "sql" }]
  ])("body identity is additional, not a substitute: rejects %s", (_label, patch) => {
    expect(
      functionAccepted(RPC_FUNCTION_CONTRACT, [rpcCandidate(patch as Partial<CandidateFunction>)])
    ).toBe(false);
  });

  it("V19/V23 PASS is CONDITIONAL on seal equality, and the ACL checks are still separate", () => {
    expect(verifier).toContain("bool_and(f.body_seal = (select body_seal from expected_seal");
    expect(verifier).toContain("bool_and(r.body_seal = (select body_seal from expected_seal");
    // The structural proofs body identity does NOT replace.
    expect(verifier).toContain("r.arg_types = 'uuid, text, text, text, text'");
    expect(verifier).toContain("bool_and(r.prosecdef)");
    expect(verifier).toContain("= 'search_path=public,pg_temp'");
    expect(verifier).toContain("aclexplode(coalesce(r.proacl, acldefault('f', r.proowner)))");
    expect(verifier).toContain("service_role holds EXECUTE on the mutation function");
    expect(verifier).toContain("grantee_name in ('anon', 'authenticated', 'PUBLIC')");
    expect(verifier).toContain("mutation function owner is not a web role");
    expect(verifier).toContain("bool_and(r.language_name = 'plpgsql')");
    expect(verifier).toContain("bool_and(f.language_name = 'plpgsql')");
  });
});

// ---------------------------------------------------------------------------
// R3 / MEDIUM 2 — Section 0 proves the complete audit INSERT contract
// ---------------------------------------------------------------------------

const BASELINE_AUDIT_CATALOG = productionAuditCatalog();

function withColumn(
  catalog: readonly AuditColumnCatalog[],
  column: string,
  patch: Partial<AuditColumnCatalog>
): AuditColumnCatalog[] {
  let hit = false;
  const out = catalog.map((c) => {
    if (c.column !== column) return { ...c };
    hit = true;
    return { ...c, ...patch };
  });
  if (!hit) throw new Error(`no ${column} in the baseline catalog`);
  return out;
}

/** The R2 proof: the 13 column NAMES, sorted. Nothing else. */
function r2AuditNamesAccepted(catalog: readonly AuditColumnCatalog[]): boolean {
  const names = catalog.map((c) => c.column).sort();
  const expected = M069_AUDIT_CONTRACT.map((c) => c.column).sort();
  return names.length === expected.length && names.every((n, i) => n === expected[i]);
}

describe("M069 R3 / MEDIUM 2 — the audit contract is derived from the accepted baseline", () => {
  it("covers all 13 admin_audit_log columns, none omitted", () => {
    expect(M069_AUDIT_CONTRACT).toHaveLength(13);
    expect(BASELINE_AUDIT_CATALOG).toHaveLength(13);
    expect(M069_AUDIT_CONTRACT.map((c) => c.column)).toEqual(
      BASELINE_AUDIT_CATALOG.map((c) => c.column)
    );
  });

  it("classifies every column into exactly one of the three INSERT classes", () => {
    const supplied = m069AuditInsert().map((i) => i.column).sort();
    const byClass = {
      value: M069_AUDIT_CONTRACT.filter((c) => c.supply === "value").map((c) => c.column),
      null: M069_AUDIT_CONTRACT.filter((c) => c.supply === "null").map((c) => c.column),
      omitted: M069_AUDIT_CONTRACT.filter((c) => c.supply === "omitted").map((c) => c.column)
    };
    expect([...byClass.value, ...byClass.null].sort()).toEqual(supplied);
    expect(byClass.null).toEqual(["target_admin_user_id"]);
    expect(byClass.omitted.sort()).toEqual([
      "created_at",
      "id",
      "metadata",
      "target_email",
      "updated_at"
    ]);
  });

  it("class 1 — the type of every directly supplied column accepts the value the RPC writes", () => {
    for (const { column, value } of m069AuditInsert()) {
      const written = insertValueType(value);
      const contract = M069_AUDIT_CONTRACT.find((c) => c.column === column);
      expect(contract, column).toBeDefined();
      if (written === null) {
        // Only the literal NULL resolves to no type, and only one column takes it.
        expect(contract!.supply).toBe("null");
      } else {
        expect(`${column}=${contract!.type}`).toBe(`${column}=${written}`);
      }
    }
  });

  it("class 2 — every omitted NOT NULL column has a proven default mechanism", () => {
    for (const c of M069_AUDIT_CONTRACT.filter((x) => x.supply === "omitted")) {
      const live = BASELINE_AUDIT_CATALOG.find((x) => x.column === c.column)!;
      if (live.notNull) {
        expect(c.defaultPattern, `${c.column} needs a default family`).not.toBeNull();
        expect(new RegExp(c.defaultPattern!).test(live.defaultExpr ?? "")).toBe(true);
      }
    }
    // Concretely: the three the review named.
    expect(M069_AUDIT_CONTRACT.find((c) => c.column === "id")!.defaultPattern).toContain(
      "gen_random_uuid"
    );
    for (const column of ["created_at", "updated_at"]) {
      expect(M069_AUDIT_CONTRACT.find((c) => c.column === column)!.defaultPattern).toContain(
        "now"
      );
    }
  });

  it("class 3 — every nullable omitted column is actually nullable in the baseline", () => {
    for (const c of M069_AUDIT_CONTRACT.filter((x) => x.supply === "omitted")) {
      const live = BASELINE_AUDIT_CATALOG.find((x) => x.column === c.column)!;
      if (c.defaultPattern === null) expect(live.notNull).toBe(false);
    }
  });

  it("21. the exact canonical current Production audit schema passes", () => {
    expect(auditContractViolations(M069_AUDIT_CONTRACT, BASELINE_AUDIT_CATALOG)).toEqual([]);
  });

  it("every SQL copy of the contract is identical to the derived one", () => {
    const derived = M069_AUDIT_CONTRACT_ROWS;
    expect(derived).toHaveLength(13);
    const copies: Array<[string, string[]]> = [
      ["preflight guard", parseSqlAuditContract(preflight, CONTRACT_ARRAY_MARKERS[0][1])],
      ["preflight token CTE", parseSqlAuditContract(preflight, CONTRACT_ARRAY_MARKERS[1][1])],
      ["apply Section 0", parseSqlAuditContract(APPLY_SECTION_0, CONTRACT_ARRAY_MARKERS[2][1])]
    ];
    for (const [name, rows] of copies) {
      expect(`${name}=${rows.join("\n")}`).toBe(`${name}=${derived.join("\n")}`);
    }
  });
});

describe("M069 R3 / MEDIUM 2 — baselines Section 0 must abort on BEFORE mutation", () => {
  const AUDIT_ADVERSARIES: Array<[string, AuditColumnCatalog[]]> = [
    [
      "15. id NOT NULL with its default removed",
      withColumn(BASELINE_AUDIT_CATALOG, "id", { defaultExpr: null })
    ],
    [
      "15b. id NOT NULL with a default of NULL::uuid",
      withColumn(BASELINE_AUDIT_CATALOG, "id", { defaultExpr: "NULL::uuid" })
    ],
    [
      "16. created_at NOT NULL with its default removed",
      withColumn(BASELINE_AUDIT_CATALOG, "created_at", { defaultExpr: null })
    ],
    [
      "17. updated_at NOT NULL with its default removed",
      withColumn(BASELINE_AUDIT_CATALOG, "updated_at", { defaultExpr: null })
    ],
    [
      "17b. updated_at default replaced by a fixed timestamp",
      withColumn(BASELINE_AUDIT_CATALOG, "updated_at", {
        defaultExpr: "'2026-01-01 00:00:00+00'::timestamp with time zone"
      })
    ],
    [
      "18a. metadata made NOT NULL without a default (omitted by the INSERT)",
      withColumn(BASELINE_AUDIT_CATALOG, "metadata", { notNull: true })
    ],
    [
      "18b. target_email made NOT NULL without a default (omitted by the INSERT)",
      withColumn(BASELINE_AUDIT_CATALOG, "target_email", { notNull: true })
    ],
    [
      "18c. target_admin_user_id made NOT NULL, and the INSERT writes NULL into it",
      withColumn(BASELINE_AUDIT_CATALOG, "target_admin_user_id", { notNull: true })
    ],
    [
      "18d. id turned into GENERATED ALWAYS AS IDENTITY (allowed: it is omitted)",
      withColumn(BASELINE_AUDIT_CATALOG, "id", { identity: "a", defaultExpr: null })
    ],
    [
      "18e. before_data turned into a GENERATED column the INSERT supplies",
      withColumn(BASELINE_AUDIT_CATALOG, "before_data", { generated: "s" })
    ],
    [
      "19a. details changed from jsonb to text",
      withColumn(BASELINE_AUDIT_CATALOG, "details", { type: "text" })
    ],
    [
      "19b. actor_admin_user_id changed from uuid to text",
      withColumn(BASELINE_AUDIT_CATALOG, "actor_admin_user_id", { type: "text" })
    ],
    [
      "19c. action_type narrowed to character varying(20)",
      withColumn(BASELINE_AUDIT_CATALOG, "action_type", { type: "character varying(20)" })
    ],
    [
      "19d. created_at changed from timestamptz to timestamp without time zone",
      withColumn(BASELINE_AUDIT_CATALOG, "created_at", { type: "timestamp without time zone" })
    ],
    [
      "20. 13 columns with the right names but the wrong type/nullability/default shape",
      BASELINE_AUDIT_CATALOG.map((c) => ({
        ...c,
        type: "text",
        notNull: true,
        defaultExpr: null
      }))
    ]
  ];

  it.each(AUDIT_ADVERSARIES)("refuses %s", (label, catalog) => {
    const violations = auditContractViolations(M069_AUDIT_CONTRACT, catalog);
    // 18d is the one legal variation: an omitted NOT NULL column may satisfy
    // the contract through IDENTITY instead of a default.
    if (label.startsWith("18d")) {
      expect(violations).toEqual([]);
      return;
    }
    expect(violations.length, `${label} produced no violation`).toBeGreaterThan(0);
    // Every one of these has the right 13 names, which is all R2 checked.
    expect(r2AuditNamesAccepted(catalog)).toBe(true);
  });

  it("names the offending column, so a refusal is actionable", () => {
    const violations = auditContractViolations(
      M069_AUDIT_CONTRACT,
      withColumn(BASELINE_AUDIT_CATALOG, "created_at", { defaultExpr: null })
    );
    expect(violations.every((v) => v.startsWith("created_at:"))).toBe(true);
    expect(violations.join(" | ")).toContain(
      "created_at: omitted by the M069 INSERT and NOT NULL with no usable default"
    );
    expect(violations.join(" | ")).toContain("created_at: default is <none>");
  });

  it("a missing or extra column is refused too", () => {
    expect(
      auditContractViolations(
        M069_AUDIT_CONTRACT,
        BASELINE_AUDIT_CATALOG.filter((c) => c.column !== "details")
      )
    ).toContain("details: absent from admin_audit_log");
    expect(
      auditContractViolations(M069_AUDIT_CONTRACT, [
        ...BASELINE_AUDIT_CATALOG,
        {
          column: "shadow_payload",
          type: "jsonb",
          notNull: false,
          defaultExpr: null,
          identity: "",
          generated: ""
        }
      ])
    ).toContain("shadow_payload: present but not part of the M069 audit INSERT contract");
  });
});

describe("M069 R3 / MEDIUM 2 — Section 0 is the boundary and the preflight agrees with it", () => {
  it("Section 0 refuses under the new tags, before the first mutation", () => {
    for (const tag of ["[AUDIT_CONTRACT]", "[AUDIT_INSERT_BLOCKED]"]) {
      expect(APPLY_SECTION_0).toContain(tag);
      expect(preflight).toContain(tag);
    }
    const lines = apply.split("\n");
    const guardEnd = lines.findIndex((l) => l.includes("$m069_guard$;"));
    const contractAt = lines.findIndex((l) => l.includes("[AUDIT_CONTRACT]"));
    const firstMutation = lines.findIndex((l) =>
      /^\s*(create|alter|drop|insert|update|delete|truncate|grant|revoke)\s/i.test(
        l.replace(/--.*$/, "")
      )
    );
    expect(contractAt).toBeGreaterThan(-1);
    expect(contractAt).toBeLessThan(guardEnd);
    expect(guardEnd).toBeLessThan(firstMutation);
  });

  it("Section 0 evaluates the contract itself and does not defer to the preflight", () => {
    for (const branch of [
      "type is ' || a.typ || ', the contract requires ",
      "NOT NULL, but the M069 INSERT writes NULL into it",
      "omitted by the M069 INSERT and NOT NULL with no usable default",
      "the contract requires ' || e.default_re",
      "GENERATED/IDENTITY ALWAYS, but the M069 INSERT supplies it explicitly"
    ]) {
      expect(APPLY_SECTION_0).toContain(branch);
    }
    expect(APPLY_SECTION_0).toContain("format_type(a.atttypid, a.atttypmod)");
    expect(APPLY_SECTION_0).toContain("pg_get_expr(d.adbin, d.adrelid)");
    expect(APPLY_SECTION_0).toContain("relforcerowsecurity");
  });

  it("the preflight advertises exactly what it now proves", () => {
    expect(preflight).toContain("AUDITCONTRACT13");
    expect(preflight).toContain("AUDITCONTRACTDRIFT");
    expect(preflight).toContain("audit_contract_violations");
    expect(preflight).toContain("audit_contract_seal");
    expect(hasMutatingStatement(preflight)).toBe(false);
  });

  it("the R2 vocabulary hardening and Section 4 hardening are untouched", () => {
    expect(preflight).toContain("VOCAB52EXACT");
    expect(APPLY_SECTION_0).toContain("[AUDIT_VOCAB_UNEXPECTED]");
    for (const sql of [apply, migration]) {
      const vocabBlock = sql.slice(sql.indexOf("do $vocab$"), sql.indexOf("$vocab$;"));
      const dropAt = vocabBlock.indexOf("drop constraint admin_audit_log_action_type_check");
      expect(vocabBlock.indexOf("[AUDIT_VOCAB_UNEXPECTED]")).toBeLessThan(dropAt);
      expect(vocabBlock.indexOf("[AUDIT_VOCAB_POST]")).toBeGreaterThan(dropAt);
    }
    expect(verifier).toContain("24 checks");
  });
});
