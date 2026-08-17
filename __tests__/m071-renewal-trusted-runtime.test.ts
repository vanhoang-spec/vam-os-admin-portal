import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { buildMentorProfileRefresh } from "@/lib/application-approvals";
import {
  RENEWAL_STRIPPED_PROFILE_FIELDS,
  buildRenewalProfileRefresh
} from "@/lib/renewal-profile-safety";

// ---------------------------------------------------------------------------
// M071 — trusted runtime RPC foundation invariants.
//
// None of this executes SQL. These are the properties whose quiet erosion
// would make the package unsafe while every file still "looks right": a raw
// bearer token creeping into a function signature, a submit path losing its
// FOR UPDATE or its `and submitted_at is null`, the accepted-renewal refusal
// losing the lock that makes it authoritative, the raw_payload nesting that
// keeps approveApplication away from canonical columns being flattened, the
// SQL column ceiling drifting apart from the TypeScript renewal allowlist, or
// a grant to a web role.
//
// Two of the assertions below are genuinely executable rather than textual:
// the ceiling/allowlist cross-check runs buildRenewalProfileRefresh, and the
// envelope test runs buildMentorProfileRefresh over the exact JSON shape the
// accept RPC writes and proves it yields nothing.
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const PKG = "VAM_OS_M071_S12_RENEWAL_TRUSTED_RUNTIME_20260817";

const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const MIGRATION_PATH = "supabase_migrations/071_renewal_trusted_runtime.sql";
const migration = read(MIGRATION_PATH);
const apply = read(`${PKG}/apply.sql`);
const preflight = read(`${PKG}/preflight.sql`);
const verifier = read(`${PKG}/verifier.sql`);
const rollback = read(`${PKG}/rollback.sql`);
const readme = read(`${PKG}/README.md`);

const OWNER_SQL: Record<string, string> = { apply, preflight, verifier, rollback };
const ALL_SQL: Record<string, string> = { migration, ...OWNER_SQL };

const SHARED_MARKER = "-- ── 1. Prerequisites and unapplied proof";

/**
 * Every whole-match string for `re` in `text`.
 *
 * `exec` in a loop rather than `[...text.matchAll(re)]`, because this
 * repository's tsconfig target does not permit spreading an iterator and a
 * `--downlevelIteration` flag is not something a test file should require.
 */
function matches(text: string, re: RegExp): string[] {
  const out: string[] = [];
  const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  let m: RegExpExecArray | null = rx.exec(text);
  while (m !== null) {
    out.push(m[0]);
    if (m.index === rx.lastIndex) rx.lastIndex += 1;
    m = rx.exec(text);
  }
  return out;
}

/** Capture group 1 of every match for `re` in `text`. */
function captures(text: string, re: RegExp, group = 1): string[] {
  const out: string[] = [];
  const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  let m: RegExpExecArray | null = rx.exec(text);
  while (m !== null) {
    out.push(m[group]);
    if (m.index === rx.lastIndex) rx.lastIndex += 1;
    m = rx.exec(text);
  }
  return out;
}

function unique(values: string[]): string[] {
  return values.filter((value, i) => values.indexOf(value) === i);
}

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

/**
 * Remove every dollar-quoted block — `$$ … $$` and `$tag$ … $tag$` — leaving
 * only the statements the file executes directly when it is applied.
 */
function stripDollarQuoted(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const open = sql.slice(i).search(/\$[a-zA-Z0-9_]*\$/);
    if (open === -1) {
      out += sql.slice(i);
      break;
    }
    const absolute = i + open;
    const tag = /\$[a-zA-Z0-9_]*\$/.exec(sql.slice(absolute))![0];
    out += sql.slice(i, absolute);
    const close = sql.indexOf(tag, absolute + tag.length);
    if (close === -1) break;
    i = close + tag.length;
  }
  return out;
}

/** The body of one `create function public.<name>(...) ... $$ ... $$;` block. */
function functionBody(sql: string, name: string): string {
  const start = sql.indexOf(`create function public.${name}(`);
  expect(`${name}:${start >= 0}`).toBe(`${name}:true`);
  const open = sql.indexOf("$$", start);
  const close = sql.indexOf("$$", open + 2);
  expect(`${name}:${close > open}`).toBe(`${name}:true`);
  return sql.slice(open + 2, close);
}

const ENTRY_POINTS = [
  "vam071_create_renewal_invite",
  "vam071_revoke_renewal_invite",
  "vam071_submit_renewal_accepted",
  "vam071_submit_renewal_declined",
  "vam071_confirm_renewal_profile"
];

const HELPERS = ["vam071_renewal_identity_lock", "vam071_accepted_renewal_exists"];

/** The seven columns the confirm RPC's static UPDATE may write. */
const SQL_CEILING = [
  "capacity_target",
  "company_current",
  "function_area",
  "industry",
  "title_current",
  "years_experience_min",
  "years_experience_text"
];

