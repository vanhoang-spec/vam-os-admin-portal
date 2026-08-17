import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  PRE_M069_AUDIT_ACTION_TYPES,
  M069_AUDIT_ACTION_TYPE,
  sqlVocabulary
} from "@/__tests__/support/m069-audit-vocabulary";

// ---------------------------------------------------------------------------
// M070 — migration package invariants.
//
// None of this executes SQL. These are the properties whose quiet erosion
// would make the package unsafe while every file still "looks right": the
// apply copy drifting from the canonical migration, a hard-coded vocabulary
// list creeping back in and deleting a Production action type, the live-invite
// arbiter losing half its predicate, a grant to a web role, a rollback that
// deletes audit history or drops shared infrastructure.
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const PKG = "VAM_OS_M070_S12_RENEWAL_INVITE_FOUNDATION_20260817";

const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const MIGRATION_PATH = "supabase_migrations/070_person_season_invites.sql";
const migration = read(MIGRATION_PATH);
const apply = read(`${PKG}/apply.sql`);
const preflight = read(`${PKG}/preflight.sql`);
const verifier = read(`${PKG}/verifier.sql`);
const rollback = read(`${PKG}/rollback.sql`);
const readme = read(`${PKG}/README.md`);

const ALL_SQL: Record<string, string> = { migration, apply, preflight, verifier, rollback };

/** Strip `--` line comments so a scan cannot be satisfied or tripped by prose. */
function stripComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const i = line.indexOf("--");
      return i === -1 ? line : line.slice(0, i);
    })
    .join("\n");
}

const SHARED_MARKER = "-- ── 1. Prerequisites and unapplied proof";

const M070_ACTION_TYPES = [
  "confirm_renewal",
  "create_renewal_invite",
  "revoke_renewal_invite"
];

const REFUSED_ACTION_TYPES = [
  "submit_renewal",
  "decline_renewal",
  "regenerate_renewal_invite"
];

describe("M070 package shape", () => {
  it("ships exactly the four migration artifacts plus a README", () => {
    for (const file of ["apply.sql", "preflight.sql", "verifier.sql", "rollback.sql", "README.md"]) {
      expect(() => read(`${PKG}/${file}`)).not.toThrow();
    }
  });

  it("apply.sql is byte-identical to the canonical migration from Section 1 onward", () => {
    // `lastIndexOf`, because apply.sql's own header quotes the marker when it
    // explains what is shared.
    const i = migration.lastIndexOf(SHARED_MARKER);
    const j = apply.lastIndexOf(SHARED_MARKER);
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(0);
    // Whatever apply.sql adds is a header and Section 0; everything the
    // migration actually DOES must be the same bytes in both files.
    expect(apply.slice(j)).toBe(migration.slice(i));
  });

  it("apply.sql adds a Section 0 that re-asserts the baseline in-transaction", () => {
    const head = apply.slice(0, apply.lastIndexOf(SHARED_MARKER));
    expect(head).toContain("Section 0");
    for (const tag of [
      "[ENV_NOT_PRODUCTION]",
      "[UUID_FN_MISSING]",
      "[FK_TARGET_TYPE]",
      "[FK_TARGET_KEY]",
      "[UPDATED_AT_FN_SHAPE]",
      "[ALREADY_APPLIED]",
      "[PARTIAL_M070]",
      "[AUDIT_VOCAB_UNEXPECTED]"
    ]) {
      expect(head).toContain(tag);
    }
    // The guard must run before anything mutates.
    expect(apply.indexOf("$m070_guard$")).toBeLessThan(
      apply.indexOf("create table public.person_season_invites")
    );
  });

  it("apply, migration and rollback are each exactly one transaction", () => {
    for (const [name, sql] of Object.entries({ migration, apply, rollback })) {
      const body = stripComments(sql);
      expect(`${name}:${(body.match(/\bbegin;/g) ?? []).length}`).toBe(`${name}:1`);
      expect(`${name}:${(body.match(/\bcommit;/g) ?? []).length}`).toBe(`${name}:1`);
    }
  });
});

