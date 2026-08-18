/**
 * Migration 066 — selection runs, ranked items, append-only log.
 *
 * Same guarantees as migration 064: additive only, nothing the frozen release
 * package depends on is touched, and the ambient anon/authenticated grants that
 * Supabase attaches to a new public table are closed before COMMIT.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION = "supabase_migrations/066_selection_runs.sql";
const sql = readFileSync(resolve(process.cwd(), MIGRATION), "utf8");

const NEW_TABLES = ["selection_runs", "selection_run_items", "selection_run_log"] as const;

/** Statement bodies with `--` comments removed, so prose never satisfies an assertion. */
const executable = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("migration 066 — transaction boundary and shape", () => {
  it("wraps everything in exactly one explicit transaction", () => {
    expect(executable.match(/^begin;$/gm) ?? []).toHaveLength(1);
    expect(executable.match(/^commit;$/gm) ?? []).toHaveLength(1);
    expect(executable.indexOf("begin;")).toBeLessThan(executable.indexOf("commit;"));
    expect(executable).not.toMatch(/^rollback;/m);
  });

  it("creates all three tables idempotently and reloads the schema cache", () => {
    for (const table of NEW_TABLES) {
      expect(executable).toContain(`create table if not exists public.${table} (`);
    }
    expect(executable.indexOf("notify pgrst")).toBeGreaterThan(executable.indexOf("commit;"));
  });

  it("carries no production or staging project identifier", () => {
    expect(sql).not.toContain("qkkroesfiazsejkzflcd");
    expect(sql).not.toContain("ljfneyuvpxrmejpxsmpz");
  });

  it("checks its prerequisites before creating anything", () => {
    const prereq = executable.indexOf("PREREQ_MISSING");
    expect(prereq).toBeGreaterThan(-1);
    expect(prereq).toBeLessThan(executable.indexOf("create table if not exists"));
    for (const dependency of [
      "public.seasons",
      "public.intake_batches",
      "public.applications",
      "public.admin_users"
    ]) {
      expect(executable).toContain(`to_regclass('${dependency}') is null`);
    }
  });
});

describe("migration 066 — additive only", () => {
  it("only ALTERs the tables it just created, and only to enable RLS", () => {
    const alters = executable.match(/^alter table [^\n;]+;/gm) ?? [];
    expect(alters).toHaveLength(NEW_TABLES.length);
    for (const statement of alters) {
      expect(statement).toMatch(/enable row level security;$/);
      expect(NEW_TABLES.some((table) => statement.includes(`public.${table}`))).toBe(true);
    }
  });

  it("never drops or renames anything", () => {
    expect(executable).not.toMatch(/drop table/i);
    expect(executable).not.toMatch(/drop column/i);
    expect(executable).not.toMatch(/drop constraint/i);
    expect(executable).not.toMatch(/rename/i);
  });

  it("does not write to the tables the frozen release package depends on", () => {
    for (const guarded of [
      "admin_audit_log",
      "applications",
      "application_reviews",
      "person_season_memberships",
      "person_season_membership_log",
      "mentor_season_confirmations"
    ]) {
      expect(executable).not.toMatch(new RegExp(`alter table public\\.${guarded}\\b`));
      expect(executable).not.toMatch(new RegExp(`insert into public\\.${guarded}\\b`));
    }
  });

  it("writes no data of its own", () => {
    expect(executable).not.toMatch(/^\s*insert into/im);
    expect(executable).not.toMatch(/^\s*update public\./im);
    expect(executable).not.toMatch(/^\s*delete from/im);
  });

  it("reuses set_updated_at rather than redefining it", () => {
    expect(executable).toContain("execute function public.set_updated_at()");
    expect(executable).not.toContain("create or replace function public.set_updated_at");
  });
});