describe("M071 package shape", () => {
  it("ships exactly the four SQL artifacts, a README and a checksum file", () => {
    const files = readdirSync(path.join(ROOT, PKG)).sort();
    expect(files).toEqual([
      "README.md",
      "SHA256SUMS.txt",
      "apply.sql",
      "preflight.sql",
      "rollback.sql",
      "verifier.sql"
    ].sort());
  });

  it("apply.sql is byte-identical to the canonical migration from the shared marker onward", () => {
    const i = migration.lastIndexOf(SHARED_MARKER);
    const j = apply.lastIndexOf(SHARED_MARKER);
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(0);
    expect(apply.slice(j)).toBe(migration.slice(i));
  });

  it("apply.sql adds a Section 0 that guards the environment before anything is created", () => {
    const head = apply.slice(0, apply.lastIndexOf(SHARED_MARKER));
    for (const tag of [
      "[ENV_NOT_PRODUCTION]",
      "[UUID_FN_MISSING]",
      "[LIFECYCLE_NOT_EXECUTABLE]",
      "[LIFECYCLE_HARDENING]"
    ]) {
      expect(head).toContain(tag);
    }
    expect(apply.indexOf("$m071_guard$")).toBeLessThan(
      apply.indexOf("create function public.vam071_renewal_identity_lock")
    );
  });

  it("migration, apply and rollback are each exactly one transaction", () => {
    for (const [name, sql] of Object.entries({ migration, apply, rollback })) {
      const body = stripComments(sql);
      expect(`${name}:${(body.match(/\bbegin;/g) ?? []).length}`).toBe(`${name}:1`);
      expect(`${name}:${(body.match(/\bcommit;/g) ?? []).length}`).toBe(`${name}:1`);
    }
  });

  it("preflight and verifier are read-only and never commit", () => {
    for (const [name, sql] of Object.entries({ preflight, verifier })) {
      const body = stripComments(sql);
      expect(`${name}:${body.includes("set transaction read only")}`).toBe(`${name}:true`);
      expect(`${name}:${(body.match(/\bcommit;/g) ?? []).length}`).toBe(`${name}:0`);
      // Every `begin;` must be closed by a `rollback;`.
      expect(`${name}:${(body.match(/\bbegin;/g) ?? []).length}`).toBe(
        `${name}:${(body.match(/\brollback;/g) ?? []).length}`
      );
    }
  });

  it("no owner-executable file contains a psql meta-command", () => {
    for (const [name, sql] of Object.entries(ALL_SQL)) {
      const offenders = sql
        .split("\n")
        .filter((line) => /^\s*\\/.test(line))
        .slice(0, 3);
      expect(`${name}:${JSON.stringify(offenders)}`).toBe(`${name}:[]`);
    }
  });
});

describe("the M070 execution defects cannot reappear", () => {
  it("no array is concatenated with an untyped literal", () => {
    // `array[...] || 'x'` and `x || array[...]` are the shape that aborted
    // M070's preflight. Every concatenation in this package is either
    // array_append() or carries an explicit ::text[] cast.
    for (const [name, sql] of Object.entries(ALL_SQL)) {
      const body = stripComments(sql);
      const offenders = matches(body, /\]\s*\|\|\s*'(?!'\s*\|\|)/g)
        .concat(matches(body, /'\s*\|\|\s*array\[/g));
      expect(`${name}:${JSON.stringify(offenders)}`).toBe(`${name}:[]`);
    }
  });

  it("every catalog identifier used in a TEXT context is cast ::text", () => {
    // relname / proname / conname are `name`; attidentity / attgenerated /
    // relkind / confdeltype / contype / prokind / provolatile are internal
    // "char". Comparing one to a text value is fine — PostgreSQL resolves it.
    // Concatenating one into a message, or aggregating it into a string,
    // without a cast is the M070 R5 defect, so only those two contexts are
    // flagged here.
    const CATALOG = "relname|proname|conname|attidentity|attgenerated|relkind|confdeltype|contype|prokind|provolatile";
    for (const [name, sql] of Object.entries(ALL_SQL)) {
      const body = stripComments(sql);
      const offenders = matches(body, new RegExp(`\\|\\|\\s*\\w+\\.(?:${CATALOG})\\b(?!::text)`, "g"))
        // `x.relname || …`
        .concat(matches(body, new RegExp(`\\w+\\.(?:${CATALOG})\\b(?!::text)\\s*\\|\\|`, "g")))
        // `string_agg(x.relname, …)`
        .concat(matches(body, new RegExp(`string_agg\\(\\s*\\w+\\.(?:${CATALOG})\\b(?!::text)`, "g")))
        .map((hit) => hit.trim());
      expect(`${name}:${JSON.stringify(unique(offenders))}`).toBe(`${name}:[]`);
    }
  });
});

describe("the token boundary", () => {
  it("no function anywhere accepts a raw renewal token", () => {
    for (const [name, sql] of Object.entries(ALL_SQL)) {
      // A parameter literally named p_token, i.e. p_token not followed by _.
      expect(`${name}:${/\bp_token\b(?!_)/.test(stripComments(sql))}`).toBe(`${name}:false`);
    }
  });

  it("exactly three functions take p_token_hash, and every one pins its format", () => {
    const takers = ENTRY_POINTS.filter((fn) =>
      new RegExp(`create function public\\.${fn}\\(\\s*\\n\\s*p_token_hash text`).test(migration) ||
      new RegExp(`create function public\\.${fn}\\([^)]*p_token_hash\\s+text`, "s").test(migration)
    );
    expect(takers.sort()).toEqual([
      "vam071_create_renewal_invite",
      "vam071_submit_renewal_accepted",
      "vam071_submit_renewal_declined"
    ].sort());
    for (const fn of takers) {
      expect(`${fn}:${functionBody(migration, fn).includes("^[0-9a-f]{64}$")}`).toBe(`${fn}:true`);
    }
  });

  it("no audit row ever records the token hash", () => {
    for (const fn of ENTRY_POINTS) {
      const body = functionBody(migration, fn);
      if (!body.includes("admin_audit_log")) continue;
      const auditBlock = body.slice(body.indexOf("insert into public.admin_audit_log"));
      expect(`${fn}:${auditBlock.includes("p_token_hash")}`).toBe(`${fn}:false`);
      expect(`${fn}:${auditBlock.includes("token_hash")}`).toBe(`${fn}:false`);
    }
  });
});

