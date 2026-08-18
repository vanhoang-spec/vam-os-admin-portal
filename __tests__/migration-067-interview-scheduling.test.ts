/**
 * Migration 067 — interview appointments, the account↔mentor link, and the
 * append-only record of mentors choosing their own mentees.
 *
 * This is the first Season 12 migration that touches tables the frozen release
 * package also touches (application_reviews, admin_users), so the assertions
 * here are stricter than for 064/066: every ALTER must be an add-column, the
 * one CHECK added must apply to a column created in this same file, and nothing
 * existing may be dropped, renamed or retyped.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION = "supabase_migrations/067_interview_scheduling.sql";
const sql = readFileSync(resolve(process.cwd(), MIGRATION), "utf8");

const NEW_TABLE = "mentor_mentee_selections";
const ALTERED_TABLES = ["application_reviews", "admin_users"] as const;
const NEW_COLUMNS = [
  "interview_scheduled_at",
  "interview_mode",
  "interview_location",
  "linked_person_id"
] as const;

/** Statement bodies with `--` comments removed, so prose never satisfies an assertion. */
const executable = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("migration 067 — transaction boundary and shape", () => {
  it("wraps everything in exactly one explicit transaction", () => {
    expect(executable.match(/^begin;$/gm) ?? []).toHaveLength(1);
    expect(executable.match(/^commit;$/gm) ?? []).toHaveLength(1);
    expect(executable.indexOf("begin;")).toBeLessThan(executable.indexOf("commit;"));
    expect(executable).not.toMatch(/^rollback;/m);
  });

  it("creates its table idempotently and reloads the schema cache", () => {
    expect(executable).toContain(`create table if not exists public.${NEW_TABLE} (`);
    expect(executable.indexOf("notify pgrst")).toBeGreaterThan(executable.indexOf("commit;"));
  });

  it("carries no production or staging project identifier", () => {
    expect(sql).not.toContain("qkkroesfiazsejkzflcd");
    expect(sql).not.toContain("ljfneyuvpxrmejpxsmpz");
  });

  it("checks its prerequisites before changing anything", () => {
    const prereq = executable.indexOf("PREREQ_MISSING");
    expect(prereq).toBeGreaterThan(-1);
    expect(prereq).toBeLessThan(executable.indexOf("alter table"));
    for (const dependency of [
      "public.applications",
      "public.application_reviews",
      "public.admin_users",
      "public.people",
      "public.matches",
      "public.seasons",
      "public.mentor_season_confirmations"
    ]) {
      expect(executable).toContain(`to_regclass('${dependency}') is null`);
    }
  });
});

describe("migration 067 — additive only", () => {
  it("changes existing tables by adding nullable columns and nothing else", () => {
    const alters = executable.match(/^alter table public\.[\s\S]*?;/gm) ?? [];
    expect(alters.length).toBeGreaterThan(0);

    for (const statement of alters) {
      const touchesExisting = ALTERED_TABLES.some((table) =>
        statement.startsWith(`alter table public.${table}`)
      );
      if (!touchesExisting) {
        // The only other ALTER allowed is enabling RLS on the new table.
        expect(statement).toBe(`alter table public.${NEW_TABLE} enable row level security;`);
        continue;
      }
      expect(statement).toMatch(/add column if not exists/);
      expect(statement).not.toMatch(/not null/);
      expect(statement).not.toMatch(/\bdefault\b/);
    }
  });

  it("never drops, renames or retypes anything", () => {
    expect(executable).not.toMatch(/drop table/i);
    expect(executable).not.toMatch(/drop column/i);
    expect(executable).not.toMatch(/drop constraint/i);
    expect(executable).not.toMatch(/drop policy/i);
    expect(executable).not.toMatch(/rename/i);
    expect(executable).not.toMatch(/alter column/i);
    expect(executable).not.toMatch(/set not null/i);
  });

  it("only ever drops triggers it recreates on its own table", () => {
    const drops = executable.match(/^drop [^\n;]+;/gm) ?? [];
    for (const statement of drops) {
      expect(statement).toMatch(/^drop trigger if exists /);
      expect(statement).toContain(`on public.${NEW_TABLE}`);
    }
  });

  it("adds exactly one constraint, guarded, and only on a column it just created", () => {
    const adds = executable.match(/add constraint [\s\S]*?;/g) ?? [];
    // One inside the ALTER (interview_mode), the rest are inline table constraints.
    expect(adds).toHaveLength(1);
    expect(adds[0]).toContain("application_reviews_interview_mode_check");
    expect(adds[0]).toContain("check (interview_mode is null or interview_mode in ('online', 'offline'))");

    // Guarded so re-running the migration is not an error.
    const guard = executable.indexOf("where conname = 'application_reviews_interview_mode_check'");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(executable.indexOf("add constraint"));
  });

  it("writes no data of its own", () => {
    expect(executable).not.toMatch(/^\s*insert into/im);
    expect(executable).not.toMatch(/^\s*update public\./im);
    expect(executable).not.toMatch(/^\s*delete from/im);
  });

  it("adds no new admin_audit_log action_type value", () => {
    expect(executable).not.toMatch(/admin_audit_log/i);
  });
});

describe("migration 067 — the appointment", () => {
  it("stores time, mode and place on the review row", () => {
    expect(executable).toContain("add column if not exists interview_scheduled_at timestamptz");
    expect(executable).toContain("add column if not exists interview_mode text");
    expect(executable).toContain("add column if not exists interview_location text");
  });

  it("indexes only the rows that actually have an appointment", () => {
    expect(executable).toContain("create index if not exists application_reviews_interview_schedule_idx");
    expect(executable).toContain("where interview_scheduled_at is not null");
  });
});

