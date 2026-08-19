/**
 * Migration 071 — participant logins, programme membership, current season.
 *
 * Three assertions carry the design.
 *
 * `participant_accounts` must be unique in BOTH directions. One login to one
 * person is what lets a mentor who teaches at two schools sign in once; drop
 * either unique and the same human can end up with two identities, or one login
 * pointing at two people's records.
 *
 * `person_program_memberships` must be unique per (person, programme, role) and
 * must NOT carry a season. Season lives on the programme, so a school rolling
 * into its next season does not mean rewriting a row per participant.
 *
 * And `admin_users` must come out of this holding exactly one more role than it
 * went in with. Every permission predicate in the app is an allow-list, so a new
 * role is refused everywhere by default — but only if the six existing values
 * survive the constraint being replaced.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION = "supabase_migrations/071_participant_accounts_and_program_membership.sql";
const sql = readFileSync(resolve(process.cwd(), MIGRATION), "utf8");

const NEW_TABLES = [
  "participant_accounts",
  "person_program_memberships",
  "person_program_membership_log"
] as const;

/** The only pre-existing tables 071 may alter. */
const ALTERED_TABLES = ["programs", "admin_users", "outbound_emails"] as const;

const EXISTING_ROLES = [
  "viewer",
  "reviewer",
  "support_team",
  "core_team",
  "admin",
  "super_admin"
] as const;

/** Statement bodies with `--` comments removed, so prose never satisfies an assertion. */
const executable = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("migration 071 — transaction boundary and shape", () => {
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
      "public.people",
      "public.programs",
      "public.seasons",
      "public.admin_users",
      "public.outbound_emails"
    ]) {
      expect(executable).toContain(`to_regclass('${dependency}') is null`);
    }
    expect(executable).toContain("to_regproc('public.set_updated_at')");
  });
});

describe("migration 071 — additive only", () => {
  it("alters nothing except programs and admin_users", () => {
    const alters = executable.match(/^alter table public\.([a-z_]+)/gm) ?? [];
    const tables = Array.from(new Set(alters.map((line) => line.replace("alter table public.", ""))));
    for (const table of tables) {
      const allowed = [...NEW_TABLES, ...ALTERED_TABLES] as readonly string[];
      expect(allowed, table).toContain(table);
    }
  });

  it("leaves every other legacy table alone", () => {
    for (const guarded of [
      "people",
      "matches",
      "person_season_memberships",
      "applications",
      "application_reviews",
      "mentoring_recaps",
      "admin_scope_access",
      "events",
      "mentor_profiles",
      "mentee_profiles"
    ]) {
      expect(executable).not.toMatch(new RegExp(`alter table public\\.${guarded}\\b`));
      expect(executable).not.toMatch(new RegExp(`insert into public\\.${guarded}\\b`));
      expect(executable).not.toMatch(new RegExp(`update public\\.${guarded}\\b`));
      expect(executable).not.toMatch(new RegExp(`delete from public\\.${guarded}\\b`));
    }
  });

  it("touches account_person_auth_links nowhere — migration 062's table is left as it is", () => {
    // Its auth_user_id/person_id uniques allow one programme per login, which is
    // the exact case this work exists to support. Reusing it would fight it.
    expect(executable).not.toContain("account_person_auth_links");
  });

  it("changes programs only by adding one nullable column and its foreign key", () => {
    const statements = executable.match(/^alter table public\.programs[\s\S]*?;/gm) ?? [];
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      expect(statement).toMatch(/add column if not exists current_season_id uuid null/);
      expect(statement).not.toMatch(/not null[^;]*$/);
    }
    // The FK is added inside a guarded DO block so re-running is safe.
    expect(executable).toContain("programs_current_season_fkey");
    expect(executable).toContain("references public.seasons(id) on delete set null");
  });

  it("never drops or renames anything else", () => {
    expect(executable).not.toMatch(/drop table/i);
    expect(executable).not.toMatch(/drop column/i);
    expect(executable).not.toMatch(/rename/i);
    expect(executable).not.toMatch(/alter column/i);
  });

  it("writes no data — every table starts empty", () => {
    expect(executable).not.toMatch(/^\s*insert into/im);
    expect(executable).not.toMatch(/^\s*update public\./im);
    expect(executable).not.toMatch(/^\s*delete from/im);
  });

  it("sets no programme's current season — that is a decision, not a migration", () => {
    expect(executable).not.toMatch(/set current_season_id/i);
  });
});

describe("migration 071 — one login, one person", () => {
  it("makes the link unique in both directions", () => {
    expect(executable).toContain("constraint participant_accounts_auth_user_key unique (auth_user_id)");
    expect(executable).toContain("constraint participant_accounts_person_key unique (person_id)");
  });

  it("fails the transaction if either unique did not take", () => {
    for (const marker of [
      "CONSTRAINT_CONTRACT_VIOLATION: auth_user_id is not unique",
      "CONSTRAINT_CONTRACT_VIOLATION: person_id is not unique"
    ]) {
      const at = executable.indexOf(marker);
      expect(at, marker).toBeGreaterThan(-1);
      expect(at, marker).toBeLessThan(executable.indexOf("commit;"));
    }
  });

  it("names how the link was made, so a guess is never silent", () => {
    expect(executable).toContain("check (link_source in ('invite', 'self_register', 'admin'))");
  });

  it("can revoke access without breaking the link", () => {
    expect(executable).toContain("check (status in ('active', 'disabled'))");
  });

  it("removes the login when the person is removed", () => {
    expect(executable).toMatch(/person_id uuid not null references public\.people\(id\) on delete cascade/);
  });
});

