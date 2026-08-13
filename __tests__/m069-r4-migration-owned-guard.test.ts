import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sqlVocabulary } from "./support/m069-audit-vocabulary";
import {
  EXPECTED_BINDING_BODY_SEAL,
  EXPECTED_RPC_BODY_SEAL,
  FOREIGN_VAM069_FUNCTIONS,
  M069_OWNED_FUNCTIONS,
  M069_OWNED_FUNCTION_NAMES,
  M069_OWNED_OBJECT_PREFIX
} from "./support/m069-canonical-definitions";

/**
 * M069 R4 — the unapplied/partial-schema guard is scoped to MIGRATION-OWNED
 * objects, not to the vam069_ namespace.
 *
 * THE PRODUCTION FALSE POSITIVE THIS FIXES
 * Owner-run read-only Production forensics found exactly one function matching
 * the broad `vam069_*` prefix: `public.vam069_trusted_context_probe()`, the
 * completed S12 release's Probe C artifact (release T3, Section 3) — language
 * sql, SECURITY DEFINER, owner postgres, `search_path=public`, EXECUTE held by
 * postgres and service_role, probe_version `VAM_PROD_S12_PROBE_C_v1`.
 *
 * Everything M069 owns was ABSENT: no `application_form_controls`, no M069
 * relation, trigger or control constraint, and the canonical pre-M069 52-value
 * audit vocabulary. M069 was entirely unapplied — and R3's preflight refused
 * anyway, with FUNCTION_PRESENT, because it counted any function under the
 * prefix. R3's rollback post-condition had the same defect in the other
 * direction: it would have declared a CORRECT rollback FAILED, because the
 * probe still carried the prefix afterwards, exactly as it should.
 *
 * The rule pinned below is semantic, not a name exemption:
 *     objects belonging to THIS migration must be absent
 * and NOT
 *     no object anywhere may use the vam069 prefix.
 *
 * `vam069_trusted_context_probe` appears here only as a FIXTURE standing for
 * "some unrelated prefixed function", and it is read out of the release package
 * rather than restated — see FOREIGN_VAM069_FUNCTIONS. No M069 SQL artifact
 * names it anywhere, and a test below proves that.
 */

const ROOT = join(__dirname, "..");
const PKG = join(ROOT, "VAM_OS_M069_S12_APPLICATION_INTAKE_CONTROL_20260812");

const read = (p: string) => readFileSync(p, "utf8");

const migration = read(join(ROOT, "supabase_migrations", "069_application_form_controls.sql"));
const preflight = read(join(PKG, "preflight.sql"));
const apply = read(join(PKG, "apply.sql"));
const verifier = read(join(PKG, "verifier.sql"));
const rollback = read(join(PKG, "rollback.sql"));
const readme = read(join(PKG, "README.md"));

const ALL_SQL: Array<[string, string]> = [
  ["migration", migration],
  ["apply", apply],
  ["preflight", preflight],
  ["verifier", verifier],
  ["rollback", rollback]
];

