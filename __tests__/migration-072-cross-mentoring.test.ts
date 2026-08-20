/**
 * Migrations 072 and 073 — the cross-mentoring record.
 *
 * Three assertions carry the design.
 *
 * A scheduled request must carry an event. That constraint is what makes "no
 * way back once a session is scheduled" a property of the database rather than
 * a rule the application has to remember, because by then mentees may already
 * have registered.
 *
 * An invitation is unique per mentor per request. Without it, running the
 * invitation sweep twice writes to the same mentor twice — and this feature
 * exists partly to stop over-asking the same people.
 *
 * And `mentoring_recaps` must come out of this untouched. A cross session has
 * two or three mentors and that table holds one; the answer is to model the
 * session as an event, not to alter a legacy table carrying 286 rows.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION = "supabase_migrations/072_cross_mentoring.sql";
const EVENT_TYPE_MIGRATION = "supabase_migrations/073_cross_mentoring_event_type.sql";

const sql = readFileSync(resolve(process.cwd(), MIGRATION), "utf8");
const eventTypeSql = readFileSync(resolve(process.cwd(), EVENT_TYPE_MIGRATION), "utf8");

const NEW_TABLES = [
  "cross_mentoring_fields",
  "mentor_cross_fields",
  "cross_requests",
  "cross_invitations",
  "cross_invitation_slots",
  "cross_request_log"
] as const;

/** The only pre-existing table 072 may alter. */
const TOUCHED_TABLES = ["outbound_emails"] as const;

/** Statement bodies with `--` comments removed, so prose never satisfies an assertion. */
function executableOf(text: string) {
  return text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

const executable = executableOf(sql);
const eventTypeExecutable = executableOf(eventTypeSql);

describe("migration 072 — transaction boundary and shape", () => {
  it("wraps everything in exactly one explicit transaction", () => {
    expect(executable.match(/^begin;$/gm) ?? []).toHaveLength(1);
    expect(executable.match(/^commit;$/gm) ?? []).toHaveLength(1);
    expect(executable.indexOf("begin;")).toBeLessThan(executable.indexOf("commit;"));
    expect(executable).not.toMatch(/^rollback;/m);
  });

  it("creates all four tables idempotently and reloads the schema cache", () => {
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
      "public.seasons",
      "public.programs",
      "public.events",
      "public.outbound_emails"
    ]) {
      expect(executable).toContain(`to_regclass('${dependency}') is null`);
    }
  });
});

describe("migration 072 — leaves the rest of the schema alone", () => {
  it("alters nothing except the two vocabularies it needs", () => {
    const alters = executable.match(/^\s*alter table public\.([a-z_]+)/gm) ?? [];
    const tables = Array.from(
      new Set(alters.map((line) => line.trim().replace("alter table public.", "")))
    );
    for (const table of tables) {
      const allowed = [...NEW_TABLES, ...TOUCHED_TABLES] as readonly string[];
      expect(allowed, table).toContain(table);
    }
  });

  it("leaves mentoring_recaps entirely alone", () => {
    // A cross session has two or three mentors and that table holds one. The
    // answer is the event, not a change to a legacy table with 286 real rows.
    expect(executable).not.toMatch(/alter table public\.mentoring_recaps\b/);
    expect(executable).not.toMatch(/insert into public\.mentoring_recaps\b/);
    expect(executable).not.toMatch(/update public\.mentoring_recaps\b/);
    expect(executable).not.toContain("mentoring_recaps");
  });

  it("leaves matches, people and events untouched", () => {
    for (const guarded of ["matches", "people", "events", "mentor_profiles", "applications"]) {
      expect(executable).not.toMatch(new RegExp(`alter table public\\.${guarded}\\b`));
      expect(executable).not.toMatch(new RegExp(`insert into public\\.${guarded}\\b`));
      expect(executable).not.toMatch(new RegExp(`update public\\.${guarded}\\b`));
      expect(executable).not.toMatch(new RegExp(`delete from public\\.${guarded}\\b`));
    }
  });

  it("never drops or renames anything beyond the two CHECK constraints it replaces", () => {
    const drops = executable.match(/drop constraint if exists[^\n;]*/g) ?? [];
    expect(drops).toHaveLength(1);
    expect(drops[0]).toContain("outbound_emails_kind_check");

    expect(executable).not.toMatch(/drop table/i);
    expect(executable).not.toMatch(/drop column/i);
    expect(executable).not.toMatch(/rename/i);
    expect(executable).not.toMatch(/alter column/i);
  });

  it("writes only its own field vocabulary, and creates no request", () => {
    const inserts = executable.match(/insert into public\.([a-z_]+)/g) ?? [];
    const tables = Array.from(new Set(inserts.map((line) => line.replace("insert into public.", ""))));
    expect(tables).toEqual(["cross_mentoring_fields"]);
  });

  it("leaves the migration-036 taxonomy entirely alone", () => {
    // Its junctions are wiped wholesale by lib/people-create.ts every time an
    // organiser saves the mentor edit form, and they carry no season.
    for (const legacy of [
      "industries",
      "function_areas",
      "mentor_industries",
      "mentor_function_areas"
    ]) {
      expect(executable, legacy).not.toMatch(new RegExp(`(insert into|alter table|update) public\\.${legacy}\\b`));
    }
  });

  it("leaves mentor_season_confirmations alone", () => {
    // The public confirmation page locks as soon as a mentor has an active
    // match, so it cannot be where fields are declared mid-season.
    expect(executable).not.toContain("mentor_season_confirmations");
  });

  it("does not widen action_items, whose live shape has drifted from its migration", () => {
    expect(executable).not.toContain("action_items");
  });
});