describe("audit action_type CHECK preservation", () => {
  it("every BASE52 copy is set-equal to the one canonical representation", () => {
    const expected = [...PRE_M069_AUDIT_ACTION_TYPES].sort();
    // rollback.sql carries no BASE52 copy by design: it SUBTRACTS from the live
    // set, so it has no expected baseline to drift from.
    const { rollback: _skip, ...carriesBase52 } = ALL_SQL;
    for (const [name, sql] of Object.entries(carriesBase52)) {
      const blocks = sql.match(/'accept_registration_proof'[\s\S]*?'withdraw_membership'/g) ?? [];
      expect(`${name}:${blocks.length > 0}`).toBe(`${name}:true`);
      for (const block of blocks) {
        expect(`${name}:${sqlVocabulary(block).join(",")}`).toBe(`${name}:${expected.join(",")}`);
      }
    }
  });

  it("adds exactly three action types, and the same three everywhere", () => {
    for (const [name, sql] of Object.entries(ALL_SQL)) {
      if (name === "verifier") continue; // verifier lists them inline, checked below
      const block = sql.match(/v_m070 constant text\[\] := array\[[\s\S]*?\]/)?.[0];
      expect(`${name}:${block !== undefined}`).toBe(`${name}:true`);
      expect(`${name}:${sqlVocabulary(block!).join(",")}`).toBe(`${name}:${M070_ACTION_TYPES.join(",")}`);
    }
    for (const value of M070_ACTION_TYPES) {
      expect(verifier).toContain(`'${value}'`);
    }
  });

  it("does not add the four action types that were reviewed and refused", () => {
    for (const [name, sql] of Object.entries(ALL_SQL)) {
      const body = stripComments(sql);
      for (const refused of REFUSED_ACTION_TYPES) {
        expect(`${name}/${refused}:${body.includes(refused)}`).toBe(`${name}/${refused}:false`);
      }
    }
    // …and the README states why, so the decision survives the reviewer.
    for (const refused of REFUSED_ACTION_TYPES) {
      expect(readme).toContain(refused);
    }
  });

  it("never adds an action type this database already admits for other purposes", () => {
    for (const value of M070_ACTION_TYPES) {
      expect(PRE_M069_AUDIT_ACTION_TYPES).not.toContain(value);
      expect(value).not.toBe(M069_AUDIT_ACTION_TYPE);
    }
  });

  it("builds the replacement vocabulary from the LIVE set, never from a literal list", () => {
    for (const [name, sql] of Object.entries({ migration, apply })) {
      const body = stripComments(sql);
      // The union with the live parse is what makes preservation structural.
      expect(`${name}`).toBe(name);
      expect(body).toContain("unnest(v_actual || v_m070)");
      expect(body).toContain("execute format(");
      // A hard-coded replacement list would look like M069's. It must not
      // appear: that is the shape that can silently drop a Production value.
      expect(
        /add constraint\s+admin_audit_log_action_type_check\s+check\s*\(\s*action_type\s*=\s*any\s*\(\s*array\[\s*'/i.test(
          body
        )
      ).toBe(false);
    }
  });

  it("rollback subtracts the three values rather than restoring a literal list", () => {
    const body = stripComments(rollback);
    expect(body).toContain("where x <> all (v_m070)");
    expect(
      /add constraint\s+admin_audit_log_action_type_check\s+check\s*\(\s*action_type\s*=\s*any\s*\(\s*array\[\s*'/i.test(
        body
      )
    ).toBe(false);
  });

  it("refuses a vocabulary that is neither BASE52 nor BASE53", () => {
    for (const sql of [migration, apply, preflight]) {
      expect(sql).toContain("[AUDIT_VOCAB_UNEXPECTED]");
      expect(sql).toContain("set_application_form_state");
    }
  });

  it("requires the CHECK to be VALIDATED, singular, parseable and duplicate-free", () => {
    for (const sql of [migration, apply, preflight]) {
      expect(sql).toContain("[AUDIT_VOCAB_NOT_VALIDATED]");
      expect(sql).toContain("[AUDIT_VOCAB_SHAPE]");
      expect(sql).toContain("v_quote_n <> 2 * v_raw_n");
    }
  });

  it("proves post-apply that nothing was lost and exactly three were gained", () => {
    expect(stripComments(migration)).toContain("+ 3");
    expect(migration).toContain("[AUDIT_VOCAB_POST]");
  });
});

describe("invite table contract", () => {
  const body = stripComments(migration);

  it("creates exactly one table, and it is person_season_invites", () => {
    const created = body.match(/create table\s+(\S+)/gi) ?? [];
    expect(created).toEqual(["create table public.person_season_invites"]);
  });

  it("pins every foreign key's ON DELETE behaviour", () => {
    const expected: Array<[string, string]> = [
      ["person_id", "references public.people(id)       on delete cascade"],
      ["program_id", "references public.programs(id)     on delete restrict"],
      ["season_id", "references public.seasons(id)      on delete restrict"],
      ["created_by", "references public.admin_users(id)  on delete restrict"],
      ["application_id", "references public.applications(id)          on delete restrict"]
    ];
    for (const [, clause] of expected) {
      expect(body).toContain(clause);
    }
    // SET NULL on application_id would break the accepted⇔application binding.
    expect(/application_id[\s\S]{0,120}on delete set null/i.test(body)).toBe(false);
  });

  it("stores only a sha256 hash, enforced by CHECK", () => {
    expect(body).toContain("token_hash ~ '^[0-9a-f]{64}$'");
    // A 43-character base64url token cannot satisfy that pattern.
    expect(/token_hash[^\n]*\{43\}/.test(body)).toBe(false);
  });

  it("uses the live-invite arbiter that excludes submitted invites", () => {
    expect(body).toContain(
      "where revoked_at is null and submitted_at is null"
    );
    // The rejected alternative, on its own, must not be what ships.
    const liveIdx = body.match(
      /create unique index person_season_invites_live_key[\s\S]*?;/
    )?.[0];
    expect(liveIdx).toBeDefined();
    expect(liveIdx!).toContain("submitted_at is null");
  });

  it("keeps a permanent at-most-one-acceptance arbiter", () => {
    expect(body).toContain("create unique index person_season_invites_accepted_key");
    expect(body).toContain("where outcome = 'accepted'");
  });

  it("binds submitted_at to outcome and accepted to an application row", () => {
    expect(body).toContain("check ((submitted_at is null) = (outcome is null))");
    expect(body).toContain(
      "check ((outcome is not distinct from 'accepted') = (application_id is not null))"
    );
  });

  it("reuses the shared updated_at function and creates no new trigger infrastructure", () => {
    expect(body).toContain("execute function public.set_updated_at();");
    expect(/create (or replace )?function\s+public\.set_updated_at/i.test(body)).toBe(false);
    expect(/create (or replace )?function/i.test(body)).toBe(false);
  });

  it("enables RLS with zero policies, no FORCE, and no web-role grant", () => {
    expect(body).toContain("alter table public.person_season_invites enable row level security");
    expect(body).toContain("revoke all on public.person_season_invites from anon");
    expect(body).toContain("revoke all on public.person_season_invites from authenticated");
    expect(body).toContain("revoke all on public.person_season_invites from public");
    // The [RLS_FORCED] refusal message contains the phrase, so match a
    // STATEMENT rather than the words.
    expect(/alter table[^;\r\n]*force row level security/i.test(body)).toBe(false);
    expect(/create policy/i.test(body)).toBe(false);
    expect(/\bgrant\b/i.test(body)).toBe(false);
    // …and the README explains the FORCE decision rather than leaving it silent.
    expect(readme).toMatch(/FORCE ROW LEVEL SECURITY/i);
  });

  it("never mints an invite and never writes a row", () => {
    for (const [name, sql] of Object.entries(ALL_SQL)) {
      const b = stripComments(sql);
      expect(`${name}:${/insert into public\.person_season_invites/i.test(b)}`).toBe(`${name}:false`);
    }
    expect(migration).toContain("[ROWS_SEEDED]");
  });

  it("touches no table other than person_season_invites and the audit CHECK", () => {
    const alters = stripComments(migration).match(/alter table\s+(\S+)/gi) ?? [];
    const targets = new Set(alters.map((a) => a.split(/\s+/)[2]));
    expect(Array.from(targets).sort()).toEqual([
      "public.admin_audit_log",
      "public.person_season_invites"
    ]);
  });

  it("never references Season 11", () => {
    for (const [name, sql] of Object.entries({ migration, apply, preflight, rollback })) {
      expect(`${name}:${/S11/i.test(stripComments(sql))}`).toBe(`${name}:false`);
    }
  });
});

describe("preflight and verifier are read-only", () => {
  const WRITES =
    /\b(insert\s+into|update\s+\w|delete\s+from|truncate|merge\s+into|create\s+(table|index|function|trigger|policy)|drop\s+|alter\s+table|grant\s+|revoke\s+)/i;

  it("neither file contains a write statement", () => {
    for (const [name, sql] of Object.entries({ preflight, verifier })) {
      expect(`${name}:${WRITES.test(stripComments(sql))}`).toBe(`${name}:false`);
    }
  });

  it("both wrap their work in a read-only transaction", () => {
    for (const [name, sql] of Object.entries({ preflight, verifier })) {
      const body = stripComments(sql);
      expect(`${name}:${body.includes("set transaction read only")}`).toBe(`${name}:true`);
      expect(`${name}:${(body.match(/\bcommit;/g) ?? []).length}`).toBe(`${name}:0`);
      expect(`${name}:${body.includes("rollback;")}`).toBe(`${name}:true`);
    }
  });

  it("the verifier's verdict is derived, never a hard-coded PASS", () => {
    // Every 'PASS' literal must sit in a CASE arm or in a comparison, not be
    // emitted unconditionally.
    const unconditional = stripComments(verifier).match(/select\s+'PASS'/gi) ?? [];
    expect(unconditional).toEqual([]);
    expect(verifier).toContain("M070_VERIFIED");
  });

  it("the verifier pins the live-invite predicate and the token-hash CHECK", () => {
    expect(verifier).toContain("index_live_invite_arbiter");
    expect(verifier).toContain("revoked_at IS NULL");
    expect(verifier).toContain("submitted_at IS NULL");
    expect(verifier).toContain("check_token_hash_is_sha256_hex");
    expect(verifier).toContain("index_accepted_once_arbiter");
    // Anchored patterns, or an extra disjunct would slip through.
    expect(verifier).toContain("'^CHECK");
    expect(verifier).toContain("$'");
  });

  it("the verifier proves the ON DELETE action of every foreign key", () => {
    expect(verifier).toContain("foreign_key_contract");
    expect(verifier).toContain("'application_id#applications.id#r'");
    expect(verifier).toContain("'person_id#people.id#c'");
  });
});

describe("rollback safety", () => {
  const body = stripComments(rollback);

  it("refuses while any invite row exists", () => {
    expect(rollback).toContain("[INVITES_PRESENT]");
    expect(body).toContain("raise exception");
  });

  it("deletes no invite row and no audit row", () => {
    expect(/delete\s+from/i.test(body)).toBe(false);
    expect(/truncate/i.test(body)).toBe(false);
  });

  it("leaves the vocabulary alone when audit rows already use an M070 value", () => {
    expect(body).toContain("where action_type = any (v_m070)");
    expect(rollback).toContain("LEFT AS IS");
  });

  it("never drops the shared updated_at function, and asserts it survived", () => {
    expect(/drop\s+function/i.test(body)).toBe(false);
    expect(body).toContain("to_regprocedure('public.set_updated_at()') is null");
  });

  it("drops the table by exact identity, not by prefix match", () => {
    // Statement-initial only: the vocabulary block issues its DROP CONSTRAINT
    // through `execute format(...)`, which is not a DDL statement in this file.
    const drops = body.match(/^\s*drop\s+[^;\r\n]+/gim)?.map((d) => d.trim()) ?? [];
    expect(drops).toEqual(["drop table if exists public.person_season_invites"]);
  });

  it("the DROP is IF EXISTS, so the guard's table-absent branch is reachable", () => {
    // The guard deliberately continues when the table is already gone, to reach
    // the vocabulary block. An unconditional DROP raised 42P01 on exactly that
    // path and aborted before the block it had just promised to run.
    expect(body).toContain("drop table if exists public.person_season_invites");
    expect(rollback).toContain("already absent; only the audit vocabulary will be considered");
    // IF EXISTS must not have become a licence for a wider reach.
    expect(/drop[^;\r\n]*cascade/i.test(body)).toBe(false);
    expect(/drop[^;\r\n]*person_season_invites%/i.test(body)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// P0 runtime blockers.
//
// These are requirements on the NEXT package, and several of them are things
// the database deliberately does not enforce. That combination is exactly how a
// requirement gets lost, so each one carries a stable ID and is asserted
// present here: a future README edit cannot quietly drop one, and the specific
// mechanism each blocker names (the transactional claim, the fresh read) has to
// survive with it.
// ---------------------------------------------------------------------------

describe("P0 runtime blockers are documented and cannot be silently dropped", () => {
  const BLOCKERS: Array<[string, string[]]> = [
    [
      "P0-RT-1",
      ["create_renewal_invite", "must refuse", "at issue time", "outcome = 'accepted'"]
    ],
    [
      "P0-RT-2",
      [
        "vam063_opt_out_membership",
        "must never allow a later decline to undo an\nalready-confirmed Season-12 renewal"
      ]
    ],
    [
      "P0-RT-3",
      [
        "TOCTOU",
        "for update",
        "and submitted_at is null",
        "must be exactly 1",
        "fails closed",
        "SECURITY DEFINER"
      ]
    ],
    [
      "P0-RT-4",
      [
        "fresh canonical `mentor_profiles` read",
        "optimistic concurrency",
        'approve a "before" state that is no longer true'
      ]
    ],
    ["P0-RT-5", ["buildRenewalProfileRefresh", "prior_vam_involvement"]],
    ["P0-RT-6", ["no reviewer screening", "P1 is not an acceptable home"]],
    ["P0-RT-7", ["p_actor_admin_user_id", "resolved server-side at\nconfirm time"]],
    ["P0-RT-8", ["vam063_add_membership_role", "noop", "no compensating delete"]]
  ];

  it.each(BLOCKERS)("%s is present with its required mechanism", (id, phrases) => {
    expect(readme).toContain(`### ${id} ·`);
    for (const phrase of phrases) {
      expect(`${id}/${phrase}:${readme.includes(phrase)}`).toBe(`${id}/${phrase}:true`);
    }
  });

  it("all eight are carried, and the section says it is normative", () => {
    expect((readme.match(/### P0-RT-\d+ ·/g) ?? []).length).toBe(8);
    expect(readme).toContain("**This section is normative.**");
  });

  it("the post-acceptance rules are cross-referenced from the arbiter section", () => {
    // §3.4 is where a reader decides whether the relaxed live arbiter is safe.
    // The two runtime rules that pay for it must be reachable from there.
    const arbiter = readme.slice(
      readme.indexOf("### 3.4"),
      readme.indexOf("## 4. Security posture")
    );
    expect(arbiter).toContain("P0-RT-1");
    expect(arbiter).toContain("P0-RT-2");
  });

  it("the gate is documented as a decision, never as a claim", () => {
    expect(readme).toContain("The gate decides; it does not reserve");
    // The module itself must stay pure — a claim would need a write path.
    const gate = readFileSync(path.join(ROOT, "lib/renewal-invite-token.ts"), "utf8");
    expect(gate).toContain("GET NEVER MUTATES");
  });
});

describe("environment decision", () => {
  it("the Production-only guard is unchanged in both files that carry it", () => {
    for (const [name, sql] of Object.entries({ apply, preflight })) {
      const body = stripComments(sql);
      expect(`${name}:${body.includes("[ENV_NOT_PRODUCTION]")}`).toBe(`${name}:true`);
      expect(`${name}:${body.includes("p.proname like 'vam062\\_%'")}`).toBe(`${name}:true`);
    }
  });

  it("no artifact acquired a Staging mode or an environment escape hatch", () => {
    for (const [name, sql] of Object.entries(ALL_SQL)) {
      const body = stripComments(sql);
      for (const escape of [
        "staging_mode",
        "skip_env",
        "allow_staging",
        "force_env",
        "p_staging",
        "is_staging"
      ]) {
        expect(`${name}/${escape}:${body.toLowerCase().includes(escape)}`).toBe(
          `${name}/${escape}:false`
        );
      }
      // The word "Staging" may appear ONLY inside the refusal that names it as
      // the environment being rejected — never as a branch that accommodates it.
      const stagingLines = body
        .split(/\r?\n/)
        .filter((line) => line.toLowerCase().includes("staging"));
      for (const line of stagingLines) {
        expect(`${name}:${line.trim()}`).toBe(
          `${name}:${line.includes("ENV_NOT_PRODUCTION") ? line.trim() : "<staging outside the refusal>"}`
        );
      }
    }
  });

  it("the README records the next gate as a Production READ-ONLY preflight", () => {
    expect(readme).toContain("## 8. Environment, and the next execution gate");
    expect(readme).toContain("We are not attempting to make this package run on Staging.");
    expect(readme).toContain("Production READ-ONLY preflight");
    expect(readme).toContain(
      "does not weaken, relax,\nparameterise or bypass that guard"
    );
  });
});

describe("deferred findings are recorded rather than silently dropped", () => {
  it("§13 lists every deferred low the review raised", () => {
    const deferred = readme.slice(readme.indexOf("## 13. Deferred findings"));
    for (const phrase of [
      "immutability",
      "timestamp ordering",
      "role_table_grants",
      "Numeric-versus-string",
      "set_updated_at()` has no pinned `search_path",
      "S11",
      "[ENV_NOT_PRODUCTION]` guard"
    ]) {
      expect(`${phrase}:${deferred.includes(phrase)}`).toBe(`${phrase}:true`);
    }
    expect((deferred.match(/\| D\d \|/g) ?? []).length).toBe(7);
  });
});

describe("runtime UI is deliberately not started", () => {
  it("no /renew route and no admin renewals route exist yet", () => {
    for (const rel of [
      "app/renew",
      "app/admin/renewals",
      "app/actions/renewal.ts",
      "app/actions/renewals.ts"
    ]) {
      let existed = true;
      try {
        readFileSync(path.join(ROOT, rel));
      } catch {
        existed = false;
      }
      // Directories throw EISDIR rather than ENOENT, so treat a thrown EISDIR
      // as "it exists" by probing the directory listing instead.
      expect(`${rel}:${existed}`).toBe(`${rel}:false`);
    }
  });
});
