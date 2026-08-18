/**
 * Migration 069 — documents, templates, dossier links and send batches.
 *
 * This migration alters two tables, so the additive assertions are the strict
 * ones again: both tables were created by migration 064 in this same work
 * package, the only constraint replaced is that migration's own `kind` CHECK,
 * and it is replaced only to add values.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION = "supabase_migrations/069_post_match_communications.sql";
const sql = readFileSync(resolve(process.cwd(), MIGRATION), "utf8");

const NEW_TABLES = [
  "program_documents",
  "program_document_revisions",
  "email_templates",
  "email_template_log",
  "mentee_dossier_links",
  "email_batches"
] as const;

/** Tables migration 064 created, and the only ones 069 may alter. */
const ALTERED_TABLES = ["outbound_emails", "mentor_season_confirmations"] as const;

const NEW_KINDS = [
  "mentee_selected",
  "mentee_mentor_intro",
  "mentor_mentee_package",
  "kickoff_invite"
] as const;

/** Statement bodies with `--` comments removed, so prose never satisfies an assertion. */
const executable = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("migration 069 — transaction boundary and shape", () => {
  it("wraps everything in exactly one explicit transaction", () => {
    expect(executable.match(/^begin;$/gm) ?? []).toHaveLength(1);
    expect(executable.match(/^commit;$/gm) ?? []).toHaveLength(1);
    expect(executable.indexOf("begin;")).toBeLessThan(executable.indexOf("commit;"));
    expect(executable).not.toMatch(/^rollback;/m);
  });

  it("creates all six tables idempotently and reloads the schema cache", () => {
    for (const table of NEW_TABLES) {
      expect(executable).toContain(`create table if not exists public.${table} (`);
    }
    expect(executable.indexOf("notify pgrst")).toBeGreaterThan(executable.indexOf("commit;"));
  });

  it("carries no production or staging project identifier", () => {
    expect(sql).not.toContain("qkkroesfiazsejkzflcd");
    expect(sql).not.toContain("ljfneyuvpxrmejpxsmpz");
  });

  it("checks its prerequisites, including the tables it is about to alter", () => {
    const prereq = executable.indexOf("PREREQ_MISSING");
    expect(prereq).toBeGreaterThan(-1);
    expect(prereq).toBeLessThan(executable.indexOf("create table if not exists"));
    for (const dependency of [
      "public.seasons",
      "public.applications",
      "public.people",
      "public.matches",
      "public.admin_users",
      "public.outbound_emails",
      "public.mentor_season_confirmations"
    ]) {
      expect(executable).toContain(`to_regclass('${dependency}') is null`);
    }
    expect(executable).toContain("to_regproc('public.set_updated_at')");
  });
});

describe("migration 069 — additive only", () => {
  it("alters nothing except the two tables migration 064 created", () => {
    const alters = executable.match(/^alter table public\.([a-z_]+)/gm) ?? [];
    const tables = Array.from(new Set(alters.map((line) => line.replace("alter table public.", ""))));
    for (const table of tables) {
      const allowed = [...NEW_TABLES, ...ALTERED_TABLES] as readonly string[];
      expect(allowed, table).toContain(table);
    }
  });

  it("touches a legacy table nowhere", () => {
    for (const guarded of [
      "applications",
      "application_reviews",
      "matches",
      "people",
      "admin_users",
      "admin_audit_log",
      "person_season_memberships",
      "events",
      "event_links"
    ]) {
      expect(executable).not.toMatch(new RegExp(`alter table public\\.${guarded}\\b`));
      expect(executable).not.toMatch(new RegExp(`insert into public\\.${guarded}\\b`));
    }
  });

  it("changes the two allowed tables only by adding columns", () => {
    const statements = executable.match(/^alter table public\.(outbound_emails|mentor_season_confirmations)[\s\S]*?;/gm) ?? [];
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      const isAddColumn = /add column if not exists/.test(statement);
      const isKindConstraint = /outbound_emails_kind_check/.test(statement);
      expect(isAddColumn || isKindConstraint, statement.slice(0, 60)).toBe(true);
      if (isAddColumn) {
        expect(statement).not.toMatch(/not null/);
      }
    }
  });

  it("replaces exactly one constraint, its own kind vocabulary, and only to add values", () => {
    const drops = executable.match(/drop constraint[^\n;]*/g) ?? [];
    expect(drops).toHaveLength(1);
    expect(drops[0]).toContain("outbound_emails_kind_check");

    // Everything that was already allowed is still allowed.
    for (const existing of [
      "mentor_confirmation_link",
      "mentee_application_confirmation",
      "mentor_application_confirmation",
      "review_batch_assigned",
      "interview_scheduled",
      "reviewer_invite"
    ]) {
      expect(executable).toContain(`'${existing}'`);
    }
    for (const added of NEW_KINDS) {
      expect(executable).toContain(`'${added}'`);
    }
  });

  it("never drops or renames anything else", () => {
    expect(executable).not.toMatch(/drop table/i);
    expect(executable).not.toMatch(/drop column/i);
    expect(executable).not.toMatch(/rename/i);
    expect(executable).not.toMatch(/alter column/i);
  });

  it("writes no data — the documents start empty and are written in the app", () => {
    expect(executable).not.toMatch(/^\s*insert into/im);
    expect(executable).not.toMatch(/^\s*update public\./im);
    expect(executable).not.toMatch(/^\s*delete from/im);
  });
});