describe("migration 072 — a scheduled session cannot exist without an event", () => {
  it("ties the three committed states to a time and an event", () => {
    expect(executable).toContain("constraint cross_requests_scheduled_shape_check");
    expect(executable).toMatch(/status not in \('scheduled', 'published', 'completed'\)/);
    expect(executable).toMatch(/scheduled_at is not null and event_id is not null/);
  });

  it("fails the transaction if that constraint did not take", () => {
    const at = executable.indexOf(
      "CONSTRAINT_CONTRACT_VIOLATION: a scheduled request could exist without an event"
    );
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(executable.indexOf("commit;"));
  });

  it("keeps the request when the event is deleted, rather than losing the history", () => {
    expect(executable).toMatch(/event_id uuid null references public\.events\(id\) on delete set null/);
  });

  it("makes a rejection say why", () => {
    expect(executable).toContain("constraint cross_requests_rejected_shape_check");
  });

  it("allows one live wish per mentee per field per season", () => {
    expect(executable).toContain("cross_requests_one_live_idx");
    expect(executable).toMatch(
      /where status in \('draft', 'submitted', 'approved', 'inviting', 'selecting'\)/
    );
  });
});

describe("migration 072 — one invitation per mentor per request", () => {
  it("makes it unique, so a repeated sweep writes to nobody twice", () => {
    expect(executable).toContain(
      "constraint cross_invitations_request_mentor_key unique (request_id, mentor_person_id)"
    );
  });

  it("fails the transaction if that constraint did not take", () => {
    const at = executable.indexOf(
      "CONSTRAINT_CONTRACT_VIOLATION: an invitation is not unique per mentor per request"
    );
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(executable.indexOf("commit;"));
  });

  it("gives the mentor a bearer token, unique and expiring", () => {
    expect(executable).toMatch(/token uuid not null default gen_random_uuid\(\)/);
    expect(executable).toContain("constraint cross_invitations_token_key unique (token)");
    expect(executable).toContain("token_expires_at timestamptz null");
  });

  it("indexes the reverse lookup the twice-passed-over rule needs", () => {
    expect(executable).toContain("cross_invitations_passed_over_idx");
    expect(executable).toMatch(/on public\.cross_invitations \(season_id, mentor_person_id\)/);
  });

  it("records who decided, and refuses a decision with no decider", () => {
    expect(executable).toContain("constraint cross_invitations_decision_shape_check");
    expect(executable).toMatch(/status in \('selected', 'not_selected'\) and decided_at is not null/);
  });
});

describe("migration 072 — the offered hours", () => {
  it("stores them as rows, not as JSON", () => {
    expect(executable).toContain("create table if not exists public.cross_invitation_slots (");
    expect(executable).toMatch(/starts_at timestamptz not null/);
    expect(executable).not.toMatch(/slots jsonb/);
  });

  it("treats the same hour offered twice as one", () => {
    expect(executable).toContain(
      "constraint cross_invitation_slots_invitation_time_key unique (invitation_id, starts_at)"
    );
  });

  it("removes the hours when the invitation goes", () => {
    expect(executable).toMatch(
      /invitation_id uuid not null references public\.cross_invitations\(id\) on delete cascade/
    );
  });
});