/** SQL with `--` comments removed, so assertions test code and not prose. */
function code(sql: string) {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function hasMutatingStatement(sql: string) {
  return code(sql)
    .split("\n")
    .some((line) => /^\s*(create|alter|drop|insert|update|delete|truncate|grant|revoke)\s/i.test(line));
}

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

/** Bracketed refusal tags, e.g. `[FUNCTION_PRESENT]`. */
function tagsIn(sql: string): Set<string> {
  return new Set((sql.match(/\[[A-Z][A-Z0-9_]+\]/g) ?? []).map((t) => t.slice(1, -1)));
}

function block(sql: string, tag: string) {
  const open = sql.indexOf(`do ${tag}`);
  expect(open).toBeGreaterThan(-1);
  const close = sql.indexOf(`${tag};`, open + 1);
  expect(close).toBeGreaterThan(open);
  return sql.slice(open, close + tag.length + 1);
}

const PREFLIGHT_GUARD = block(preflight, "$m069_preflight$");
const APPLY_SECTION_0 = block(apply, "$m069_guard$");

const GUARDS: Array<[string, string]> = [
  ["preflight", PREFLIGHT_GUARD],
  ["apply Section 0", APPLY_SECTION_0]
];

describe("M069 R4 — the migration-owned object inventory", () => {
  it("is derived from migration 069 and is exactly the two functions", () => {
    expect(M069_OWNED_FUNCTIONS).toEqual([
      {
        schema: "public",
        name: "vam069_assert_control_binding",
        qualifiedName: "public.vam069_assert_control_binding",
        argTypes: ""
      },
      {
        schema: "public",
        name: "vam069_set_application_form_state",
        qualifiedName: "public.vam069_set_application_form_state",
        argTypes: "uuid, text, text, text, text"
      }
    ]);
  });

  it.each(GUARDS)("%s declares the inventory the migration actually creates", (_n, guard) => {
    const declared = arraysAfter(guard, "v_owned_function_names constant text[] :=");
    expect(declared).toHaveLength(1);
    expect([...declared[0]].sort()).toEqual([...M069_OWNED_FUNCTION_NAMES].sort());
  });

  it("preflight and apply Section 0 declare the SAME inventory", () => {
    const a = arraysAfter(PREFLIGHT_GUARD, "v_owned_function_names constant text[] :=")[0];
    const b = arraysAfter(APPLY_SECTION_0, "v_owned_function_names constant text[] :=")[0];
    expect(a).toEqual(b);
  });

  it.each(GUARDS)("%s refuses on the owned NAMES, and never on the prefix", (_n, guard) => {
    expect(guard).toContain("p.proname = any (v_owned_function_names)");
    // The prefix survives in the guard exactly once, and the statement it
    // drives RAISES NOTICE. In R3 that same scan drove the refusal, which is
    // the whole defect: a legitimate unrelated function refused the apply.
    const body = code(guard);
    const hits: number[] = [];
    for (let at = body.indexOf("vam069\\_%"); at !== -1; at = body.indexOf("vam069\\_%", at + 1)) {
      hits.push(at);
    }
    expect(hits).toHaveLength(1);
    const after = body.slice(hits[0]);
    const nextRaise = after.slice(after.indexOf("raise "));
    expect(nextRaise.startsWith("raise notice")).toBe(true);
  });

  it.each(GUARDS)("%s matches an owned name at ANY signature", (_n, guard) => {
    // `proname = any(...)` is signature-independent by construction: pg_proc
    // holds one row per overload, so a conflicting overload under an owned name
    // is found too. Both cases are unsafe and both must refuse — the intended
    // identity would be silently REPLACED by `create or replace`, and an
    // overload would SURVIVE the apply and the rollback as a stray SECURITY
    // DEFINER function under a name this migration owns.
    expect(guard).toContain("pg_get_function_identity_arguments(p.oid)");
    expect(guard).toContain("carrying a migration-owned identity already exist");
  });

  it.each(GUARDS)("%s reports an unowned prefixed function as a NOTICE only", (_n, guard) => {
    const at = guard.indexOf("p.proname <> all (v_owned_function_names)");
    expect(at).toBeGreaterThan(-1);
    const branch = guard.slice(at, at + 800);
    expect(branch).toContain("raise notice");
    expect(branch).not.toContain("raise exception");
  });

  it("no M069 SQL artifact whitelists the historical probe by name", () => {
    // The fix is a semantic rule, not an exemption list. If this ever fails,
    // someone has hard-coded a specific Production function name into a guard.
    expect(FOREIGN_VAM069_FUNCTIONS).toContain("vam069_trusted_context_probe");
    for (const [name, sql] of ALL_SQL) {
      for (const foreign of FOREIGN_VAM069_FUNCTIONS) {
        expect(`${name} names ${foreign}: ${code(sql).includes(foreign)}`).toBe(
          `${name} names ${foreign}: false`
        );
      }
    }
  });

  it("keeps the prefix scan for relations/triggers/constraints — that prefix IS ours", () => {
    // Unlike vam069_, every catalog name `application_form_controls%` can match
    // is a name migration 069 creates, so there the prefix is exact ownership.
    for (const [, guard] of GUARDS) {
      expect(guard).toContain("[PARTIAL_M069]");
      expect(guard).toContain("application\\_form\\_controls%");
    }
    expect(migration).toContain(
      `create table if not exists public.${M069_OWNED_OBJECT_PREFIX}`
    );
    expect(migration).toContain(`create unique index if not exists ${M069_OWNED_OBJECT_PREFIX}_batch_role_key`);
    expect(migration).toContain(`create trigger ${M069_OWNED_OBJECT_PREFIX}_binding`);
  });

  it("narrows exactly one test and removes none of the R3 refusals", () => {
    const shared = [
      "ENV_NOT_PRODUCTION", "ADMIN_USERS_MISSING", "ADMIN_USERS_COLUMNS", "ADMIN_USERS_KEY",
      "ALREADY_APPLIED", "FUNCTION_PRESENT", "PARTIAL_M069", "PROGRAM_MISSING",
      "PROGRAM_AMBIGUOUS", "SEASON_MISSING", "SEASON_AMBIGUOUS", "SEASON_PARENT",
      "BATCH_MISSING", "BATCH_AMBIGUOUS", "BATCH_PARENT", "S11_BINDING",
      "AUDIT_TABLE_MISSING", "AUDIT_COLUMNS", "AUDIT_ACTION_NOT_NULL", "AUDIT_CONTRACT",
      "AUDIT_INSERT_BLOCKED", "AUDIT_VOCAB_MISSING", "AUDIT_VOCAB_SHAPE",
      "AUDIT_VOCAB_NOT_VALIDATED", "AUDIT_VOCAB_UNEXPECTED"
    ];
    for (const tag of shared) {
      expect(`preflight has ${tag}: ${tagsIn(PREFLIGHT_GUARD).has(tag)}`).toBe(
        `preflight has ${tag}: true`
      );
      expect(`apply has ${tag}: ${tagsIn(APPLY_SECTION_0).has(tag)}`).toBe(
        `apply has ${tag}: true`
      );
    }
  });

  it("reports the inventory and the unowned functions as preflight evidence", () => {
    expect(preflight).toContain("m069_owned_objects_present");
    expect(preflight).toContain("unrelated_vam069_functions");
    // R4 does not change the token contract.
    expect(preflight).toContain(
      "M069:ABSENT:VOCAB52EXACT:VALIDATED:NULLABLE4:AUDITCONTRACT13:S12OK"
    );
    expect(hasMutatingStatement(preflight)).toBe(false);
  });

  it("leaves canonical migration 069 alone — this is a guard fix, not a runtime one", () => {
    expect(migration).not.toContain("v_owned_function_names");
    expect(code(migration)).not.toContain("vam069\\_%");
  });
});

describe("M069 R4 — rollback removes only what this migration owns", () => {
  it("every DROP names an exact identity, never a prefix", () => {
    const drops = code(rollback)
      .split("\n")
      .filter((l) => /^\s*drop\s/i.test(l))
      .map((l) => l.trim());
    expect(drops.length).toBeGreaterThan(0);
    for (const d of drops) {
      const usesPrefix = /\blike\b/i.test(d) || d.includes("%");
      expect(`${d} :: prefix-based=${usesPrefix}`).toBe(`${d} :: prefix-based=false`);
    }
    expect(code(rollback)).toContain(
      "drop function if exists public.vam069_set_application_form_state(uuid, text, text, text, text)"
    );
    expect(code(rollback)).toContain(
      "drop function if exists public.vam069_assert_control_binding()"
    );
  });

  it("never targets a vam069_ function this migration does not own", () => {
    for (const foreign of FOREIGN_VAM069_FUNCTIONS) {
      expect(code(rollback)).not.toContain(foreign);
    }
  });

  it("the post-condition asserts the OWNED identities are gone, not the prefix", () => {
    const post = block(rollback, "$m069_rollback_post$");
    expect(post).toContain("ROLLBACK FAILED: migration-owned function(s) still exist");
    for (const owned of M069_OWNED_FUNCTION_NAMES) {
      expect(post).toContain(owned);
    }
    // R3 asserted the PREFIX was unused here, which would have declared a
    // correct Production rollback FAILED because Probe C survived it.
    expect(post).not.toContain("vam069\\_%");
  });

  it("names, but does not touch, the prefixed functions it leaves alone", () => {
    const notice = block(rollback, "$m069_not_ours$");
    expect(notice).toContain("raise notice");
    expect(notice).toContain("LEFT IN PLACE");
    expect(code(notice)).not.toMatch(/^\s*drop\s/im);
  });

  it("still refuses while any form is open, and still preserves audit history", () => {
    expect(rollback).toContain("[FORM_NOT_CLOSED]");
    expect(rollback).toContain("audit history is not deleted to satisfy a constraint");
  });
});

describe("M069 R4 — the verifier never confuses the probe with an owned function", () => {
  it("locates both owned functions by exact name, never by prefix", () => {
    for (const owned of M069_OWNED_FUNCTION_NAMES) {
      expect(verifier).toContain(`p.proname = '${owned}'`);
    }
    expect(code(verifier)).not.toContain("vam069\\_%");
    expect(code(verifier)).not.toMatch(/proname\s+like\s+'vam069/);
  });

  it("requires exactly one match, so a stray overload cannot satisfy a check", () => {
    for (const check of ["V13", "V19", "V23"]) {
      const at = verifier.indexOf(`select '${check}'`);
      expect(at).toBeGreaterThan(-1);
      expect(verifier.slice(at, at + 500)).toContain("count(*) = 1");
    }
  });

  it("still judges both owned functions by sealed body identity", () => {
    expect(verifier).toContain(EXPECTED_BINDING_BODY_SEAL);
    expect(verifier).toContain(EXPECTED_RPC_BODY_SEAL);
  });
});

describe("M069 R4 — the README states the rule and the executed evidence", () => {
  it("explains the false positive and the semantic rule", () => {
    expect(readme).toContain("vam069_trusted_context_probe");
    expect(readme).toContain("migration-owned");
    expect(readme).toMatch(/objects belonging to THIS migration must be absent/i);
  });

  it("records that the probe survives apply and rollback byte-identically", () => {
    // The seal captured on the disposable Production-shaped reproduction.
    expect(readme).toContain(
      "521b583078a568b4b1d1c4fad4ed563aac4a9ba900e12eb97802b7d954f55ca6"
    );
  });
});