describe("migration 066 — privilege contract", () => {
  it("enables RLS on every new table and creates no policy", () => {
    for (const table of NEW_TABLES) {
      expect(executable).toMatch(new RegExp(`alter table public\\.${table}\\s+enable row level security;`));
    }
    expect(executable).not.toMatch(/create policy/i);
  });

  it("revokes every client-role privilege", () => {
    for (const table of NEW_TABLES) {
      const revoke = executable
        .split("\n")
        .find((line) => line.startsWith(`revoke all on public.${table}`));
      expect(revoke, table).toBeDefined();
      expect(revoke).toContain("from public, anon, authenticated;");
    }
  });

  it("grants only to service_role, and never TRUNCATE/REFERENCES/TRIGGER", () => {
    const grants = executable.match(/^grant [^\n;]+;/gm) ?? [];
    expect(grants).toHaveLength(NEW_TABLES.length);
    for (const statement of grants) {
      const privileges = statement.slice("grant".length, statement.indexOf(" on "));
      expect(privileges).not.toMatch(/\btruncate\b/i);
      expect(privileges).not.toMatch(/\breferences\b/i);
      expect(privileges).not.toMatch(/\btrigger\b/i);
      expect(privileges).not.toMatch(/\ball privileges\b/i);
      const grantees = statement.slice(statement.lastIndexOf(" to ") + 4).replace(/;$/, "").trim();
      expect(grantees).toBe("service_role");
    }
  });

  it("keeps the run log insert-only", () => {
    const grant = (executable.match(/^grant [^\n;]+;/gm) ?? []).find((line) =>
      line.includes("public.selection_run_log")
    );
    expect(grant).toBeDefined();
    expect(grant).toContain("select, insert");
    expect(grant).not.toMatch(/\bupdate\b/);
    expect(grant).not.toMatch(/\bdelete\b/);
  });

  it("verifies the contract before COMMIT", () => {
    const firstRevoke = executable.indexOf("revoke all on public.");
    const selfCheck = executable.indexOf("GRANT_CONTRACT_VIOLATION");
    expect(executable.indexOf("create table if not exists")).toBeLessThan(firstRevoke);
    expect(firstRevoke).toBeLessThan(selfCheck);
    expect(selfCheck).toBeLessThan(executable.indexOf("commit;"));
    expect(executable).toContain("RLS_CONTRACT_VIOLATION");
  });
});

describe("migration 066 — run invariants", () => {
  it("restricts a run to the three lifecycle states", () => {
    expect(executable).toContain("check (status in ('draft', 'applied', 'discarded'))");
    expect(executable).toContain("status text not null default 'draft'");
  });

  it("records how the cut was computed, not just its result", () => {
    for (const column of [
      "capacity_total integer not null",
      "reserve_pct smallint not null default 10",
      "scored_count integer not null",
      "unscored_count integer not null",
      "main_count integer not null",
      "reserve_count integer not null"
    ]) {
      expect(executable).toContain(column);
    }
  });

  it("bounds the reserve percentage and forbids negative counts", () => {
    expect(executable).toContain("check (reserve_pct >= 0 and reserve_pct <= 100)");
    expect(executable).toContain("check (capacity_total >= 0)");
    expect(executable).toContain(
      "check (main_count >= 0 and reserve_count >= 0 and scored_count >= 0 and unscored_count >= 0)"
    );
  });

  it("ties applied_at to the applied state in both directions", () => {
    const clause = executable.slice(
      executable.indexOf("selection_runs_applied_shape_check"),
      executable.indexOf("comment on table public.selection_runs")
    );
    expect(clause).toContain("status = 'applied' and applied_at is not null");
    expect(clause).toContain("status <> 'applied' and applied_at is null");
  });

  it("allows only one draft per batch and role", () => {
    expect(executable).toContain("create unique index if not exists selection_runs_one_draft_per_batch_role_idx");
    expect(executable).toContain("on public.selection_runs (intake_batch_id, role_applied)");
    expect(executable).toContain("where status = 'draft'");
  });
});

describe("migration 066 — ranked items", () => {
  it("keeps one row per application per run", () => {
    expect(executable).toContain("selection_run_items_unique_application unique (run_id, application_id)");
  });

  it("uses the three selection groups and avoids the reserved word", () => {
    expect(executable).toContain("check (selection_group in ('main', 'reserve', 'below'))");
    expect(executable).not.toMatch(/^\s+group text/m);
  });

  it("ranks from one upward and stores the score that produced the rank", () => {
    expect(executable).toContain("rank integer not null");
    expect(executable).toContain("check (rank >= 1)");
    expect(executable).toContain("total_score numeric(6, 2) null");
    expect(executable).toContain("review_count smallint not null");
  });

  it("records a promotion out of the reserve group", () => {
    expect(executable).toContain("promoted_at timestamptz null");
    expect(executable).toContain("applied_status text null");
  });

  it("cascades items with their run but never deletes an application", () => {
    expect(executable).toContain("run_id uuid not null references public.selection_runs(id) on delete cascade");
    expect(executable).toContain(
      "application_id uuid not null references public.applications(id) on delete restrict"
    );
  });
});

describe("migration 066 — append-only run log", () => {
  it("blocks UPDATE and DELETE with triggers", () => {
    expect(executable).toContain("create or replace function public.prevent_selection_run_log_mutation()");
    expect(executable).toContain("raise exception 'selection_run_log is append-only'");
    expect(executable).toMatch(/before update on public\.selection_run_log/);
    expect(executable).toMatch(/before delete on public\.selection_run_log/);
  });

  it("restricts the action vocabulary to the run transitions", () => {
    const clause = executable.slice(
      executable.indexOf("selection_run_log_action_check"),
      executable.indexOf("comment on table public.selection_run_log")
    );
    for (const action of ["created", "applied", "discarded", "reserve_promoted"]) {
      expect(clause).toContain(`'${action}'`);
    }
  });
});