describe("migration 072 — the log is append-only", () => {
  it("grants insert and select, never update or delete", () => {
    expect(executable).toMatch(
      /grant select, insert\s+on public\.cross_request_log\s+to service_role/
    );
    expect(executable).not.toMatch(/grant[^;]*update[^;]*on public\.cross_request_log/i);
  });

  it("fails the transaction if the log could ever be rewritten", () => {
    const at = executable.indexOf("GRANT_CONTRACT_VIOLATION: the request log must be append-only");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(executable.indexOf("commit;"));
  });

  it("can name a mentee as the actor, who has no admin_users row", () => {
    expect(executable).toMatch(
      /changed_by_person_id uuid null references public\.people\(id\) on delete set null/
    );
  });

  it("names every kind of change it records", () => {
    for (const change of [
      "created",
      "status_change",
      "invited",
      "mentor_responded",
      "selected",
      "not_selected",
      "scheduled",
      "post_drafted",
      "cancelled"
    ]) {
      expect(executable, change).toContain(`'${change}'`);
    }
  });
});

describe("migration 072 — the field vocabulary", () => {
  it("keeps industry and function apart, so a shared code is never ambiguous", () => {
    // 'other' and 'undecided' appear in both lists.
    expect(executable).toContain("constraint cross_mentoring_fields_kind_code_key unique (kind, code)");
    expect(executable).toContain("check (kind in ('industry', 'function'))");
  });

  it("marks the two answers that can never be the subject of a session", () => {
    expect(executable).toContain("is_requestable boolean not null default true");
    expect(executable).toMatch(/'undecided',\s+'Chưa xác định rõ',\s+false/);
    expect(executable).toMatch(/'other',\s+'Khác',\s+false/);
  });

  it("refuses a code that is not a code", () => {
    // The migration-036 rows are slugified Vietnamese like 'tài_chính_/_ngân_hàng';
    // this shape check makes that impossible here by construction.
    expect(executable).toContain("cross_mentoring_fields_code_shape_check");
    expect(executable).toMatch(/check \(code ~ '\^\[a-z\]\[a-z0-9_\]\*\$'\)/);
  });

  it("ties a mentor's declaration to a season and to a person, not to a profile", () => {
    // mentor_profiles.person_id is nullable and not unique, and the lookup that
    // resolves it picks an arbitrary row when there are two.
    expect(executable).toContain("constraint mentor_cross_fields_person_season_field_key");
    expect(executable).toMatch(/unique \(person_id, season_id, field_kind, field_code\)/);

    const table = executable.match(
      /create table if not exists public\.mentor_cross_fields \([\s\S]*?\n\);/
    )?.[0];
    expect(table).toBeTruthy();
    expect(table).not.toMatch(/mentor_profile_id/);
  });

  it("indexes the reverse lookup the invitation sweep runs", () => {
    expect(executable).toContain("mentor_cross_fields_season_field_idx");
    expect(executable).toMatch(
      /on public\.mentor_cross_fields \(season_id, field_kind, field_code\)/
    );
  });

  it("records where a declaration came from", () => {
    // 'application' is the answer carried forward at approval, so a mentor who
    // never opens a form still has fields on file.
    expect(executable).toContain("check (source in ('self', 'application', 'admin'))");
  });
});