describe("P0-RT-3 — the submit paths are transactionally single-winner", () => {
  const SUBMIT = ["vam071_submit_renewal_accepted", "vam071_submit_renewal_declined"];

  it("both lock the invite row FOR UPDATE before deciding anything", () => {
    for (const fn of SUBMIT) {
      const body = functionBody(migration, fn).replace(/\s+/g, " ");
      expect(`${fn}:${/from public\.person_season_invites i where i\.token_hash = p_token_hash for update/.test(body)}`)
        .toBe(`${fn}:true`);
    }
  });

  it("both claim conditionally and assert an exact single-row claim", () => {
    for (const fn of SUBMIT) {
      const body = functionBody(migration, fn).replace(/\s+/g, " ");
      expect(`${fn}:claim:${/update public\.person_season_invites i set [^;]*where i\.id = v_inv\.id and i\.submitted_at is null/.test(body)}`)
        .toBe(`${fn}:claim:true`);
      expect(`${fn}:rowcount:${body.includes("get diagnostics v_rows = row_count")}`).toBe(`${fn}:rowcount:true`);
      expect(`${fn}:assert:${body.includes("if v_rows <> 1 then")}`).toBe(`${fn}:assert:true`);
    }
  });

  it("both re-apply the complete gate predicate inside the transaction", () => {
    for (const fn of SUBMIT) {
      const body = functionBody(migration, fn).replace(/\s+/g, " ");
      for (const predicate of [
        "v_inv.revoked_at is not null",
        "v_inv.expires_at <= now()",
        "v_inv.submitted_at is not null"
      ]) {
        expect(`${fn}:${predicate}:${body.includes(predicate)}`).toBe(`${fn}:${predicate}:true`);
      }
    }
  });

  it("the accept path writes person_id at INSERT, derived from the locked invite", () => {
    const body = functionBody(migration, "vam071_submit_renewal_accepted").replace(/\s+/g, " ");
    expect(body).toContain("insert into public.applications ( person_id, season_id,");
    expect(body).toContain("values ( v_inv.person_id, v_inv.season_id,");
  });

  it("the decline path creates no applications row at all", () => {
    const body = functionBody(migration, "vam071_submit_renewal_declined");
    expect(body).not.toContain("insert into public.applications");
  });

  it("every refusal on both submit paths raises the identical message and SQLSTATE", () => {
    // A per-reason message or per-reason errcode would let an unauthenticated
    // probe distinguish "no such token" from "revoked" from "already renewed".
    // PostgREST returns both, so both must be uniform.
    const RAISE = /raise exception '([^']*)'\s*using errcode = '(\d{5}[A-Z0-9]*)'/g;
    let messages: string[] = [];
    let codes: string[] = [];
    for (const fn of SUBMIT) {
      const body = functionBody(migration, fn);
      const found = captures(body, RAISE, 1)
        // The trusted-context guard is not a token refusal: it is reachable
        // only by a caller that is not service_role at all.
        .filter((message) => !message.includes("trusted server context"));
      expect(`${fn}:refusals:${found.length > 0}`).toBe(`${fn}:refusals:true`);
      messages = messages.concat(found);
      codes = codes.concat(
        captures(body, RAISE, 2).filter(
          (_code, i) => !captures(body, RAISE, 1)[i].includes("trusted server context")
        )
      );
    }
    expect(unique(messages)).toEqual(["VAM071 renewal submission refused"]);
    expect(unique(codes)).toEqual(["42501"]);
  });

  it("the distinguishing reason goes to the server log, never to the caller", () => {
    for (const fn of SUBMIT) {
      const body = functionBody(migration, fn);
      expect(`${fn}:${(body.match(/raise log '/g) ?? []).length > 0}`).toBe(`${fn}:true`);
    }
  });
});

describe("P0-RT-1 and P0-RT-2 — the accepted-renewal refusal", () => {
  const DECIDERS = [
    "vam071_create_renewal_invite",
    "vam071_submit_renewal_accepted",
    "vam071_submit_renewal_declined"
  ];

  it("all three deciding paths take the identity lock before evaluating it", () => {
    for (const fn of DECIDERS) {
      const body = functionBody(migration, fn);
      const lockAt = body.indexOf("vam071_renewal_identity_lock(");
      const predicateAt = body.indexOf("vam071_accepted_renewal_exists(");
      expect(`${fn}:lock:${lockAt >= 0}`).toBe(`${fn}:lock:true`);
      expect(`${fn}:predicate:${predicateAt >= 0}`).toBe(`${fn}:predicate:true`);
      // Order is the whole point: an unlocked read of the predicate is
      // advisory, and P0-RT-2 requires it to be authoritative.
      expect(`${fn}:order:${lockAt < predicateAt}`).toBe(`${fn}:order:true`);
    }
  });

  it("the decline refuses before it records anything and before it touches a membership", () => {
    const body = functionBody(migration, "vam071_submit_renewal_declined");
    const refusalAt = body.indexOf("vam071_accepted_renewal_exists(");
    const claimAt = body.indexOf("update public.person_season_invites i");
    const membershipAt = body.indexOf("vam063_opt_out_membership(");
    expect(refusalAt).toBeGreaterThan(0);
    expect(refusalAt).toBeLessThan(claimAt);
    expect(refusalAt).toBeLessThan(membershipAt);
  });

  it("the identity lock is transaction-scoped and keyed on person+season+role", () => {
    const body = functionBody(migration, "vam071_renewal_identity_lock").replace(/\s+/g, " ");
    expect(body).toContain("pg_advisory_xact_lock(");
    expect(body).toContain("'VAM071_RENEWAL|' || p_person_id::text || '|' || p_season_id::text || '|' || p_role");
    expect(body).not.toContain("pg_advisory_lock(");
  });

  it("the create path refuses a live invite rather than silently replacing one", () => {
    const body = functionBody(migration, "vam071_create_renewal_invite");
    expect(body).toContain("i.revoked_at is null and i.submitted_at is null");
    expect(body).toContain("revoke it before issuing another");
    // Regeneration is revoke + create, so there is no regenerate flag and no
    // third audit value.
    expect(body).not.toContain("p_allow_regenerate");
    expect(migration).not.toContain("regenerate_renewal_invite");
  });
});

