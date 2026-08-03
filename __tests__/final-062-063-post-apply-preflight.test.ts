import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const FINAL = "docs/audits/sql/design_only/VAM_OS_FINAL_062_063_POST_APPLY_PREFLIGHT.sql";
const V062 = "docs/audits/sql/design_only/VAM_OS_ACCOUNT_ADMIN_RLS_POST_APPLY_VERIFY.sql";
const V063 = "docs/audits/sql/design_only/VAM_OS_MEMBERSHIP_LIFECYCLE_POST_APPLY_VERIFY.sql";
const READINESS = "docs/audits/sql/design_only/VAM_OS_MEMBERSHIP_LIFECYCLE_PREFLIGHT.sql";
const MIGRATION_062 = "supabase_migrations/062_review_only_account_admin_rls_foundation.sql";
const MIGRATION_063 = "supabase_migrations/063_review_only_membership_lifecycle_operations.sql";
const BASELINE_HEAD = "c64bf4753455a184fb8af9281120e3fdfe804067";

const read = (p: string) => readFileSync(p, "utf8");
const gitShow = (ref: string, p: string) => {
  const r = spawnSync("git", ["show", `${ref}:${p}`], { encoding: "utf8" });
  expect(r.status).toBe(0);
  return r.stdout;
};

/** Strip -- comments AND '...' literals. For statement decomposition / DDL scans. */
function stripped(sql: string): string {
  let out = "";
  let inStr = false;
  let inCmt = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inCmt) { if (ch === "\n") { inCmt = false; out += ch; } continue; }
    if (inStr) { if (ch === "'") { if (sql[i + 1] === "'") i++; else inStr = false; } continue; }
    if (ch === "'") { inStr = true; continue; }
    if (ch === "-" && sql[i + 1] === "-") { inCmt = true; i++; continue; }
    out += ch;
  }
  return out;
}
/** Strip -- comments but KEEP literals. For assertion-text checks. */
function withoutComments(sql: string): string {
  let out = "";
  let inStr = false;
  let inCmt = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inCmt) { if (ch === "\n") { inCmt = false; out += ch; } continue; }
    if (inStr) { out += ch; if (ch === "'") { if (sql[i + 1] === "'") { out += sql[++i]; } else inStr = false; } continue; }
    if (ch === "'") { inStr = true; out += ch; continue; }
    if (ch === "-" && sql[i + 1] === "-") { inCmt = true; i++; continue; }
    out += ch;
  }
  return out;
}
const count = (h: string, n: string) => h.split(n).length - 1;

/** Single-quoted SQL literals, '' un-doubled. */
function sqlLiterals(sql: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] !== "'") continue;
    let cur = "";
    i++;
    for (; i < sql.length; i++) {
      if (sql[i] === "'") { if (sql[i + 1] === "'") { cur += "'"; i++; continue; } break; }
      cur += sql[i];
    }
    out.push(cur);
  }
  return out;
}
/**
 * Policy USING expressions only. Scoped to the expected_policy CTE, because
 * other parenthesised literals exist in the file (e.g. the arbiter's
 * indpred "(status = 'active'::text)") and would otherwise be swept in.
 */
const policyQuals = (sql: string) => {
  const w = withoutComments(sql);
  const start = w.indexOf("expected_policy(t,n,q) as(values");
  const region = start === -1 ? w : w.slice(start, w.indexOf("expected_table(", start));
  return sqlLiterals(region).filter((l) => l.startsWith("(") && l.endsWith(")"));
};

const final = () => read(FINAL);