describe("migration 072 — the seeded fields", () => {
  it("seeds the twelve requestable industries the forms already store", () => {
    for (const code of [
      "fmcg",
      "tech",
      "finance_banking",
      "consulting",
      "manufacturing",
      "education",
      "healthcare",
      "media_creative",
      "logistics",
      "real_estate",
      "energy_environment",
      "public_nonprofit"
    ]) {
      expect(executable, code).toContain(`'${code}',`);
    }
  });

  it("seeds the twelve requestable functions", () => {
    for (const code of [
      "marketing",
      "sales_bd",
      "finance_accounting",
      "hr_people",
      "operations",
      "tech_engineering",
      "data_analytics",
      "product",
      "strategy_consulting",
      "supply_chain",
      "legal_compliance",
      "general_management"
    ]) {
      expect(executable, code).toContain(`'${code}',`);
    }
  });

  it("re-running changes nothing", () => {
    expect(executable.match(/on conflict \(kind, code\) do nothing/g) ?? []).toHaveLength(1);
  });

  it("fails the transaction if the seed did not take", () => {
    for (const marker of [
      "SEED_INCOMPLETE: expected 24 requestable fields",
      "SEED_INCOMPLETE: expected 14 industry rows"
    ]) {
      const at = executable.indexOf(marker);
      expect(at, marker).toBeGreaterThan(-1);
      expect(at, marker).toBeLessThan(executable.indexOf("commit;"));
    }
  });

  it("refuses a request naming a field that does not exist", () => {
    expect(executable).toContain("constraint cross_requests_field_fkey");
    const at = executable.indexOf(
      "CONSTRAINT_CONTRACT_VIOLATION: a request could name a field that does not exist"
    );
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(executable.indexOf("commit;"));
  });
});

describe("migration 072 — the two widened vocabularies", () => {
  it("adds the three cross letters and keeps every kind that came before", () => {
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
      "recap_period_reminder",
      "participant_invite"
    ]) {
      expect(executable, kind).toContain(`'${kind}'`);
    }
    for (const kind of ["cross_invite", "cross_selected", "cross_not_selected"]) {
      expect(executable, kind).toContain(`'${kind}'`);
    }
  });

  it("tells the mentee their session was scheduled, rather than leaving them to notice", () => {
    expect(executable).toContain("'cross_scheduled'");
  });
});

describe("migration 072 — a cancelled session spends nobody's patience", () => {
  it("can mark a passing-over as not the mentor's fault", () => {
    expect(executable).toContain("counts_toward_decline boolean not null default true");
  });

  it("counts only the passings-over that were about the mentor", () => {
    expect(executable).toContain("cross_invitations_passed_over_idx");
    expect(executable).toMatch(/where status = 'not_selected' and counts_toward_decline/);
  });

  it("gives the sweep a work queue of invitations minted but not yet mailed", () => {
    // Claiming a row before sending is what stops two clicks mailing twice.
    expect(executable).toContain("cross_invitations_unsent_idx");
    expect(executable).toMatch(/where link_sent_at is null/);
  });
});

describe("migration 072 — privilege contract", () => {
  it("enables row level security on all four tables", () => {
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
      "CONSTRAINT_CONTRACT_VIOLATION: outbound_emails.kind does not accept cross_invite"
    ]) {
      const at = executable.indexOf(marker);
      expect(at, marker).toBeGreaterThan(-1);
      expect(at, marker).toBeLessThan(executable.indexOf("commit;"));
    }
  });
});

describe("migration 073 — the cross_mentoring event type", () => {
  it("is deliberately NOT wrapped in a transaction", () => {
    // `alter type ... add value` cannot run inside one — the same reason
    // migration 048 is its own unwrapped file.
    expect(eventTypeExecutable).not.toMatch(/^begin;$/m);
    expect(eventTypeExecutable).not.toMatch(/^commit;$/m);
  });

  it("handles the enum shape and the text+CHECK shape, guarded both ways", () => {
    expect(eventTypeExecutable).toContain("to_regtype('public.event_type') is not null");
    expect(eventTypeExecutable).toContain("alter type public.event_type add value ''cross_mentoring''");
    expect(eventTypeExecutable).toContain("conname = 'events_event_type_check'");
  });

  it("adds the value only when it is missing", () => {
    expect(eventTypeExecutable).toContain("e.enumlabel = 'cross_mentoring'");
    expect(eventTypeExecutable).toMatch(/if not exists \(/);
  });

  it("keeps every event type that already existed, including the three outside the app's own list", () => {
    for (const type of [
      "orientation",
      "training",
      "workshop",
      "community",
      "matching",
      "company_tour",
      "networking",
      "closing",
      "business_case",
      "job_shadowing",
      "kickoff",
      "other"
    ]) {
      expect(eventTypeExecutable, type).toContain(`'${type}'`);
    }
    expect(eventTypeExecutable).toContain("'cross_mentoring'");
  });

  it("touches nothing but the event type", () => {
    expect(eventTypeExecutable).not.toMatch(/create table/i);
    expect(eventTypeExecutable).not.toMatch(/insert into/i);
    expect(eventTypeExecutable).not.toMatch(/drop table/i);
  });
});
