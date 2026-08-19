/**
 * Migration 070 — staging tables for posts collected from the Facebook group.
 *
 * Two assertions here matter more than the rest.
 *
 * The unique index on `permalink` is the whole dedupe story: without it, an
 * organiser who scans an overlapping window creates duplicate recaps, and the
 * twice-monthly rhythm becomes a rule people have to obey rather than a
 * reminder they can ignore.
 *
 * `mentoring_recaps` must come out of this migration untouched. It is a legacy
 * table holding 258 rows that share a placeholder URL, so the unique index that
 * looks obviously right there would fail the transaction on production.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION = "supabase_migrations/070_recap_import.sql";
const sql = readFileSync(resolve(process.cwd(), MIGRATION), "utf8");

const NEW_TABLES = ["recap_import_batches", "recap_import_items"] as const;

/** Tables migration 064 created, and the only ones 070 may alter. */
const ALTERED_TABLES = ["apply_submission_log", "outbound_emails"] as const;

/** Statement bodies with `--` comments removed, so prose never satisfies an assertion. */
const executable = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("migration 070 — transaction boundary and shape", () => {
  it("wraps everything in exactly one explicit transaction", () => {
    expect(executable.match(/^begin;$/gm) ?? []).toHaveLength(1);
    expect(executable.match(/^commit;$/gm) ?? []).toHaveLength(1);
    expect(executable.indexOf("begin;")).toBeLessThan(executable.indexOf("commit;"));
    expect(executable).not.toMatch(/^rollback;/m);
  });

  it("creates both tables idempotently and reloads the schema cache", () => {
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
      "public.people",
      "public.matches",
      "public.mentoring_recaps",
      "public.admin_users",
      "public.apply_submission_log",
      "public.outbound_emails"
    ]) {
      expect(executable).toContain(`to_regclass('${dependency}') is null`);
    }
    expect(executable).toContain("to_regproc('public.set_updated_at')");
  });
});

describe("migration 070 — additive only", () => {
  it("alters nothing except the two tables migration 064 created", () => {
    const alters = executable.match(/^alter table public\.([a-z_]+)/gm) ?? [];
    const tables = Array.from(new Set(alters.map((line) => line.replace("alter table public.", ""))));
    for (const table of tables) {
      const allowed = [...NEW_TABLES, ...ALTERED_TABLES] as readonly string[];
      expect(allowed, table).toContain(table);
    }
  });

  it("leaves mentoring_recaps entirely alone", () => {
    // The reason is in the header: 258 legacy rows share `system.local/missing-url`,
    // so a unique index on recap_url would abort the migration on production.
    expect(executable).not.toMatch(/alter table public\.mentoring_recaps\b/);
    expect(executable).not.toMatch(/create (unique )?index[^\n;]*on public\.mentoring_recaps\b/);
    expect(executable).not.toMatch(/insert into public\.mentoring_recaps\b/);
    expect(executable).not.toMatch(/update public\.mentoring_recaps\b/);
    expect(executable).not.toMatch(/delete from public\.mentoring_recaps\b/);
    // It may only be named as a prerequisite and as a foreign-key target.
    expect(executable).toContain("to_regclass('public.mentoring_recaps') is null");
  });

  it("touches no other legacy table", () => {
    for (const guarded of [
      "applications",
      "application_reviews",
      "matches",
      "people",
      "admin_users",
      "admin_audit_log",
      "person_season_memberships",
      "events",
      "action_items"
    ]) {
      expect(executable).not.toMatch(new RegExp(`alter table public\\.${guarded}\\b`));
      expect(executable).not.toMatch(new RegExp(`insert into public\\.${guarded}\\b`));
    }
  });

  it("changes the two allowed tables only by replacing their own value lists", () => {
    const statements =
      executable.match(/^alter table public\.(apply_submission_log|outbound_emails)[\s\S]*?;/gm) ?? [];
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      const isVocabulary = /(apply_submission_log_route_check|outbound_emails_kind_check)/.test(statement);
      expect(isVocabulary, statement.slice(0, 60)).toBe(true);
    }
  });

  it("drops only the two CHECK constraints it immediately re-adds, and only to add values", () => {
    const drops = executable.match(/drop constraint[^\n;]*/g) ?? [];
    expect(drops).toHaveLength(2);
    expect(drops.join(" ")).toContain("apply_submission_log_route_check");
    expect(drops.join(" ")).toContain("outbound_emails_kind_check");

    // Everything previously allowed on either vocabulary survives.
    for (const existing of [
      "apply_mentee",
      "apply_mentor",
      "confirm",
      "mentor_confirmation_link",
      "mentee_application_confirmation",
      "mentor_application_confirmation",
      "review_batch_assigned",
      "interview_scheduled",
      "reviewer_invite",
      "mentee_selected",
      "mentee_mentor_intro",
      "mentor_mentee_package",
      "kickoff_invite"
    ]) {
      expect(executable).toContain(`'${existing}'`);
    }
    expect(executable).toContain("'recap_import'");
    expect(executable).toContain("'recap_period_reminder'");
  });

  it("never drops or renames anything else", () => {
    expect(executable).not.toMatch(/drop table/i);
    expect(executable).not.toMatch(/drop column/i);
    expect(executable).not.toMatch(/rename/i);
    expect(executable).not.toMatch(/alter column/i);
  });

  it("writes no data", () => {
    expect(executable).not.toMatch(/^\s*insert into/im);
    expect(executable).not.toMatch(/^\s*update public\./im);
    expect(executable).not.toMatch(/^\s*delete from/im);
  });
});

