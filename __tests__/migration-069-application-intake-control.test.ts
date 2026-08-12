import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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
    expect(preflight).toContain("M069:ABSENT:52:VALIDATED:NULLABLE4:S12OK");
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