describe("migration 069 — documents", () => {
  it("keeps one document per audience per kind per season", () => {
    expect(executable).toContain(
      "program_documents_season_audience_kind_key unique (season_id, audience, kind)"
    );
    expect(executable).toContain("check (audience in ('mentee', 'mentor'))");
    expect(executable).toContain("check (kind in ('code_of_conduct', 'tips'))");
  });

  it("constrains the slug, because it is typed into an email", () => {
    expect(executable).toContain("program_documents_slug_key unique (slug)");
    expect(executable).toMatch(/slug ~ '\^\[a-z0-9\]\[a-z0-9-\]\{2,80\}\$'/);
  });

  it("records when a document was published", () => {
    expect(executable).toContain("program_documents_published_shape_check");
    expect(executable).toContain("status = 'published' and published_at is not null");
  });

  it("keeps every version, append-only", () => {
    expect(executable).toContain(
      "program_document_revisions_unique_version unique (document_id, version)"
    );
    expect(executable).toContain(
      "create or replace function public.prevent_program_document_revision_mutation()"
    );
    expect(executable).toMatch(/before update on public\.program_document_revisions/);
    expect(executable).toMatch(/before delete on public\.program_document_revisions/);
  });
});

describe("migration 069 — templates", () => {
  it("allows only one approved template per kind per season", () => {
    expect(executable).toContain("create unique index if not exists email_templates_one_approved_idx");
    expect(executable).toContain("on public.email_templates (season_id, kind)");
    expect(executable).toContain("where status = 'approved'");
  });

  it("ties the approval to a timestamp in both directions", () => {
    const clause = executable.slice(
      executable.indexOf("email_templates_approved_shape_check"),
      executable.indexOf("comment on table public.email_templates")
    );
    expect(clause).toContain("status = 'approved' and approved_at is not null");
    expect(clause).toContain("status <> 'approved' and approved_at is null");
  });

  it("records where a draft came from", () => {
    expect(executable).toContain("ai_generated boolean not null default false");
    expect(executable).toContain("ai_model text null");
    expect(executable).toContain("ai_prompt_version text null");
  });

  it("keeps the approval trail append-only", () => {
    expect(executable).toContain(
      "check (action in ('created', 'ai_drafted', 'edited', 'approved', 'archived'))"
    );
    expect(executable).toContain("create or replace function public.prevent_email_template_log_mutation()");
  });
});

describe("migration 069 — dossier links", () => {
  it("is one link per mentor per application, addressed by a token", () => {
    expect(executable).toContain("mentee_dossier_links_token_key unique (token)");
    expect(executable).toContain(
      "mentee_dossier_links_pair_key unique (mentor_person_id, mentee_application_id)"
    );
    expect(executable).toContain("token uuid not null default gen_random_uuid()");
  });

  it("always has an expiry and can be revoked", () => {
    expect(executable).toContain("expires_at timestamptz not null");
    expect(executable).toContain("revoked_at timestamptz null");
  });

  it("counts the opens, so 'who has seen this' has an answer", () => {
    expect(executable).toContain("view_count integer not null default 0");
    expect(executable).toContain("last_viewed_at timestamptz null");
    expect(executable).toContain("check (view_count >= 0)");
  });

  it("points at the application rather than copying it", () => {
    expect(executable).toContain(
      "mentee_application_id uuid not null references public.applications(id) on delete restrict"
    );
  });
});

