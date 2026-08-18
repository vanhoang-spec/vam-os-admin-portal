/**
 * Migration 068 — assisted-matching runs, the pairs they propose, and the
 * decisions taken on them.
 *
 * The invariants that matter are the ones that keep a proposal a proposal: a
 * pair carries a match id only once somebody approved it, one proposal per
 * mentee per run, and one run at a time per season.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION = "supabase_migrations/068_match_recommendations.sql";
const sql = readFileSync(resolve(process.cwd(), MIGRATION), "utf8");

const NEW_TABLES = [
  "match_recommendation_runs",
  "match_recommendations",
  "match_recommendation_log"
] as const;

/** Statement bodies with `--` comments removed, so prose never satisfies an assertion. */
const executable = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("migration 068 — transaction boundary and shape", () => {
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
      "public.applications",
      "public.people",
      "public.matches",
      "public.admin_users",
      "public.mentor_season_confirmations"
    ]) {
      expect(executable).toContain(`to_regclass('${dependency}') is null`);
    }
  });
});

describe("migration 068 — additive only", () => {
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
    expect(executable).not.toMatch(/alter column/i);
  });

  it("does not touch the tables the frozen release package depends on", () => {
    for (const guarded of [
      "admin_audit_log",
      "applications",
      "application_reviews",
      "matches",
      "people",
      "person_season_memberships",
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
});

describe("migration 068 — a run describes how it was produced", () => {
  it("records provider, model and prompt version", () => {
    expect(executable).toContain("provider text not null default 'deepseek'");
    expect(executable).toContain("model text not null");
    expect(executable).toContain("prompt_version text not null");
  });

  it("has the four lifecycle states and ties completed_at to them", () => {
    expect(executable).toContain("check (status in ('running', 'completed', 'failed', 'discarded'))");
    const clause = executable.slice(
      executable.indexOf("match_recommendation_runs_completed_shape_check"),
      executable.indexOf("match_recommendation_runs_error_shape_check")
    );
    expect(clause).toContain("status = 'running' and completed_at is null");
    expect(clause).toContain("status <> 'running' and completed_at is not null");
  });

  it("keeps an error message only on a failed run", () => {
    expect(executable).toContain("check (status = 'failed' or error is null)");
  });

  it("allows only one run at a time per season", () => {
    expect(executable).toContain("create unique index if not exists match_recommendation_runs_one_active_idx");
    expect(executable).toContain("on public.match_recommendation_runs (season_id)");
    expect(executable).toContain("where status = 'running'");
  });

  it("does not store the prompt text", () => {
    // The payload sent to the provider is anonymised; keeping a copy would
    // re-create the identifiable record.
    expect(executable).not.toMatch(/prompt_text|prompt_body|request_payload/i);
  });
});

describe("migration 068 — a pair stays a proposal until someone approves it", () => {
  it("starts pending and has the four decision states", () => {
    expect(executable).toContain("status text not null default 'pending'");
    expect(executable).toContain(
      "check (status in ('pending', 'approved', 'rejected', 'superseded'))"
    );
  });

  it("carries a match id only when it was approved", () => {
    expect(executable).toContain("check (match_id is null or status = 'approved')");
  });

  it("records when it was decided, and only then", () => {
    const clause = executable.slice(
      executable.indexOf("match_recommendations_decided_shape_check"),
      executable.indexOf("match_recommendations_match_shape_check")
    );
    expect(clause).toContain("status = 'pending' and decided_at is null");
    expect(clause).toContain("status <> 'pending' and decided_at is not null");
  });

  it("proposes one mentor per mentee per run", () => {
    expect(executable).toContain(
      "match_recommendations_unique_mentee unique (run_id, mentee_application_id)"
    );
  });

  it("bounds the score to 0..1 and the round to a small number", () => {
    expect(executable).toContain("check (score is null or (score >= 0 and score <= 1))");
    expect(executable).toContain("check (round >= 1 and round <= 5)");
  });

  it("points at the application, because the mentee has no profile yet", () => {
    expect(executable).toContain(
      "mentee_application_id uuid not null references public.applications(id) on delete restrict"
    );
    expect(executable).toContain(
      "mentee_person_id uuid null references public.people(id) on delete set null"
    );
  });

  it("keeps the pairs when the run row goes, and only then", () => {
    expect(executable).toContain(
      "run_id uuid not null references public.match_recommendation_runs(id) on delete cascade"
    );
    expect(executable).toContain(
      "match_id uuid null references public.matches(id) on delete set null"
    );
  });
});

describe("migration 068 — the log is append-only", () => {
  it("names every action the code writes", () => {
    const check = executable.slice(
      executable.indexOf("match_recommendation_log_action_check"),
      executable.indexOf("comment on table public.match_recommendation_log")
    );
    for (const action of [
      "run_created",
      "run_completed",
      "run_failed",
      "approved",
      "rejected",
      "superseded",
      "discarded"
    ]) {
      expect(check).toContain(`'${action}'`);
    }
  });

  it("blocks UPDATE and DELETE by trigger", () => {
    expect(executable).toContain(
      "create or replace function public.prevent_match_recommendation_log_mutation()"
    );
    expect(executable).toMatch(/before update on public\.match_recommendation_log/);
    expect(executable).toMatch(/before delete on public\.match_recommendation_log/);
    expect(executable).toContain("raise exception 'match_recommendation_log is append-only'");
  });
});

describe("migration 068 — privilege contract", () => {
  it("enables RLS on every new table and creates no policy", () => {
    for (const table of NEW_TABLES) {
      expect(executable).toMatch(
        new RegExp(`alter table public\\.${table}\\s+enable row level security;`)
      );
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

  it("grants only to service_role, and keeps the log insert-only", () => {
    const grants = executable.match(/^grant [^\n;]+;/gm) ?? [];
    expect(grants).toHaveLength(NEW_TABLES.length);
    for (const statement of grants) {
      const privileges = statement.slice("grant".length, statement.indexOf(" on "));
      expect(privileges).not.toMatch(/\btruncate\b/i);
      expect(privileges).not.toMatch(/\ball privileges\b/i);
      expect(statement.slice(statement.lastIndexOf(" to ") + 4).replace(/;$/, "").trim()).toBe(
        "service_role"
      );
    }
    const logGrant = grants.find((line) => line.includes("public.match_recommendation_log"));
    expect(logGrant).toContain("select, insert");
    expect(logGrant).not.toMatch(/\bupdate\b/);
    expect(logGrant).not.toMatch(/\bdelete\b/);
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