describe("P0-RT-5 — lineage fields are structurally unreachable", () => {
  it("the SQL ceiling and the TypeScript renewal allowlist are the same field set", () => {
    // The TS module is the source of truth; the SQL list is a ceiling. They
    // are asserted equal here so a field added to one and not the other is a
    // failing test rather than a silent refusal at runtime.
    const everyKnownPayloadField = {
      company_current: "Acme",
      title_current: "Head of X",
      function_primary: "Finance",
      industry_primary: "Banking",
      years_of_experience: "11-15",
      first_vam_season: "S12",
      prior_vam_involvement: "mentor S11",
      mentoring_capacity_total: 2,
      mentor_total_work_years: 12
    };
    const tsFields = Object.keys(buildRenewalProfileRefresh(everyKnownPayloadField)).sort();
    expect(tsFields).toEqual([...SQL_CEILING].sort());
  });

  it("the SQL ceiling is exactly what the confirm function declares", () => {
    const body = functionBody(migration, "vam071_confirm_renewal_profile").replace(/\s+/g, " ");
    const declared = body.slice(body.indexOf("v_ceiling constant text[] := array["));
    for (const field of SQL_CEILING) {
      expect(`${field}:${declared.includes(`'${field}'`)}`).toBe(`${field}:true`);
    }
  });

  it("both lineage fields are refused by name in SQL and stripped in TypeScript", () => {
    const body = functionBody(migration, "vam071_confirm_renewal_profile").replace(/\s+/g, " ");
    expect(body).toContain("v_forbidden constant text[] := array[ 'first_vam_season', 'prior_vam_involvement' ]");
    expect(body).toContain("if v_key = any (v_forbidden) then");
    expect([...RENEWAL_STRIPPED_PROFILE_FIELDS].sort()).toEqual(
      ["first_vam_season", "prior_vam_involvement"].sort()
    );
  });

  it("the raw_payload envelope the accept RPC writes yields NOTHING to buildMentorProfileRefresh", () => {
    // THE reason the nesting exists. approveApplication runs
    // buildMentorProfileRefresh over applications.raw_payload and would write
    // canonical columns — including first_vam_season — straight from an
    // unauthenticated submission. Nesting the submission under 'renewal'
    // leaves the top level with four keys that allowlist does not know.
    const submitted = {
      company_current: "New Employer",
      title_current: "New Title",
      function_primary: "Operations",
      industry_primary: "Retail",
      years_of_experience: "16+",
      first_vam_season: "S12",
      mentoring_capacity_total: 3,
      mentor_total_work_years: 17
    };
    const envelope = {
      source: "s12_mentor_renewal",
      renewal_invite_id: "00000000-0000-0000-0000-000000000000",
      renewal_submitted_at: "2026-08-17T00:00:00.000Z",
      renewal: submitted
    };
    expect(buildMentorProfileRefresh(envelope)).toEqual({});
    // And the same payload NOT nested would have written seven columns — this
    // is what the nesting prevents, asserted rather than described.
    expect(Object.keys(buildMentorProfileRefresh(submitted)).length).toBeGreaterThan(0);
    expect(buildMentorProfileRefresh(submitted)).toHaveProperty("first_vam_season");
  });

  it("the accept RPC nests the payload and adds no top-level key the allowlist knows", () => {
    const body = functionBody(migration, "vam071_submit_renewal_accepted").replace(/\s+/g, " ");
    expect(body).toContain(
      "jsonb_build_object( 'source', 's12_mentor_renewal', 'renewal_invite_id', v_inv.id, 'renewal_submitted_at', v_now, 'renewal', p_raw_payload )"
    );
    const envelopeKeys = ["source", "renewal_invite_id", "renewal_submitted_at", "renewal"];
    const allowlistKeys = Object.keys(
      buildMentorProfileRefresh({
        company_current: "a", title_current: "b", function_primary: "c", industry_primary: "d",
        years_of_experience: "e", first_vam_season: "f", mentoring_capacity_total: 1,
        mentor_total_work_years: 2
      })
    );
    for (const key of envelopeKeys) {
      expect(`${key}:${allowlistKeys.includes(key)}`).toBe(`${key}:false`);
    }
  });
});

