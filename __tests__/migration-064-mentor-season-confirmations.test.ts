/**
 * Migration 064 — mentor season confirmations, outbound email log, apply submission log.
 *
 * These assertions guard the properties that make 064 safe to apply on a live
 * project: it is additive only, it never touches an object the frozen release
 * package VAM_OS_PROD_S12_RELEASE_20260809 depends on, and it closes the
 * ambient anon/authenticated grants Supabase attaches to new public tables.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION = "supabase_migrations/064_mentor_season_confirmations.sql";
const sql = readFileSync(resolve(process.cwd(), MIGRATION), "utf8");

const NEW_TABLES = [
  "mentor_season_confirmations",
  "mentor_season_confirmation_log",
  "outbound_emails",
  "apply_submission_log"
] as const;

/** Statement bodies with `--` comments removed, so prose never satisfies an assertion. */
const executable = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("migration 064 — transaction boundary and shape", () => {
  it("wraps everything in exactly one explicit transaction", () => {
    expect(executable.match(/^begin;$/gm) ?? []).toHaveLength(1);
    expect(executable.match(/^commit;$/gm) ?? []).toHaveLength(1);
    expect(executable.indexOf("begin;")).toBeLessThan(executable.indexOf("commit;"));
    expect(executable).not.toMatch(/^rollback;/m);
  });

  it("reloads the PostgREST schema cache after commit", () => {
    const notifyIndex = executable.indexOf("notify pgrst");
    expect(notifyIndex).toBeGreaterThan(executable.indexOf("commit;"));
  });

  it("creates all four tables idempotently", () => {
    for (const table of NEW_TABLES) {
      expect(executable).toContain(`create table if not exists public.${table} (`);
    }
  });

  it("carries no production or staging project identifier", () => {
    expect(sql).not.toContain("qkkroesfiazsejkzflcd");
    expect(sql).not.toContain("ljfneyuvpxrmejpxsmpz");
  });
});

