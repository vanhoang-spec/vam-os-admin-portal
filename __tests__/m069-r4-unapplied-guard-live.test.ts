import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FOREIGN_VAM069_FUNCTIONS,
  M069_OWNED_FUNCTION_NAMES
} from "./support/m069-canonical-definitions";

/**
 * M069 R4 — the unapplied guard, EXECUTED, not only grepped.
 *
 * OPT-IN. Skipped unless `M069_LIVE_PG_URL` points at a DISPOSABLE PostgreSQL
 * superuser connection. It creates and drops throwaway databases, so it must
 * never be pointed at Staging or Production; it refuses any URL whose host is
 * not local.
 *
 *   docker run -d --name m069r4 -p 55432:5432 \
 *     -e POSTGRES_PASSWORD=pg -e POSTGRES_DB=vam postgres:15-alpine
 *   M069_LIVE_PG_URL=postgres://postgres:pg@127.0.0.1:55432/postgres \
 *     npx vitest run __tests__/m069-r4-unapplied-guard-live.test.ts
 *
 * The template database is built from repository artifacts only — the accepted
 * Production baseline reproduction plus the completed S12 release T1..T4 — so
 * the shape under test is the Production shape the forensics reported: the
 * historical `public.vam069_trusted_context_probe()` PRESENT, every M069 object
 * ABSENT, the canonical 52-value audit vocabulary, and the canonical S12 chain.
 */

const PG_URL = process.env.M069_LIVE_PG_URL ?? "";
const ENABLED = PG_URL.length > 0;

const ROOT = join(__dirname, "..");
const PKG = join(ROOT, "VAM_OS_M069_S12_APPLICATION_INTAKE_CONTROL_20260812");
const REL = join(ROOT, "VAM_OS_PROD_S12_RELEASE_20260809");

const read = (p: string) => readFileSync(p, "utf8");

const PREFLIGHT = read(join(PKG, "preflight.sql"));
const APPLY = read(join(PKG, "apply.sql"));
const VERIFIER = read(join(PKG, "verifier.sql"));
const ROLLBACK = read(join(PKG, "rollback.sql"));

/** `\echo` is a psql client directive; strip it before sending over the wire. */
const wire = (sql: string) =>
  sql
    .split("\n")
    .filter((l) => !/^\s*\\/.test(l))
    .join("\n");

/** The exact identity seal the forensics reported for the historical probe. */
const PROBE = "vam069_trusted_context_probe";
const PROBE_SEAL_SQL = `
  select coalesce((
    select p.proname
        || '|' || pg_get_function_identity_arguments(p.oid)
        || '|' || l.lanname
        || '|' || p.prosecdef::text
        || '|' || coalesce(array_to_string(p.proconfig, ','), '')
        || '|' || pg_get_userbyid(p.proowner)
        || '|' || encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex')
        || '|' || coalesce(array_to_string(p.proacl::text[], ' '), '')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where n.nspname = 'public' and p.proname = '${PROBE}'
  ), '<absent>') as seal`;

type Row = Record<string, unknown>;
type Result = { rows: Row[] };
type Client = {
  /** Multi-statement text returns one Result per statement, in order. */
  query: (sql: string) => Promise<Result | Result[]>;
  end: () => Promise<void>;
};

async function connect(database: string): Promise<Client> {
  const pg = await import("pg");
  const PgClient = (pg as { Client?: unknown }).Client ?? (pg as { default: { Client: unknown } }).default.Client;
  const url = new URL(PG_URL);
  if (!["localhost", "127.0.0.1", "::1", "host.docker.internal"].includes(url.hostname)) {
    throw new Error(
      `M069_LIVE_PG_URL host ${url.hostname} is not local. This test creates and drops databases.`
    );
  }
  url.pathname = `/${database}`;
  const c = new (PgClient as new (o: { connectionString: string }) => Client & {
    connect: () => Promise<void>;
  })({ connectionString: url.toString() });
  await c.connect();
  return c;
}

/** The single result set of a one-statement query. */
async function one(c: Client, sql: string): Promise<Row[]> {
  const r = await c.query(sql);
  return (Array.isArray(r) ? r[r.length - 1] : r).rows;
}