describe("migration 069 — send batches", () => {
  it("uses the same four kinds as the templates", () => {
    const batchCheck = executable.slice(
      executable.indexOf("email_batches_kind_check"),
      executable.indexOf("email_batches_status_check")
    );
    for (const kind of NEW_KINDS) expect(batchCheck).toContain(`'${kind}'`);
  });

  it("joins the individual attempts through outbound_emails.batch_id", () => {
    expect(executable).toContain(
      "add column if not exists batch_id uuid references public.email_batches(id) on delete set null"
    );
    expect(executable).toContain("create index if not exists outbound_emails_batch_idx");
  });

  it("forbids negative counts and ties completion to a timestamp", () => {
    expect(executable).toContain("email_batches_counts_check");
    expect(executable).toContain("status = 'running' and completed_at is null");
  });
});

describe("migration 069 — the mentor introduction", () => {
  it("adds the short bio to the season row, not to the mentor profile", () => {
    expect(executable).toContain(
      "alter table public.mentor_season_confirmations\n  add column if not exists bio_short text"
    );
    expect(executable).not.toMatch(/alter table public\.mentor_profiles/);
  });
});

describe("migration 069 — privilege contract", () => {
  it("enables RLS on every new table and creates no policy", () => {
    for (const table of NEW_TABLES) {
      expect(executable).toMatch(new RegExp(`alter table public\\.${table}\\s+enable row level security;`));
    }
    expect(executable).not.toMatch(/create policy/i);
  });

  it("revokes every client-role privilege on the new tables", () => {
    for (const table of NEW_TABLES) {
      const revoke = executable
        .split("\n")
        .find((line) => line.startsWith(`revoke all on public.${table}`));
      expect(revoke, table).toBeDefined();
      expect(revoke).toContain("from public, anon, authenticated;");
    }
  });

  it("does not touch the privileges of the two tables it only extends", () => {
    for (const table of ALTERED_TABLES) {
      expect(executable).not.toContain(`revoke all on public.${table}`);
      expect(executable).not.toMatch(new RegExp(`grant [^;]*on public\\.${table}`));
    }
  });

  it("grants only to service_role, and keeps both logs insert-only", () => {
    const grants = executable.match(/^grant [^\n;]+;/gm) ?? [];
    expect(grants).toHaveLength(NEW_TABLES.length);
    for (const statement of grants) {
      expect(statement.slice(statement.lastIndexOf(" to ") + 4).replace(/;$/, "").trim()).toBe(
        "service_role"
      );
      expect(statement).not.toMatch(/\btruncate\b/i);
    }
    for (const logTable of ["program_document_revisions", "email_template_log"]) {
      const grant = grants.find((line) => line.includes(`public.${logTable}`));
      expect(grant, logTable).toContain("select, insert");
      expect(grant).not.toMatch(/\bupdate\b/);
      expect(grant).not.toMatch(/\bdelete\b/);
    }
  });

  it("verifies the columns, the widened vocabulary and the grants before COMMIT", () => {
    const columnCheck = executable.indexOf("COLUMN_CONTRACT_VIOLATION");
    const constraintCheck = executable.indexOf("CONSTRAINT_CONTRACT_VIOLATION");
    const grantCheck = executable.indexOf("GRANT_CONTRACT_VIOLATION");
    const commit = executable.indexOf("commit;");

    expect(columnCheck).toBeGreaterThan(-1);
    expect(constraintCheck).toBeGreaterThan(-1);
    expect(columnCheck).toBeLessThan(commit);
    expect(constraintCheck).toBeLessThan(commit);
    expect(grantCheck).toBeLessThan(commit);
    expect(executable).toContain("RLS_CONTRACT_VIOLATION");
    expect(executable).toContain("batch_id");
    expect(executable).toContain("bio_short");
  });
});