describe("migration 064 — additive only", () => {
  it("only ever ALTERs the four tables it just created, and only to enable RLS", () => {
    const alters = executable.match(/^alter table [^\n;]+;/gm) ?? [];
    expect(alters).toHaveLength(NEW_TABLES.length);
    for (const statement of alters) {
      expect(statement).toMatch(/enable row level security;$/);
      expect(NEW_TABLES.some((table) => statement.includes(`public.${table}`))).toBe(true);
    }
  });

  it("never drops or renames a table, column or constraint", () => {
    expect(executable).not.toMatch(/drop table/i);
    expect(executable).not.toMatch(/drop column/i);
    expect(executable).not.toMatch(/drop constraint/i);
    expect(executable).not.toMatch(/rename/i);
  });

  it("does not touch the objects the frozen release package depends on", () => {
    // T1 rewrites admin_audit_log's action_type CHECK; T3 rewrites the
    // membership log's transition_type CHECK. Both abort on drift, so 064
    // must not write to either table.
    for (const guarded of [
      "admin_audit_log",
      "person_season_memberships",
      "person_season_membership_log",
      "applications",
      "matches"
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

  it("reuses set_updated_at from migration 052 instead of redefining it", () => {
    expect(executable).toContain("execute function public.set_updated_at()");
    expect(executable).not.toContain("create or replace function public.set_updated_at");
  });

  it("checks its prerequisites before creating anything", () => {
    const prereqIndex = executable.indexOf("PREREQ_MISSING");
    const firstCreate = executable.indexOf("create table if not exists");
    expect(prereqIndex).toBeGreaterThan(-1);
    expect(prereqIndex).toBeLessThan(firstCreate);
    for (const dependency of ["public.people", "public.seasons", "public.mentor_profiles", "public.admin_users"]) {
      expect(executable).toContain(`to_regclass('${dependency}') is null`);
    }
    expect(executable).toContain("to_regproc('public.set_updated_at') is null");
  });
});

describe("migration 064 — privilege contract", () => {
  it("enables row level security on every new table", () => {
    for (const table of NEW_TABLES) {
      expect(executable).toContain(`alter table public.${table}`);
      expect(executable).toMatch(new RegExp(`alter table public\\.${table}\\s+enable row level security;`));
    }
  });

  it("creates no policy at all", () => {
    expect(executable).not.toMatch(/create policy/i);
  });

  it("revokes every client-role privilege on every new table", () => {
    for (const table of NEW_TABLES) {
      expect(executable).toContain(`revoke all on public.${table}`);
      const revoke = executable
        .split("\n")
        .find((line) => line.startsWith(`revoke all on public.${table}`));
      expect(revoke).toBeDefined();
      expect(revoke).toContain("from public, anon, authenticated;");
    }
  });

  it("grants only to service_role, and never TRUNCATE or REFERENCES or TRIGGER", () => {
    const grants = executable.match(/^grant [^\n;]+;/gm) ?? [];
    expect(grants.length).toBe(NEW_TABLES.length);
    for (const statement of grants) {
      // Privilege list: everything between "grant" and "on".
      const privileges = statement.slice("grant".length, statement.indexOf(" on "));
      expect(privileges).not.toMatch(/\btruncate\b/i);
      expect(privileges).not.toMatch(/\breferences\b/i);
      expect(privileges).not.toMatch(/\btrigger\b/i);
      expect(privileges).not.toMatch(/\ball privileges\b/i);
      // Grantee list: everything after the final " to ". service_role and nothing else.
      const grantees = statement.slice(statement.lastIndexOf(" to ") + 4).replace(/;$/, "").trim();
      expect(grantees).toBe("service_role");
    }
  });

  it("keeps the audit log insert-only for service_role", () => {
    const grant = (executable.match(/^grant [^\n;]+;/gm) ?? []).find((line) =>
      line.includes("public.mentor_season_confirmation_log")
    );
    expect(grant).toBeDefined();
    expect(grant).toContain("select, insert");
    expect(grant).not.toMatch(/\bupdate\b/);
    expect(grant).not.toMatch(/\bdelete\b/);
  });

  it("applies the privilege contract after the tables exist and verifies it before commit", () => {
    const firstCreate = executable.indexOf("create table if not exists");
    const firstRevoke = executable.indexOf("revoke all on public.");
    const selfCheck = executable.indexOf("GRANT_CONTRACT_VIOLATION");
    const commitIndex = executable.indexOf("commit;");
    expect(firstCreate).toBeLessThan(firstRevoke);
    expect(firstRevoke).toBeLessThan(selfCheck);
    expect(selfCheck).toBeLessThan(commitIndex);
    expect(executable).toContain("RLS_CONTRACT_VIOLATION");
  });
});

describe("migration 064 — confirmation table invariants", () => {
  it("is one row per mentor per season, with a unique token", () => {
    expect(executable).toContain("unique (person_id, season_id)");
    expect(executable).toContain("mentor_season_confirmations_token_key unique (token)");
    expect(executable).toContain("token uuid not null default gen_random_uuid()");
  });

  it("restricts status to the three response states", () => {
    expect(executable).toContain("check (status in ('pending', 'confirmed', 'declined'))");
    expect(executable).toContain("status text not null default 'pending'");
  });

  it("bounds the declared capacity to 1..3 and extra slots to 0..3", () => {
    expect(executable).toContain("max_mentees is null or (max_mentees >= 1 and max_mentees <= 3)");
    expect(executable).toContain("check (extra_slots >= 0 and extra_slots <= 3)");
    expect(executable).toContain("extra_slots smallint not null default 0");
  });

  it("forces a coherent response shape per status", () => {
    const shape = executable.slice(
      executable.indexOf("mentor_season_confirmations_response_shape_check"),
      executable.indexOf("comment on table public.mentor_season_confirmations")
    );
    // pending carries no answer at all
    expect(shape).toContain("status = 'pending'   and max_mentees is null and responded_at is null");
    // confirmed must carry a capacity and a recorded response
    expect(shape).toContain("status = 'confirmed' and max_mentees is not null and responded_at is not null");
    // declined must not carry a capacity
    expect(shape).toContain("status = 'declined'  and max_mentees is null and responded_at is not null");
  });

  it("limits the free-text note and records where the answer came from", () => {
    expect(executable).toContain("char_length(note) <= 1000");
    expect(executable).toContain("response_source in ('form', 'manual', 'phone', 'application')");
  });

  it("captures the two Season 12 participation questions", () => {
    expect(executable).toContain("agree_to_review boolean null");
    expect(executable).toContain("agree_to_interview boolean null");
  });

  it("cascades from people but never deletes a season", () => {
    expect(executable).toContain("person_id uuid not null references public.people(id) on delete cascade");
    expect(executable).toContain("season_id uuid not null references public.seasons(id) on delete restrict");
  });
});

describe("migration 064 — append-only confirmation log", () => {
  it("blocks UPDATE and DELETE with triggers, like the membership log", () => {
    expect(executable).toContain("create or replace function public.prevent_mentor_season_confirmation_log_mutation()");
    expect(executable).toContain("raise exception 'mentor_season_confirmation_log is append-only'");
    expect(executable).toContain("mentor_season_confirmation_log_no_update");
    expect(executable).toContain("mentor_season_confirmation_log_no_delete");
    expect(executable).toMatch(/before update on public\.mentor_season_confirmation_log/);
    expect(executable).toMatch(/before delete on public\.mentor_season_confirmation_log/);
  });

  it("records both the status and capacity transition", () => {
    for (const column of [
      "old_status",
      "new_status",
      "old_max_mentees",
      "new_max_mentees",
      "old_extra_slots",
      "new_extra_slots",
      "change_type",
      "changed_by_admin_user_id"
    ]) {
      expect(executable).toContain(column);
    }
  });

  it("restricts change_type to the recorded vocabulary", () => {
    const clause = executable.slice(
      executable.indexOf("mentor_season_confirmation_log_change_type_check"),
      executable.indexOf("mentor_season_confirmation_log_new_status_check")
    );
    for (const value of [
      "created",
      "status_change",
      "capacity_change",
      "extra_slots_change",
      "link_issued",
      "link_sent",
      "token_reissued",
      "expiry_extended"
    ]) {
      expect(clause).toContain(`'${value}'`);
    }
  });
});

describe("migration 064 — email and rate-limit logs", () => {
  it("constrains outbound email status and kind", () => {
    expect(executable).toContain("check (status in ('queued', 'sent', 'failed', 'skipped'))");
    const kinds = executable.slice(
      executable.indexOf("outbound_emails_kind_check"),
      executable.indexOf("comment on table public.outbound_emails")
    );
    for (const value of [
      "mentor_confirmation_link",
      "mentee_application_confirmation",
      "mentor_application_confirmation",
      "review_batch_assigned"
    ]) {
      expect(kinds).toContain(`'${value}'`);
    }
  });

  it("stores only a hashed address for rate limiting, never a raw IP", () => {
    expect(executable).toContain("ip_hash text not null");
    expect(executable).not.toMatch(/\bip_address\b/);
    expect(executable).not.toMatch(/\binet\b/);
    expect(sql).toContain("the raw address is never stored");
  });

  it("indexes the rate-limit lookup and the pruning scan", () => {
    expect(executable).toContain("apply_submission_log_ip_created_idx");
    expect(executable).toContain("apply_submission_log_created_idx");
  });

  it("records why a submission was refused", () => {
    const outcomes = executable.slice(
      executable.indexOf("apply_submission_log_outcome_check"),
      executable.indexOf("comment on table public.apply_submission_log")
    );
    for (const value of ["accepted", "rejected_rate_limit", "rejected_honeypot", "rejected_gate"]) {
      expect(outcomes).toContain(`'${value}'`);
    }
  });
});