describe("final 062/063 combined post-apply preflight — shape and safety", () => {
  it("is a single read-only SELECT with no DDL, DML or transaction control", () => {
    const code = stripped(final());
    expect(code.trimStart()).toMatch(/^with\b/i);
    expect((code.match(/;/g) ?? []).length).toBe(1);
    expect(code).not.toMatch(/\b(create|alter|drop|truncate|insert|update|delete|merge|grant|revoke|commit|rollback|begin|savepoint|vacuum|copy)\b/i);
  });

  it("returns exactly one row and one column", () => {
    expect(final().match(/\) final_062_063_post_apply_v1 from normalized;/g)).toHaveLength(1);
  });

  it("reads no business rows (catalog metadata only)", () => {
    const code = stripped(final());
    expect(code).not.toMatch(/\bfrom\s+public\.(people|person_season_memberships|person_season_membership_log|intake_batches|admin_users|admin_audit_log|admin_scope_access)\b/i);
  });

  it("emits every required output field, with failureCount as a numeric aggregate", () => {
    const w = withoutComments(final());
    for (const f of ["'overall_status'", "'final_ready'", "'read_only'", "'failed_assertions'",
                     "'failureCount'", "'migration_062_verified'", "'migration_063_verified'"]) {
      expect(w).toContain(f);
    }
    expect(w).toContain("'failureCount',count(*) filter(where status<>'PASS')");
    expect(w).toContain("'read_only',true");
    expect(w).toContain("'final_ready',bool_and(status='PASS')");
    expect(w).toContain("'overall_status',case when bool_and(status='PASS') then 'PASS' else 'FAIL' end");
    expect(w).toContain("'failed_assertions',coalesce(jsonb_agg(assertion order by assertion)filter(where status<>'PASS'),'[]'::jsonb)");
  });

  it("derives the two per-migration verified flags from their own assertion prefixes", () => {
    const w = withoutComments(final());
    expect(w).toContain("'migration_062_verified',coalesce(bool_and(status='PASS') filter(where assertion like 'm062:%'),false)");
    expect(w).toContain("'migration_063_verified',coalesce(bool_and(status='PASS') filter(where assertion like 'm063:%'),false)");
  });

  it("contains no credential, environment value or connection string", () => {
    const s = final();
    expect(s).not.toMatch(/postgres(ql)?:\/\//i);
    expect(s).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(s).not.toMatch(/password\s*[:=]/i);
    expect(s).not.toMatch(/(api[_-]?key|SERVICE_ROLE_KEY|ANON_KEY)/i);
  });

  it("contains no project ref of any kind", () => {
    // provenance belongs in the generated packet, never in the committed source
    expect(final()).not.toMatch(/[a-z]{20}/);
  });
});

describe("final preflight — corrected polarity vs the pre-apply readiness check", () => {
  it("the pre-apply readiness source still requires ZERO vam063_ functions", () => {
    // documents exactly why that source cannot serve as the post-apply gate
    expect(withoutComments(read(READINESS))).toContain("'package_name_collision'");
    expect(withoutComments(read(READINESS))).toContain("not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'vam063_%')");
  });

  it("the final preflight instead requires the nine functions to be PRESENT", () => {
    const w = withoutComments(final());
    expect(w).toContain("'m063:function_inventory_exact'");
    expect(w).toContain("not exists(select 1 from expected_function_063 e where to_regprocedure('public.'||e.sig) is null)");
    // and must not carry the inverted pre-apply assertion
    expect(w).not.toContain("'package_name_collision'");
  });

  it("pins the inventory to an exact count so no unexpected vam063_ object can hide", () => {
    expect(withoutComments(final())).toContain("p.proname like 'vam063_%')=(select count(*) from expected_function_063)");
  });
});