describe("migration 067 — the account to mentor link", () => {
  it("adds a nullable people reference to admin_users", () => {
    expect(executable).toContain(
      "add column if not exists linked_person_id uuid references public.people(id) on delete set null"
    );
  });

  it("does not make deleting a person fail because an account points at it", () => {
    const statement = (executable.match(/^alter table public\.admin_users[\s\S]*?;/m) ?? [""])[0];
    expect(statement).toContain("on delete set null");
    expect(statement).not.toContain("on delete restrict");
    expect(statement).not.toContain("on delete cascade");
  });
});

describe("migration 067 — selections are append-only", () => {
  it("records every outcome the code can produce, and no others", () => {
    const source = readFileSync(resolve(process.cwd(), "lib/mentor-selection.ts"), "utf8");
    const union = source.slice(
      source.indexOf("type SelectionOutcome"),
      source.indexOf("type ServiceClient")
    );
    const codeOutcomes = Array.from(union.matchAll(/"([a-z_]+)"/g)).map((match) => match[1]).sort();

    const check = executable.slice(
      executable.indexOf("mentor_mentee_selections_outcome_check"),
      executable.indexOf("mentor_mentee_selections_cap_check")
    );
    const sqlOutcomes = Array.from(check.matchAll(/'([a-z_]+)'/g)).map((match) => match[1]).sort();

    expect(sqlOutcomes).toEqual(codeOutcomes);
    expect(sqlOutcomes).toContain("blocked_cap");
    expect(sqlOutcomes).toContain("created");
  });

  it("keeps the capacity arithmetic of the moment, not just the verdict", () => {
    expect(executable).toContain("cap_at_decision smallint null");
    expect(executable).toContain("active_count_at_decision smallint null");
    expect(executable).toContain("check (cap_at_decision is null or cap_at_decision >= 0)");
  });

  it("blocks UPDATE and DELETE by trigger", () => {
    expect(executable).toContain("create or replace function public.prevent_mentor_mentee_selection_mutation()");
    expect(executable).toMatch(/before update on public\.mentor_mentee_selections/);
    expect(executable).toMatch(/before delete on public\.mentor_mentee_selections/);
    expect(executable).toContain("raise exception 'mentor_mentee_selections is append-only'");
  });

  it("indexes the refusals separately — they are the queue the organisers work", () => {
    expect(executable).toContain("create index if not exists mentor_mentee_selections_blocked_idx");
    expect(executable).toContain("where outcome <> 'created'");
  });

  it("never loses a row because a person or account was removed", () => {
    const table = executable.slice(
      executable.indexOf(`create table if not exists public.${NEW_TABLE} (`),
      executable.indexOf(`comment on table public.${NEW_TABLE}`)
    );
    expect(table).toContain("actor_admin_user_id uuid null references public.admin_users(id) on delete set null");
    expect(table).toContain("mentor_person_id uuid null references public.people(id) on delete set null");
    expect(table).toContain("mentee_person_id uuid null references public.people(id) on delete set null");
    // The application and the season are what make the row meaningful at all.
    expect(table).toContain("application_id uuid not null references public.applications(id) on delete restrict");
    expect(table).toContain("season_id uuid not null references public.seasons(id) on delete restrict");
  });
});

describe("migration 067 — privilege contract", () => {
  it("enables RLS on the new table and creates no policy", () => {
    expect(executable).toMatch(new RegExp(`alter table public\\.${NEW_TABLE} enable row level security;`));
    expect(executable).not.toMatch(/create policy/i);
  });

  it("revokes every client-role privilege on the new table", () => {
    const revoke = executable
      .split("\n")
      .find((line) => line.startsWith(`revoke all on public.${NEW_TABLE}`));
    expect(revoke).toBeDefined();
    expect(revoke).toContain("from public, anon, authenticated;");
  });

  it("grants service_role insert and select only — the log cannot be edited", () => {
    const grants = executable.match(/^grant [^\n;]+;/gm) ?? [];
    expect(grants).toHaveLength(1);
    const [grant] = grants;
    expect(grant).toContain(`public.${NEW_TABLE}`);
    expect(grant).toContain("select, insert");
    expect(grant).not.toMatch(/\bupdate\b/);
    expect(grant).not.toMatch(/\bdelete\b/);
    expect(grant).not.toMatch(/\btruncate\b/i);
    expect(grant.slice(grant.lastIndexOf(" to ") + 4).replace(/;$/, "").trim()).toBe("service_role");
  });

  it("does not touch the privileges of the tables it only adds columns to", () => {
    for (const table of ALTERED_TABLES) {
      expect(executable).not.toContain(`revoke all on public.${table}`);
      expect(executable).not.toMatch(new RegExp(`grant [^;]*on public\\.${table}`));
      expect(executable).not.toMatch(new RegExp(`alter table public\\.${table}[^;]*row level security`));
    }
  });

  it("verifies the columns and the contract before COMMIT", () => {
    const columnCheck = executable.indexOf("COLUMN_CONTRACT_VIOLATION");
    const grantCheck = executable.indexOf("GRANT_CONTRACT_VIOLATION");
    expect(columnCheck).toBeGreaterThan(-1);
    expect(columnCheck).toBeLessThan(executable.indexOf("commit;"));
    expect(grantCheck).toBeLessThan(executable.indexOf("commit;"));
    expect(executable).toContain("RLS_CONTRACT_VIOLATION");
    for (const column of NEW_COLUMNS) {
      expect(executable).toContain(`'${column}'`);
    }
  });
});