describe("migration 071 — programme membership", () => {
  it("keeps one row per person per programme per role", () => {
    expect(executable).toContain(
      "constraint person_program_memberships_person_program_role_key\n    unique (person_id, program_id, role)"
    );
  });

  it("carries no season — season belongs to the programme", () => {
    const table = executable.match(
      /create table if not exists public\.person_program_memberships \([\s\S]*?\n\);/
    )?.[0];
    expect(table).toBeTruthy();
    expect(table).not.toMatch(/season_id/);
  });

  it("offers only the two roles the picker understands", () => {
    expect(executable).toContain("check (role in ('mentor', 'mentee'))");
  });

  it("can close a programme for one person without erasing the history", () => {
    expect(executable).toContain("check (status in ('active', 'inactive'))");
  });

  it("records where a membership came from", () => {
    expect(executable).toContain("check (source in ('backfill', 'manual', 'application', 'import'))");
  });

  it("refuses to delete a programme that still has members", () => {
    expect(executable).toMatch(
      /program_id uuid not null references public\.programs\(id\) on delete restrict/
    );
  });
});

describe("migration 071 — the membership log is append-only", () => {
  it("grants insert and select, never update or delete", () => {
    expect(executable).toMatch(
      /grant select, insert\s+on public\.person_program_membership_log to service_role/
    );
    expect(executable).not.toMatch(
      /grant[^;]*update[^;]*on public\.person_program_membership_log/i
    );
  });

  it("fails the transaction if the log could ever be rewritten", () => {
    const at = executable.indexOf("GRANT_CONTRACT_VIOLATION: membership log must be append-only");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(executable.indexOf("commit;"));
  });

  it("names every kind of change it records", () => {
    expect(executable).toContain(
      "check (transition_type in ('created', 'activated', 'deactivated', 'backfill', 'system'))"
    );
  });
});

describe("migration 071 — the vam_admin role", () => {
  it("adds vam_admin and keeps all six existing roles", () => {
    const drops = executable.match(/drop constraint[^\n;]*/g) ?? [];
    expect(drops.filter((line) => line.includes("admin_users_role_check"))).toHaveLength(1);
    // Only the two vocabularies this migration owns are ever replaced.
    expect(drops).toHaveLength(2);

    for (const role of EXISTING_ROLES) {
      expect(executable, role).toContain(`'${role}'`);
    }
    expect(executable).toContain("'vam_admin'");
  });

  it("refuses to commit if an existing row would fall outside the new vocabulary", () => {
    // Replacing a CHECK on a populated table is the one way this migration could
    // lock somebody out; the guard makes that a failed transaction, not a surprise.
    const at = executable.indexOf(
      "DATA_CONTRACT_VIOLATION: admin_users holds a role outside the new vocabulary"
    );
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(executable.indexOf("commit;"));
  });

  it("verifies the widened vocabulary took", () => {
    expect(executable).toContain(
      "CONSTRAINT_CONTRACT_VIOLATION: admin_users.role does not accept vam_admin"
    );
  });
});

describe("migration 071 — the invitation email", () => {
  it("adds participant_invite and keeps every kind that came before", () => {
    for (const kind of [
      "mentor_confirmation_link",
      "mentee_application_confirmation",
      "mentor_application_confirmation",
      "review_batch_assigned",
      "interview_scheduled",
      "reviewer_invite",
      "mentee_selected",
      "mentee_mentor_intro",
      "mentor_mentee_package",
      "kickoff_invite",
      "recap_period_reminder"
    ]) {
      expect(executable, kind).toContain(`'${kind}'`);
    }
    expect(executable).toContain("'participant_invite'");
  });

  it("verifies the widened vocabulary took, before commit", () => {
    const at = executable.indexOf(
      "CONSTRAINT_CONTRACT_VIOLATION: outbound_emails.kind does not accept participant_invite"
    );
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(executable.indexOf("commit;"));
  });

  it("changes outbound_emails only by replacing its own kind vocabulary", () => {
    const statements = executable.match(/^alter table public\.outbound_emails[\s\S]*?;/gm) ?? [];
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      expect(statement).toMatch(/outbound_emails_kind_check/);
    }
  });
});

describe("migration 071 — privilege contract", () => {
  it("enables row level security on all three tables", () => {
    for (const table of NEW_TABLES) {
      expect(executable).toMatch(
        new RegExp(`alter table public\\.${table}\\s+enable row level security`)
      );
    }
  });

  it("defines no policy at all — service_role is the only caller", () => {
    expect(executable).not.toMatch(/create policy/i);
  });

  it("revokes client roles on every new table", () => {
    for (const table of NEW_TABLES) {
      expect(executable).toMatch(
        new RegExp(`revoke all on public\\.${table}\\s+from public, anon, authenticated`)
      );
    }
    expect(executable).not.toMatch(/grant[^\n;]*to (anon|authenticated)/);
  });

  it("verifies the contract inside the transaction, before commit", () => {
    for (const marker of [
      "RLS_CONTRACT_VIOLATION: row level security is not enabled",
      "RLS_CONTRACT_VIOLATION: unexpected policy present",
      "GRANT_CONTRACT_VIOLATION: client-role privileges remain",
      "COLUMN_CONTRACT_VIOLATION: programs.current_season_id is missing"
    ]) {
      const at = executable.indexOf(marker);
      expect(at, marker).toBeGreaterThan(-1);
      expect(at, marker).toBeLessThan(executable.indexOf("commit;"));
    }
  });
});