describe("final preflight — does not weaken the migration-specific verifiers", () => {
  it("reuses the 062 expected policy expressions byte-identically", () => {
    const fromV062 = policyQuals(read(V062)).filter((q) => q.includes("vam062") || q.includes("current_admin_role"));
    const fromFinal = policyQuals(final());
    expect(fromFinal).toHaveLength(7);
    for (const q of fromFinal) expect(fromV062).toContain(q);
  });

  it("compares policy quals with the same symmetric whitespace normalisation", () => {
    const w = withoutComments(final());
    expect(count(w, "btrim(regexp_replace(p.qual,'[[:space:]]+',' ','g'))")).toBe(1);
    expect(count(w, "btrim(regexp_replace(e.q,'[[:space:]]+',' ','g'))")).toBe(1);
    expect(w).not.toMatch(/p\.qual\s*=\s*e\.q/);
    for (const banned of [" like ", " ilike "]) {
      const line = w.split("\n").find((l) => l.includes("'m062:policy:'")) ?? "";
      expect(line.toLowerCase()).not.toContain(banned);
    }
  });

  it("keeps every non-qual policy check exact", () => {
    const line = withoutComments(final()).split("\n").find((l) => l.includes("'m062:policy:'")) ?? "";
    expect(line).toContain("count(p.*)=1");
    expect(line).toContain("p.permissive='PERMISSIVE'");
    expect(line).toContain("p.roles::text[]=array['authenticated']::text[]");
    expect(line).toContain("p.cmd='SELECT'");
    expect(line).toContain("p.with_check is null");
  });

  it("carries the 062 typed constraint breakdown with the independent total guard", () => {
    const w = withoutComments(final());
    for (const f of ["actual_p=con_p", "actual_f=con_f", "actual_u=con_u", "actual_c=con_c"]) expect(w).toContain(f);
    expect(w).toContain("actual_constraints=con_p+con_f+con_u+con_c");
    expect(w).toContain("true,false,1,2,0,11)");
    expect(w).toContain("true,false,1,3,3,2)");
  });

  it("carries the complete 23-row default allow-list, fail-closed", () => {
    const rows = withoutComments(final()).match(/\('account_[a-z_]+','[a-z_]+','[^']*(?:''[^']*)*'\)/g) ?? [];
    expect(rows).toHaveLength(23);
    expect(withoutComments(final())).toContain("is distinct from(select x.d from expected_default x");
    expect(withoutComments(final())).not.toMatch(/else\s+null\s+end/);
    // migration 062 declares account_import_previews.id with no default
    expect(withoutComments(final())).not.toMatch(/\('account_import_previews','id'/);
    expect(withoutComments(final())).toContain("('account_person_auth_links','id','gen_random_uuid()')");
  });

  it("carries the 062 function privilege model unchanged", () => {
    const line = withoutComments(final()).split("\n").find((l) => l.includes("'m062:function:'")) ?? "";
    expect(line).toContain("p.prosecdef");
    expect(line).toContain("p.proconfig@>array['search_path=public']");
    expect(line).toContain("pg_get_userbyid(p.proowner)=current_user");
    expect(line).toContain("not has_function_privilege('anon',p.oid,'execute')");
    expect(line).toContain("not has_function_privilege('authenticated',p.oid,'execute')");
    expect(line).toContain("has_function_privilege('service_role',p.oid,'execute')");
  });

  it("carries the 063 privilege model including the internal/callable split", () => {
    const line = withoutComments(final()).split("\n").find((l) => l.includes("'m063:function:'")) ?? "";
    expect(line).toContain("p.prosecdef");
    expect(line).toContain("not has_function_privilege('anon',p.oid,'execute')");
    expect(line).toContain("not has_function_privilege('authenticated',p.oid,'execute')");
    expect(line).toContain("(e.internal or has_function_privilege('service_role',p.oid,'execute'))");
  });

  it("carries the 063 no-delete and transitions-always-log guarantees verbatim", () => {
    const w = withoutComments(final());
    const src = withoutComments(read(V063));
    const noDelete = "pg_get_functiondef(p.oid) ~* '\\mdelete\\s+from\\s+public\\.(person_season_memberships|person_season_membership_log|people)\\M'";
    expect(w).toContain(noDelete);
    expect(src).toContain(noDelete);
    expect(w).toContain("like '%insert into public.person_season_membership_log%'");
    expect(count(w, "like '%insert into public.person_season_membership_log%'")).toBe(2);
  });

  it("carries the corrected arbiter and full-exact vocabularies", () => {
    const w = withoutComments(final());
    expect(w).toContain("i.indisunique and i.indisvalid and i.indisready and not i.indnullsnotdistinct and i.indnkeyatts=4");
    expect(w).toContain("pg_get_expr(i.indpred,i.indrelid)='(status = ''active''::text)'");
    expect(w).toContain("'state:membership_role_vocabulary_full_exact'");
    expect(w).toContain("'state:membership_status_vocabulary_full_exact'");
    expect(w).toContain("'state:action_type_vocabulary_full_exact'");
    expect(w).toContain("'state:action_type_not_valid'");
  });

  it("preserves the null-season denial clause in all four program-ops policies", () => {
    const scoped = policyQuals(final()).filter((q) => q.includes("admin_scope_access s"));
    expect(scoped).toHaveLength(4);
    for (const q of scoped) expect(q).toContain("(s.season_id IS NOT NULL)");
  });
});

describe("final preflight — expected sets match the committed migrations", () => {
  it("lists all eleven vam062_ functions from the 062 verifier", () => {
    const region = final().slice(final().indexOf("expected_function_062"), final().indexOf("expected_function_063"));
    expect((region.match(/\('vam062_/g) ?? [])).toHaveLength(11);
  });

  it("lists exactly the nine vam063_ signatures the 063 verifier expects", () => {
    const mine = final().slice(final().indexOf("expected_function_063(sig,internal)"), final().indexOf("membership_role_expected"));
    const theirs = read(V063).slice(read(V063).indexOf("expected_function(sig,internal)"), read(V063).indexOf("assertions as("));
    const sigs = (s: string) => {
      const re = /\('(vam063_[^']+)',(true|false)\)/g;
      const out: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(s))) out.push(`${m[1]}|${m[2]}`);
      return out.sort();
    };
    expect(sigs(mine)).toHaveLength(9);
    expect(sigs(mine)).toEqual(sigs(theirs));
  });

  it("lists the full eighteen-value action_type vocabulary", () => {
    const region = final().slice(final().indexOf("action_type_expected(v)"), final().indexOf("membership_role_actual"));
    expect((region.match(/\('[a-z_]+'\)/g) ?? [])).toHaveLength(18);
    for (const v of ["create_membership", "add_membership_role", "remove_membership_role", "pause_membership",
                     "withdraw_membership", "opt_out_membership", "cancel_membership", "reactivate_membership"]) {
      expect(region).toContain(`('${v}')`);
    }
  });

  it("covers all eight migration-062 package tables", () => {
    const region = final().slice(final().indexOf("expected_table(t,cols"), final().indexOf("expected_default(t,col,d)"));
    for (const t of ["account_rls_package_state", "account_rls_package_manifest", "account_import_batches",
                     "account_import_outcomes", "account_auth_reconciliation", "account_auth_operations",
                     "account_person_auth_links", "account_import_previews"]) {
      expect(region).toContain(`('${t}',`);
    }
  });
});

describe("final preflight — migration immutability", () => {
  it("leaves migrations 062 and 063 byte-identical to the baseline", () => {
    expect(read(MIGRATION_062)).toBe(gitShow(BASELINE_HEAD, MIGRATION_062));
    expect(read(MIGRATION_063)).toBe(gitShow(BASELINE_HEAD, MIGRATION_063));
  });

  it("leaves both migration-specific verifiers untouched", () => {
    expect(read(V062)).toBe(gitShow(BASELINE_HEAD, V062));
    expect(read(V063)).toBe(gitShow(BASELINE_HEAD, V063));
  });

  it("leaves the pre-apply readiness source untouched", () => {
    expect(read(READINESS)).toBe(gitShow(BASELINE_HEAD, READINESS));
  });
});