describe("migration 070 — one post, one row", () => {
  it("makes the permalink unique across every batch", () => {
    expect(executable).toContain("constraint recap_import_items_permalink_key unique (permalink)");
  });

  it("fails the transaction if that constraint did not take", () => {
    const check = executable.indexOf("CONSTRAINT_CONTRACT_VIOLATION: permalink is not unique");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(executable.indexOf("commit;"));
    expect(executable).toContain("conname = 'recap_import_items_permalink_key'");
  });

  it("only lets an item name a recap once it has actually been imported", () => {
    expect(executable).toMatch(/imported_recap_id is null or status = 'imported'/);
    expect(executable).toContain("references public.mentoring_recaps(id)");
  });
});

describe("migration 070 — vocabularies", () => {
  it("uses the same meeting_type words as mentoring_recaps", () => {
    for (const value of [
      "1on1_primary",
      "1on1_cross",
      "group",
      "online",
      "offline",
      "unknown"
    ]) {
      expect(executable).toContain(`'${value}'`);
    }
  });

  it("names every state an item can be in", () => {
    expect(executable).toContain(
      "check (status in ('pending', 'matched', 'needs_review', 'imported', 'skipped', 'duplicate'))"
    );
  });

  it("records how confident the match was, so a guess is never silent", () => {
    expect(executable).toContain("check (match_confidence in ('none', 'mssv', 'name', 'manual'))");
  });

  it("distinguishes the extension from the fallback CSV", () => {
    expect(executable).toContain("check (source in ('extension', 'csv'))");
  });
});

describe("migration 070 — privilege contract", () => {
  it("enables row level security on both tables", () => {
    for (const table of NEW_TABLES) {
      expect(executable).toMatch(
        new RegExp(`alter table public\\.${table}\\s+enable row level security`)
      );
    }
  });

  it("defines no policy at all — service_role is the only caller", () => {
    expect(executable).not.toMatch(/create policy/i);
  });

  it("revokes client roles and grants only service_role", () => {
    for (const table of NEW_TABLES) {
      expect(executable).toMatch(
        new RegExp(`revoke all on public\\.${table}\\s+from public, anon, authenticated`)
      );
      expect(executable).toMatch(
        new RegExp(`grant select, insert, update, delete on public\\.${table}\\s+to service_role`)
      );
    }
    expect(executable).not.toMatch(/grant[^\n;]*to (anon|authenticated)/);
  });

  it("verifies the contract inside the transaction, before commit", () => {
    for (const marker of [
      "RLS_CONTRACT_VIOLATION: row level security is not enabled",
      "RLS_CONTRACT_VIOLATION: unexpected policy present",
      "GRANT_CONTRACT_VIOLATION: client-role privileges remain",
      "CONSTRAINT_CONTRACT_VIOLATION: apply_submission_log.route does not accept recap_import",
      "CONSTRAINT_CONTRACT_VIOLATION: outbound_emails.kind does not accept recap_period_reminder"
    ]) {
      const at = executable.indexOf(marker);
      expect(at, marker).toBeGreaterThan(-1);
      expect(at, marker).toBeLessThan(executable.indexOf("commit;"));
    }
  });
});