/**
 * The verifier is one big SELECT followed by a summary SELECT. Both come back
 * as separate results; the 24-row one is the check table. Splitting the file on
 * `;` would not work — the statement contains `';'` string literals.
 */
async function verifierRows(c: Client): Promise<Array<{ id: string; result: string; detail: string }>> {
  const r = await c.query(wire(VERIFIER));
  const results = Array.isArray(r) ? r : [r];
  const table = results.find((x) => x.rows.length === 24);
  expect(table, "the verifier did not return a 24-row check table").toBeDefined();
  return table!.rows as Array<{ id: string; result: string; detail: string }>;
}

/** Run `sql`; resolve with the raised message instead of throwing. */
async function attempt(c: Client, sql: string): Promise<{ ok: boolean; message: string }> {
  try {
    await c.query(sql);
    return { ok: true, message: "" };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

const TEMPLATE = "m069r4_template";
let admin: Client;
let scenarioSeq = 0;

/** A fresh throwaway database cloned from the Production-shaped template. */
async function scenario(setup?: string): Promise<{ db: string; c: Client }> {
  scenarioSeq += 1;
  const db = `m069r4_sc${scenarioSeq}`;
  await admin.query(`drop database if exists ${db}`);
  await admin.query(`create database ${db} template ${TEMPLATE}`);
  const c = await connect(db);
  if (setup) await c.query(setup);
  return { db, c };
}

describe.skipIf(!ENABLED)("M069 R4 — executed on disposable PostgreSQL", () => {
  beforeAll(async () => {
    admin = await connect("postgres");
    await admin.query(`drop database if exists ${TEMPLATE}`);
    await admin.query(`create database ${TEMPLATE}`);

    const build = await connect(TEMPLATE);
    await build.query(read(join(REL, "validation", "prod_baseline_reproduction.sql")));
    for (const t of [
      "T1_audit_action_type_compat",
      "T2_security_rls_grant_minimum",
      "T3_membership_lifecycle_objects"
    ]) {
      await build.query(wire(read(join(REL, "apply", `${t}.sql`))));
    }
    // T4 is gated on a Probe C result recorded in the session.
    await build.query("select set_config('vam.probe_c_claim_source', 'claims_json', false)");
    await build.query(wire(read(join(REL, "apply", "T4_enable_lifecycle_execution.sql"))));
    await build.end();
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    for (let i = 1; i <= scenarioSeq; i += 1) {
      await admin.query(`drop database if exists m069r4_sc${i}`);
    }
    await admin.query(`drop database if exists ${TEMPLATE}`);
    await admin.end();
  }, 120_000);

  it("the template really is the Production shape the forensics reported", async () => {
    const { c } = await scenario();
    const prefixed = await one(
      c,
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'vam069\\_%' order by 1`
    );
    expect(prefixed.map((r) => r.proname)).toEqual([PROBE]);

    const owned = await one(
      c,
      `select coalesce(to_regclass('public.application_form_controls')::text, '<absent>') as t`
    );
    expect(owned[0].t).toBe("<absent>");

    const vocab = await one(
      c,
      `select count(distinct m[1])::int as n
         from pg_constraint c
         cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([^'']*)''::text', 'g') m
        where c.conrelid = to_regclass('public.admin_audit_log')
          and c.contype = 'c' and pg_get_constraintdef(c.oid) ilike '%action_type%'`
    );
    expect(vocab[0].n).toBe(52);

    const chain = await one(
      c,
      `select count(*)::int as n from public.intake_batches b
         join public.seasons s on s.id = b.season_id
         join public.programs p on p.id = s.program_id
        where b.code = 'UEHM-S12-B1' and s.code = 'UEHM-S12' and p.code = 'UEHM'`
    );
    expect(chain[0].n).toBe(1);
    await c.end();
  }, 60_000);

  // 1 ────────────────────────────────────────────────────────────────────────
  it("passes the object-absence stage on a baseline with no vam069 function", async () => {
    const { c } = await scenario(`drop function public.${PROBE}()`);
    const r = await attempt(c, wire(PREFLIGHT));
    expect(r.message).toBe("");
    expect(r.ok).toBe(true);
    await c.end();
  }, 60_000);

  // 2 ────────────────────────────────────────────────────────────────────────
  it("does NOT refuse FUNCTION_PRESENT when only the historical probe exists", async () => {
    const { c } = await scenario();
    const r = await attempt(c, wire(PREFLIGHT));
    expect(r.message).not.toContain("FUNCTION_PRESENT");
    expect(r.ok).toBe(true);
    await c.end();
  }, 60_000);

  // 3 ────────────────────────────────────────────────────────────────────────
  it("apply Section 0 does not refuse merely because of that probe, and commits", async () => {
    const { c } = await scenario();
    const r = await attempt(c, wire(APPLY));
    expect(r.message).not.toContain("FUNCTION_PRESENT");
    expect(r.ok).toBe(true);

    const t = await one(
      c,
      `select coalesce(to_regclass('public.application_form_controls')::text, '<absent>') as t`
    );
    expect(t[0].t).toBe("application_form_controls");

    const open = await one(
      c,
      `select count(*)::int as n from public.application_form_controls where state <> 'closed'`
    );
    expect(open[0].n).toBe(0);
    await c.end();
  }, 60_000);

  // 4, 5 ────────────────────────────────────────────────────────────────────
  const collisions: Array<[string, string, string]> = [
    [
      "the intended binding function",
      `create function public.vam069_assert_control_binding() returns trigger
         language plpgsql as $f$ begin return new; end $f$`,
      "public.vam069_assert_control_binding()"
    ],
    [
      "a conflicting overload of the binding name",
      `create function public.vam069_assert_control_binding(int) returns void
         language sql as $f$ select $f$`,
      "public.vam069_assert_control_binding(integer)"
    ],
    [
      "the intended toggle RPC",
      `create function public.vam069_set_application_form_state(
         p_actor_admin_user_id uuid, p_intake_batch_code text, p_applicant_role text,
         p_expected_state text, p_new_state text)
       returns table (outcome_status text, previous_state text, new_state text,
                      updated_at timestamptz, actor_email text)
       language sql as $f$ select null::text, null::text, null::text,
                                  null::timestamptz, null::text $f$`,
      "public.vam069_set_application_form_state(p_actor_admin_user_id uuid"
    ],
    [
      "a conflicting overload of the toggle RPC name",
      `create function public.vam069_set_application_form_state(text) returns void
         language sql as $f$ select $f$`,
      "public.vam069_set_application_form_state(text)"
    ]
  ];

  it.each(collisions)(
    "refuses when %s pre-exists — both preflight and Section 0",
    async (_what, setup, identity) => {
      const { c } = await scenario(setup);

      const pre = await attempt(c, wire(PREFLIGHT));
      expect(pre.ok).toBe(false);
      expect(pre.message).toContain("PREFLIGHT REFUSED [FUNCTION_PRESENT]");
      expect(pre.message).toContain(identity);

      const app = await attempt(c, wire(APPLY));
      expect(app.ok).toBe(false);
      expect(app.message).toContain("ABORTED [FUNCTION_PRESENT]");
      expect(app.message).toContain(identity);

      await c.query("rollback");
      const t = await one(
        c,
        `select coalesce(to_regclass('public.application_form_controls')::text, '<absent>') as t`
      );
      expect(t[0].t).toBe("<absent>");
      await c.end();
    },
    60_000
  );

  // 6 ────────────────────────────────────────────────────────────────────────
  it("refuses when application_form_controls already exists", async () => {
    const { c } = await scenario(
      "create table public.application_form_controls (id uuid primary key default gen_random_uuid())"
    );
    const pre = await attempt(c, wire(PREFLIGHT));
    expect(pre.message).toContain("[ALREADY_APPLIED]");
    const app = await attempt(c, wire(APPLY));
    expect(app.message).toContain("[ALREADY_APPLIED]");
    await c.query("rollback");
    await c.end();
  }, 60_000);

  // 7 ────────────────────────────────────────────────────────────────────────
  const partials: Array<[string, string, string]> = [
    [
      "a leftover migration-owned index name",
      `create table public.leftover_a(x int);
       create unique index application_form_controls_batch_role_key on public.leftover_a(x)`,
      "relation application_form_controls_batch_role_key"
    ],
    [
      "a leftover migration-owned trigger name",
      `create table public.leftover_b(x int);
       create function public.leftover_fn() returns trigger language plpgsql
         as $f$ begin return new; end $f$;
       create trigger application_form_controls_binding before insert on public.leftover_b
         for each row execute function public.leftover_fn()`,
      "trigger application_form_controls_binding"
    ],
    [
      "a leftover migration-owned constraint name",
      `create table public.leftover_c(
         x int constraint application_form_controls_state_check check (x > 0))`,
      "constraint application_form_controls_state_check"
    ]
  ];

  it.each(partials)(
    "refuses PARTIAL_M069 on %s, with the probe present",
    async (_what, setup, detail) => {
      const { c } = await scenario(setup);
      const pre = await attempt(c, wire(PREFLIGHT));
      expect(pre.message).toContain("PREFLIGHT REFUSED [PARTIAL_M069]");
      expect(pre.message).toContain(detail);

      const app = await attempt(c, wire(APPLY));
      expect(app.message).toContain("ABORTED [PARTIAL_M069]");
      expect(app.message).toContain(detail);
      await c.query("rollback");
      await c.end();
    },
    60_000
  );

  // 8 ────────────────────────────────────────────────────────────────────────
  it("apply → verifier 24/24 → rollback, with the probe byte-identical throughout", async () => {
    const { c } = await scenario();

    const seal = (await one(c, PROBE_SEAL_SQL))[0].seal as string;
    expect(seal).not.toBe("<absent>");

    expect((await attempt(c, wire(APPLY))).ok).toBe(true);
    expect((await one(c, PROBE_SEAL_SQL))[0].seal).toBe(seal);

    const results = await verifierRows(c);
    expect(results.filter((r) => r.result !== "PASS")).toEqual([]);

    expect((await attempt(c, wire(ROLLBACK))).ok).toBe(true);

    // The migration-owned functions are gone …
    const owned = await one(
      c,
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = any (array[${M069_OWNED_FUNCTION_NAMES.map((n) => `'${n}'`).join(",")}])`
    );
    expect(owned).toEqual([]);
    const t = await one(
      c,
      `select coalesce(to_regclass('public.application_form_controls')::text, '<absent>') as t`
    );
    expect(t[0].t).toBe("<absent>");

    // … and the historical probe is untouched and still callable.
    expect((await one(c, PROBE_SEAL_SQL))[0].seal).toBe(seal);
    const callable = await one(c, `select probe_version from public.${PROBE}()`);
    expect(callable[0].probe_version).toBe("VAM_PROD_S12_PROBE_C_v1");

    const stillPrefixed = await one(
      c,
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'vam069\\_%' order by 1`
    );
    expect(stillPrefixed.map((r) => r.proname)).toEqual(FOREIGN_VAM069_FUNCTIONS);
    await c.end();
  }, 120_000);

  // 9 ────────────────────────────────────────────────────────────────────────
  it("the verifier does not accept the probe in place of a migration-owned function", async () => {
    const { c } = await scenario();
    expect((await attempt(c, wire(APPLY))).ok).toBe(true);

    // Remove exactly the two owned functions. The probe still carries the
    // vam069_ prefix, so a prefix-matching verifier would find "a function".
    await c.query(
      `drop function public.vam069_set_application_form_state(uuid, text, text, text, text);
       drop function public.vam069_assert_control_binding() cascade`
    );

    const rows = await verifierRows(c);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    for (const id of ["V09", "V13", "V14", "V19", "V20", "V21", "V22", "V23"]) {
      expect(`${id}=${byId[id].result}`).toBe(`${id}=FAIL`);
      expect(`${id} detail=${byId[id].detail}`).toBe(`${id} detail=<none>`);
    }
    await c.end();
  }, 120_000);
});