describe("P0-RT-4, P0-RT-6 and P0-RT-7 — the admin confirm boundary", () => {
  const body = () => functionBody(migration, "vam071_confirm_renewal_profile").replace(/\s+/g, " ");

  it("locks the canonical profile and requires it to be unambiguous", () => {
    expect(body()).toContain("from public.mentor_profiles mp where mp.person_id = v_inv.person_id for update");
    expect(body()).toContain("does not have exactly one mentor profile");
  });

  it("refuses on drift with a 40001 rather than applying silently", () => {
    expect(body()).toContain("changed since this diff was shown");
    expect(body()).toContain("errcode = '40001'");
  });

  it("writes no profile column when the fresh write set is empty", () => {
    const b = body();
    const guard = b.indexOf("if array_length(v_applied, 1) is not null then");
    const update = b.indexOf("update public.mentor_profiles mp set");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(update);
  });

  it("audits atomically, attributed to the current confirming admin", () => {
    const b = body();
    expect(b).toContain("insert into public.admin_audit_log");
    expect(b).toContain("'confirm_renewal', 'confirm_renewal', v_actor.id");
    // Never the invite's issuer — P0-RT-7.
    expect(b).not.toContain("v_inv.created_by");
    // before_data is the FRESH state actually overwritten, and the diff the
    // admin was shown is retained separately.
    expect(b).toContain("v_before_js");
    expect(b).toContain("'confirmed_diff', p_diff");
  });

  it("verifies the application/invite binding exactly before writing anything", () => {
    const b = body();
    const bindingAt = b.indexOf("application does not match its renewal invite binding");
    const updateAt = b.indexOf("update public.mentor_profiles mp set");
    expect(bindingAt).toBeGreaterThan(0);
    expect(bindingAt).toBeLessThan(updateAt);
  });

  it("uses a static column list and never dynamic SQL", () => {
    const b = body();
    expect(b).not.toContain("execute format(");
    expect(b).not.toMatch(/\bexecute\s+'/);
    for (const field of SQL_CEILING) {
      expect(`${field}:${b.includes(`p_profile_update ? '${field}'`)}`).toBe(`${field}:true`);
    }
  });
});

describe("decline semantics", () => {
  const body = () => functionBody(migration, "vam071_submit_renewal_declined").replace(/\s+/g, " ");

  it("resolves the membership strictly by the invite's own season", () => {
    expect(body()).toContain(
      "where m.person_id = v_inv.person_id and m.season_id = v_inv.season_id and m.role = v_inv.role"
    );
  });

  it("delegates the opt-out to vam063 and invents no membership status", () => {
    const b = body();
    expect(b).toContain("vam063_opt_out_membership(");
    expect(b).not.toContain("insert into public.person_season_memberships");
    expect(b).not.toContain("update public.person_season_memberships");
    // Only statuses the existing vocabulary already defines.
    for (const invented of ["renewal_declined", "not_renewing", "lapsed"]) {
      expect(`${invented}:${b.includes(invented)}`).toBe(`${invented}:false`);
    }
  });

  it("never calls vam063 for a terminal membership status", () => {
    const b = body();
    expect(b).toContain("v_mem.status <> all (array['active', 'paused', 'invited'])");
    expect(b).toContain("'not_eligible'");
  });

  it("defers rather than forces when the attributable admin is no longer authorized", () => {
    expect(body()).toContain("'deferred_actor_unauthorized'");
  });

  it("takes no mentor-supplied payload at all", () => {
    expect(migration).toContain("create function public.vam071_submit_renewal_declined(\n  p_token_hash text\n)");
  });
});

describe("authorization, grants and RLS posture", () => {
  it("every function is SECURITY DEFINER with a pinned search_path", () => {
    for (const fn of [...ENTRY_POINTS, ...HELPERS]) {
      const decl = migration.slice(
        migration.indexOf(`create function public.${fn}(`),
        migration.indexOf("$$", migration.indexOf(`create function public.${fn}(`))
      );
      expect(`${fn}:definer:${decl.includes("security definer")}`).toBe(`${fn}:definer:true`);
      expect(`${fn}:path:${decl.includes("set search_path = public, pg_temp")}`).toBe(`${fn}:path:true`);
    }
  });

  it("every entry point resolves the trusted context through vam063_trusted_api_role", () => {
    // NOT current_setting('request.jwt.claim.role'), which PostgREST v10+ no
    // longer populates — the exact defect M064 exists to remediate and which
    // the S12 release T3 built out from the first line.
    for (const fn of ENTRY_POINTS) {
      const body = functionBody(migration, fn);
      expect(`${fn}:${body.includes("public.vam063_trusted_api_role()")}`).toBe(`${fn}:true`);
      expect(`${fn}:${body.includes("request.jwt.claim.role")}`).toBe(`${fn}:false`);
    }
  });

  it("every admin entry point re-checks scope through vam063_authorized_for_scope", () => {
    for (const fn of ["vam071_create_renewal_invite", "vam071_revoke_renewal_invite", "vam071_confirm_renewal_profile"]) {
      expect(`${fn}:${functionBody(migration, fn).includes("vam063_authorized_for_scope(")}`).toBe(`${fn}:true`);
    }
  });

  it("revokes from every role first, then grants only the entry points to service_role", () => {
    const revokeAt = migration.indexOf("revoke all on function");
    const grantAt = migration.indexOf("grant execute on function", revokeAt);
    expect(revokeAt).toBeGreaterThan(0);
    expect(grantAt).toBeGreaterThan(revokeAt);

    // Each statement is bounded at its own terminating semicolon; without that
    // the "granted" slice runs on into Section 9, whose post-condition arrays
    // name the helpers and would make this assertion pass for the wrong reason.
    const revoked = migration.slice(revokeAt, migration.indexOf(";", revokeAt) + 1);
    const granted = migration.slice(grantAt, migration.indexOf(";", grantAt) + 1);

    expect(revoked).toContain("from public, anon, authenticated, service_role;");
    for (const fn of [...ENTRY_POINTS, ...HELPERS]) {
      expect(`${fn}:revoked:${revoked.includes(fn)}`).toBe(`${fn}:revoked:true`);
    }
    for (const fn of ENTRY_POINTS) {
      expect(`${fn}:granted:${granted.includes(fn)}`).toBe(`${fn}:granted:true`);
    }
    for (const fn of HELPERS) {
      expect(`${fn}:not-granted:${granted.includes(fn)}`).toBe(`${fn}:not-granted:false`);
    }
    expect(granted).toContain("to service_role;");
    expect(granted).not.toContain("to anon");
    expect(granted).not.toContain("to authenticated");
  });

  it("touches no RLS, no policy and no table grant", () => {
    const body = stripComments(migration);
    for (const forbidden of [
      "enable row level security",
      "disable row level security",
      "create policy",
      "drop policy",
      "grant select",
      "grant insert",
      "grant update",
      "grant delete",
      "alter table"
    ]) {
      expect(`${forbidden}:${body.toLowerCase().includes(forbidden)}`).toBe(`${forbidden}:false`);
    }
  });

  it("creates no table, index, constraint or trigger", () => {
    const body = stripComments(migration).toLowerCase();
    for (const forbidden of ["create table", "create index", "create unique index", "create trigger"]) {
      expect(`${forbidden}:${body.includes(forbidden)}`).toBe(`${forbidden}:false`);
    }
  });

  it("writes no row at migration time — every INSERT is inside a function body", () => {
    // `vam071_create_renewal_invite` legitimately INSERTs an invite, but only
    // when a runtime caller invokes it. A migration that mints a bearer token
    // is not a migration, so what matters is that no INSERT sits at the top
    // level of the file, where applying it would execute the write.
    const top = stripDollarQuoted(stripComments(migration)).toLowerCase();
    // Anchored at the start of a line: `p_profile_update jsonb` in a function
    // signature is a parameter name, not an UPDATE statement.
    const statements = Array.from(top.matchAll(/^\s*(insert|update|delete)\s/gm)).map((m) => m[1]);
    expect(statements).toEqual([]);
    // …and the invite INSERT really is inside the create function, so the
    // assertion above is not passing because the statement vanished.
    expect(functionBody(migration, "vam071_create_renewal_invite"))
      .toContain("insert into public.person_season_invites");
  });
});

describe("M070 and Season 11 are untouched", () => {
  it("no artifact re-authors person_season_invites", () => {
    for (const [name, sql] of Object.entries(ALL_SQL)) {
      const body = stripComments(sql).toLowerCase();
      expect(`${name}:${body.includes("create table public.person_season_invites")}`).toBe(`${name}:false`);
      expect(`${name}:${body.includes("drop table")}`).toBe(`${name}:false`);
      expect(`${name}:${body.includes("alter table public.person_season_invites")}`).toBe(`${name}:false`);
    }
  });

  it("no artifact drops or alters a vam063 function", () => {
    for (const [name, sql] of Object.entries(ALL_SQL)) {
      const body = stripComments(sql);
      expect(`${name}:${/drop function[^;]*vam063/i.test(body)}`).toBe(`${name}:false`);
      expect(`${name}:${/create (or replace )?function public\.vam063/i.test(body)}`).toBe(`${name}:false`);
    }
  });

  it("the rollback drops only vam071 functions and never a table", () => {
    const body = stripComments(rollback);
    const drops = Array.from(body.matchAll(/drop function if exists public\.(\w+)/g)).map((m) => m[1]);
    expect(drops.sort()).toEqual([...ENTRY_POINTS, ...HELPERS].sort());
    expect(body.toLowerCase()).not.toContain("drop table");
    expect(body.toLowerCase()).not.toContain("delete from");
  });

  it("no executable statement anywhere references Season 11", () => {
    for (const [name, sql] of Object.entries(ALL_SQL)) {
      const body = stripComments(sql);
      // The S11 refusal in the create path and the S11 data assertions in the
      // verifier are the only places the string may appear, and both are
      // refusals rather than reads of S11 state.
      const hits = Array.from(body.matchAll(/S11/g)).length;
      if (name === "migration" || name === "apply") {
        expect(`${name}:${hits}`).toBe(`${name}:1`);
        expect(body).toContain("v_season_code like '%S11%'");
      } else if (name === "verifier") {
        expect(body).toContain("s.code like '%S11%'");
      } else {
        expect(`${name}:${hits}`).toBe(`${name}:0`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Independent security review remediation — H-1, M-1, M-2, M-3.
//
// Each block below pins the REMEDIATED property, not the prose around it: the
// type gate that makes the accept path's write meaning-stable, the transaction
// timestamp that replaced current_date, the five measured authorization
// evidence fields that replaced a stale narrative claim, and the two normative
// runtime contracts (P0-RT-10, P0-RT-11) whose specifications are the entire
// deliverable for a package that deliberately ships no code for them.
// ---------------------------------------------------------------------------

describe("M-2 — the applications.submitted_at type contract", () => {
  const SUPPORTED = "array['date', 'timestamp with time zone']::text[]";

  it("the preflight, the migration and apply all gate the column's TYPE, not only its presence", () => {
    for (const [name, sql] of Object.entries({ migration, apply, preflight })) {
      expect(`${name}:tag:${sql.includes("[APPLICATION_SUBMITTED_AT_TYPE]")}`).toBe(`${name}:tag:true`);
      const body = stripComments(sql).replace(/\s+/g, " ");
      // The gate reads the live catalog rather than trusting a repository
      // artifact, and refuses anything outside the two supported shapes.
      expect(`${name}:read:${/format_type\(a\.atttypid, a\.atttypmod\) into v_txt/.test(body)}`)
        .toBe(`${name}:read:true`);
      expect(`${name}:supported:${body.includes(`v_txt <> all (${SUPPORTED})`)}`)
        .toBe(`${name}:supported:true`);
    }
  });

  it("every artifact names the same two supported shapes and no third", () => {
    // A third shape appearing in one file and not another is exactly how a
    // gate stops being a gate. `date` and `timestamp with time zone` are the
    // only two the repository's own schema history justifies.
    for (const [name, sql] of Object.entries(ALL_SQL)) {
      const declared = unique(captures(stripComments(sql), /array\[('date', 'timestamp with time zone')\]/g));
      if (name === "rollback") {
        expect(`${name}:${JSON.stringify(declared)}`).toBe(`${name}:[]`);
      } else {
        expect(`${name}:${JSON.stringify(declared)}`).toBe(
          `${name}:${JSON.stringify(["'date', 'timestamp with time zone'"])}`
        );
      }
    }
  });

  it("the verifier re-proves the type contract after apply and FAILS on a third shape", () => {
    expect(verifier).toContain("'V27', 'applications_submitted_at_type_contract'");
    const v27 = verifier.slice(verifier.indexOf("'V27'"), verifier.indexOf("'V28'"));
    expect(v27.replace(/\s+/g, " ")).toContain(`= any (${SUPPORTED})`);
    expect(v27).toContain("then 'PASS' else 'FAIL' end");
    // Type-stable on PG15: the detail is text in every branch.
    expect(v27).toContain("'<absent>'");
  });
});

describe("M-2 — the accept path records the transaction timestamp", () => {
  const accept = () => stripComments(functionBody(migration, "vam071_submit_renewal_accepted")).replace(/\s+/g, " ");

  it("writes v_now into applications.submitted_at, never current_date", () => {
    const body = accept();
    // The INSERT's last value is submitted_at. current_date would discard the
    // time of day on a timestamptz column while the invite row records the
    // same submission to the microsecond.
    expect(body).toContain("'renewal', p_raw_payload ), v_now ) returning id into v_app_id");
    expect(`current_date:${body.includes("current_date")}`).toBe("current_date:false");
  });

  it("uses the SAME v_now for the application row and for the invite claim", () => {
    const body = accept();
    const assigned = body.indexOf("v_now := now();");
    const inserted = body.indexOf("insert into public.applications");
    const claimed = body.indexOf("update public.person_season_invites i set submitted_at = v_now");
    expect(assigned).toBeGreaterThan(0);
    expect(inserted).toBeGreaterThan(assigned);
    expect(claimed).toBeGreaterThan(inserted);
    // Assigned exactly once, so the two records of one submission cannot drift.
    expect(matches(body, /v_now := now\(\)/g).length).toBe(1);
  });

  it("needs no dynamic SQL to support either column shape", () => {
    for (const [name, sql] of Object.entries(ALL_SQL)) {
      const body = stripComments(sql).toLowerCase();
      for (const forbidden of ["execute format(", "execute '", "quote_ident("]) {
        expect(`${name}:${forbidden}:${body.includes(forbidden)}`).toBe(`${name}:${forbidden}:false`);
      }
    }
  });
});

describe("H-1 — the WP1-A2 authorization state is measured, not narrated", () => {
  const EVIDENCE = [
    "active_super_admins=",
    "admins_scoped_for_s12=",
    "scope_rows_uuid_program=",
    "scope_rows_nonuuid_program=",
    "uehm_s12_season_rows="
  ];

  it("BLOCK 2 emits all five authorization evidence fields", () => {
    for (const field of EVIDENCE) {
      expect(`${field}:${preflight.includes(field)}`).toBe(`${field}:true`);
    }
  });

  it("the evidence is read from the live catalog with the RPC's own predicate", () => {
    const body = stripComments(preflight).replace(/\s+/g, " ");
    // admins_scoped_for_s12 must evaluate what vam063_authorized_for_scope
    // evaluates, or it is reporting a different question's answer.
    expect(body).toContain("s.program_id = se.program_id::text and s.season_id = se.id::text");
    // The UUID-shape split is on ACTIVE rows only — retired grants carry no
    // authority and would make the count unreadable.
    expect(body).toContain("from public.admin_scope_access s where s.status = 'active'");
    expect(body).toContain("from public.seasons se where se.code = 'UEHM-S12'");
  });

  it("no artifact asserts the stale WP1-A2 claims as current fact", () => {
    // The three claims the independent review proved stale: that WP1-A2 is
    // authored-but-unexecuted, that Production still stores codes, and that
    // create/revoke/confirm are necessarily super_admin-only today.
    for (const [name, text] of Object.entries({ readme, preflight, apply, migration, verifier })) {
      const stale = [
        /WP1-A2[^.]{0,120}?(?:is authored|authored, not executed|authored but not executed|until WP1-A2)/i,
        /stores\s+codes/i,
        /super_admin-only/i
      ].filter((re) => re.test(text)).map((re) => re.source);
      expect(`${name}:${JSON.stringify(stale)}`).toBe(`${name}:[]`);
    }
  });

  it("replaces them with the release-record framing rather than a live claim", () => {
    for (const [name, text] of Object.entries({ readme, preflight })) {
      expect(`${name}:record:${/release record/i.test(text)}`).toBe(`${name}:record:true`);
      expect(`${name}:wp1a2:${text.includes("WP1-A2")}`).toBe(`${name}:wp1a2:true`);
    }
    // Stated as an expectation to read the evidence against, never as a gate.
    expect(readme).toContain("evidence outputs, not repository facts and not gates");
  });

  it("weakens no refusal — every preflight gate is still raised", () => {
    for (const tag of [
      "[ENV_NOT_PRODUCTION]",
      "[UUID_FN_MISSING]",
      "[PREREQ_TABLE_MISSING]",
      "[M070_ARBITER_MISSING]",
      "[M070_CONTRACT_DRIFT]",
      "[LIFECYCLE_MISSING]",
      "[LIFECYCLE_NOT_EXECUTABLE]",
      "[LIFECYCLE_HARDENING]",
      "[AUDIT_VOCAB_MISSING]",
      "[AUDIT_CONTRACT]",
      "[FORCE_RLS_SET]",
      "[ALREADY_APPLIED]",
      "[PROFILE_COLUMN_CONTRACT]",
      "[APPLICATION_COLUMN_CONTRACT]",
      "[APPLICATION_SUBMITTED_AT_TYPE]",
      "[APPLICATION_STATUS_VOCAB]",
      "[APPLICATION_SOURCE_VOCAB]",
      "[APPLICATION_ROLE_VOCAB]"
    ]) {
      expect(`${tag}:${new RegExp(`raise exception 'M071 PREFLIGHT REFUSED \\${tag}`).test(preflight)}`)
        .toBe(`${tag}:true`);
    }
  });
});

describe("P0-RT-10 — membership restoration is specified over the existing vam063 surface", () => {
  it("the README states the whole status mapping, including every fail-closed state", () => {
    expect(readme).toContain("P0-RT-10");
    for (const fragment of [
      "vam063_add_membership_role",
      "vam063_reactivate_membership",
      "`opted_out`",
      "`paused`",
      "`invited`",
      "`withdrawn`, `cancelled`",
      "fail-closed"
    ]) {
      expect(`${fragment}:${readme.includes(fragment)}`).toBe(`${fragment}:true`);
    }
    // The actor is the confirming admin, not the invite's issuer.
    expect(readme).toContain("**current confirming Admin** in every branch");
  });

  it("names no invented lifecycle status and no duplicate membership", () => {
    for (const invented of ["renewal_declined", "not_renewing", "lapsed", "renewed"]) {
      expect(`${invented}:${new RegExp(`status[^.\\n]{0,40}'${invented}'`).test(readme)}`)
        .toBe(`${invented}:false`);
    }
    expect(readme).toContain("No new lifecycle status, no second membership row, no new RPC");
  });

  it("the required vam063 function is a proven prerequisite, in every artifact that gates", () => {
    const SIG = "public.vam063_reactivate_membership(uuid,uuid,text)";
    for (const [name, sql] of Object.entries({ migration, apply, preflight })) {
      expect(`${name}:${sql.includes(SIG)}`).toBe(`${name}:true`);
    }
    // apply Section 0 and the preflight also require service_role to be able to
    // execute it, because the orchestration calls it over PostgREST.
    for (const [name, sql] of Object.entries({ apply, preflight })) {
      const called = sql.slice(sql.indexOf("v_called constant text[] :="));
      expect(`${name}:${called.slice(0, 400).includes("vam063_reactivate_membership")}`).toBe(`${name}:true`);
    }
    expect(verifier).toContain("'V28', 'p0_rt_10_lifecycle_surface_available'");
  });

  it("adds no membership SQL to this package — the requirement is normative, not implemented here", () => {
    for (const [name, sql] of Object.entries(ALL_SQL)) {
      const body = stripComments(sql);
      // Named in prerequisite/verifier inventories only; never invoked.
      expect(`${name}:perform:${/perform\s+public\.vam063_reactivate_membership\s*\(/.test(body)}`)
        .toBe(`${name}:perform:false`);
      expect(`${name}:select:${/from\s+public\.vam063_reactivate_membership\s*\(/.test(body)}`)
        .toBe(`${name}:select:false`);
    }
  });
});

describe("P0-RT-11 — the renewal direct-approval guard", () => {
  it("the README specifies a SERVER-SIDE refusal, not a UI rule", () => {
    expect(readme).toContain("P0-RT-11");
    expect(readme).toContain("**This must be a server-side refusal, not a UI hiding rule.**");
    expect(readme).toContain("`approveApplication` in `lib/application-approvals.ts`");
    expect(readme).toContain("before any write");
  });

  it("specifies the trigger as a union, so neither key alone can be edited around", () => {
    expect(readme).toContain("`applications.source = 's12_mentor_renewal'`");
    expect(readme).toContain("`application_id = applications.id`");
  });

  it("specifies the exact evidence query and its fail-closed semantics", () => {
    for (const fragment of [
      "action_type = 'confirm_renewal'",
      "details ->> 'application_id'",
      "service-role",
      "Zero rows → return the ordinary failure result and **write nothing**",
      "A query **error** must also refuse"
    ]) {
      expect(`${fragment}:${readme.includes(fragment)}`).toBe(`${fragment}:true`);
    }
  });

  it("the evidence the guard depends on is actually written, and written unconditionally", () => {
    const body = stripComments(functionBody(migration, "vam071_confirm_renewal_profile")).replace(/\s+/g, " ");
    expect(body).toContain("insert into public.admin_audit_log");
    expect(body).toContain("'confirm_renewal', 'confirm_renewal',");
    expect(body).toContain("'application_id', p_application_id,");

    // Unconditional: the audit INSERT sits OUTSIDE the `if array_length(
    // v_applied, 1) is not null` block that guards the profile UPDATE, so a
    // confirmation that legitimately applied no field still leaves evidence
    // and a correct renewal is never blocked by its own emptiness.
    const guard = body.indexOf("if array_length(v_applied, 1) is not null then");
    const audit = body.indexOf("insert into public.admin_audit_log");
    expect(guard).toBeGreaterThan(0);
    expect(audit).toBeGreaterThan(guard);
    expect(body.slice(guard, audit)).toContain("end if; end if;");
  });

  it("is deferred to the runtime package, and every artifact says so rather than implying otherwise", () => {
    // The guard lives in a code path M071 does not own. What M071 owes is the
    // specification; a claim to have implemented it would be false, and the
    // migration header states the deferral where a reader meets it first.
    expect(readme).toContain("Not implemented in this SQL-only package");
    for (const [name, sql] of Object.entries({ migration, apply })) {
      expect(`${name}:${sql.includes("P0-RT-11")}`).toBe(`${name}:true`);
      expect(`${name}:${sql.includes("NOT implemented here")}`).toBe(`${name}:true`);
    }
  });
});

describe("README", () => {
  it("carries every P0-RT requirement id", () => {
    for (let i = 1; i <= 11; i += 1) {
      expect(`P0-RT-${i}:${readme.includes(`P0-RT-${i}`)}`).toBe(`P0-RT-${i}:true`);
    }
  });

  it("records the accepted confirm ordering rather than reverting to the old prose", () => {
    expect(readme).toContain("`vam071_confirm_renewal_profile` → membership lifecycle operation → `approveApplication`");
    expect(readme).toContain("The independent review accepted this ordering.");
  });

  it("lists the deferred LOW findings instead of silently widening this remediation", () => {
    for (const deferred of [
      "Blank-integer guard NULL semantics",
      "Normalisation/audit divergence",
      "BLOCK 2 `AUDITCOLS` presentation",
      "Uncast `array[]` style inconsistency",
      "Isolation-level uniform-error nuance"
    ]) {
      expect(`${deferred}:${readme.includes(deferred)}`).toBe(`${deferred}:true`);
    }
  });

  it("states plainly that nothing has been executed", () => {
    expect(readme).toContain("NOT EXECUTED");
  });

  it("names the out-of-scope surfaces so they cannot be quietly added", () => {
    for (const surface of ["/renew/[token]", "/admin/renewals", "mentee renewal", "email delivery"]) {
      expect(`${surface}:${readme.includes(surface)}`).toBe(`${surface}:true`);
    }
  });
});
