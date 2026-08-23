import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Migration 074 is read as text, the same way the other migration suites read
 * theirs. Nothing here touches a database — these are the promises the file
 * makes, checked so a later edit cannot quietly withdraw one.
 */

const SQL = readFileSync(
  join(process.cwd(), "supabase_migrations", "074_mkt_plan.sql"),
  "utf8"
);

const TABLES = [
  "mkt_spaces",
  "mkt_space_channels",
  "mkt_master_plans",
  "mkt_week_plans",
  "mkt_orders",
  "mkt_posts",
  "mkt_post_log"
];

describe("migration 074 — shape", () => {
  it("creates all seven tables idempotently", () => {
    for (const table of TABLES) {
      expect(SQL, table).toContain(`create table if not exists public.${table}`);
    }
  });

  it("runs inside one transaction", () => {
    expect(SQL).toContain("begin;");
    expect(SQL).toContain("commit;");
    expect(SQL.indexOf("begin;")).toBeLessThan(SQL.indexOf("commit;"));
  });

  it("reloads the API schema cache at the end", () => {
    expect(SQL.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });

  it("checks its prerequisites before doing anything", () => {
    expect(SQL).toContain("PREREQ_MISSING");
    expect(SQL).toContain("public.programs");
    expect(SQL).toContain("public.set_updated_at");
  });
});

describe("migration 074 — additive only", () => {
  it("drops no table and no column", () => {
    expect(SQL).not.toMatch(/drop\s+table(?!\s+if\s+exists\s+public\.(mkt_))/i);
    expect(SQL).not.toMatch(/drop\s+column/i);
  });

  it("drops only its own triggers, which is how a re-run stays safe", () => {
    const drops = SQL.match(/drop trigger if exists (\S+)/g) ?? [];
    for (const drop of drops) {
      expect(drop).toContain("mkt_");
    }
  });

  it("does not touch the tables it reads from", () => {
    // The plan READS the real calendar out of events and cross_requests. It
    // must never write to them, and it must never alter them.
    for (const table of ["events", "cross_requests", "people", "seasons", "programs"]) {
      expect(SQL, table).not.toMatch(new RegExp(`alter table public\\.${table}\\b`, "i"));
      expect(SQL, table).not.toMatch(new RegExp(`update public\\.${table}\\b`, "i"));
      expect(SQL, table).not.toMatch(new RegExp(`delete from public\\.${table}\\b`, "i"));
    }
  });

  it("creates no storage bucket", () => {
    // The application uses Supabase Storage nowhere; designers record a link.
    expect(SQL).not.toContain("storage.buckets");
  });
});

describe("migration 074 — LinkedIn belongs to VAM, not to a programme", () => {
  it("derives is_shared rather than letting it be typed in", () => {
    expect(SQL).toContain("generated always as (program_id is null) stored");
  });

  it("holds the rule as a CHECK, not only in the application", () => {
    expect(SQL).toContain("check ((channel = 'linkedin') = is_shared)");
  });

  it("ties a channel row to its space's shared flag with a composite key", () => {
    expect(SQL).toContain("mkt_space_channels_space_fkey");
    expect(SQL).toContain("references public.mkt_spaces (id, is_shared)");
  });

  it("allows exactly one shared space", () => {
    expect(SQL).toContain("mkt_spaces_one_shared_idx");
    expect(SQL).toContain("where program_id is null");
  });

  it("allows one space per programme", () => {
    expect(SQL).toContain("mkt_spaces_program_idx");
  });

  it("asserts both before committing", () => {
    expect(SQL).toContain("expected exactly 1 shared space");
    expect(SQL).toContain("expected exactly 1 shared LinkedIn channel");
    expect(SQL).toContain("programme space(s) hold LinkedIn");
  });
});

describe("migration 074 — a post cannot land on a channel its space does not run", () => {
  it("gives mkt_posts a composite foreign key to the channel table", () => {
    expect(SQL).toContain("mkt_posts_channel_fkey");
    expect(SQL).toContain("references public.mkt_space_channels (space_id, channel)");
  });

  it("allows at most one post per channel per day", () => {
    expect(SQL).toContain("mkt_posts_one_per_channel_per_day unique (space_id, channel, post_date)");
  });

  it("asserts both before committing", () => {
    expect(SQL).toContain("could name a channel its space does not run");
    expect(SQL).toContain("one-post-per-channel-per-day rule is missing");
  });
});

describe("migration 074 — TikTok is optional", () => {
  it("seeds TikTok and YouTube switched off", () => {
    expect(SQL).toMatch(/'tiktok', false, false, 0/);
    expect(SQL).toMatch(/'youtube', false, false, 0/);
  });

  it("seeds Facebook switched on for every programme", () => {
    expect(SQL).toMatch(/'facebook', false, true, 3/);
  });

  it("seeds LinkedIn on the shared space at one post a week", () => {
    expect(SQL).toMatch(/'linkedin', true, true, 1/);
  });

  it("refuses an active channel that produces nothing", () => {
    expect(SQL).toContain("check (not is_active or posts_per_week > 0)");
  });

  it("uses is_active rather than deleting rows, so history survives a switch-off", () => {
    expect(SQL).toContain("is_active boolean not null default false");
    expect(SQL).not.toMatch(/delete from public\.mkt_space_channels/i);
  });
});

describe("migration 074 — nothing publishes itself", () => {
  it("has a status vocabulary that stops at approved and posted", () => {
    expect(SQL).toContain(
      "check (status in ('planned', 'content_ready', 'draft_ready', 'approved', 'posted', 'skipped'))"
    );
  });

  it("requires a scheduled hour before a post can be approved", () => {
    expect(SQL).toContain("mkt_posts_approved_shape_check");
  });

  it("requires evidence before a post may claim it went out", () => {
    expect(SQL).toContain("mkt_posts_posted_shape_check");
    expect(SQL).toContain("posted_at is not null and posted_url is not null");
  });

  it("says in its own header that there is no auto-post", () => {
    expect(SQL).toContain("There is no auto-post");
  });
});

describe("migration 074 — a refusal says why", () => {
  it("requires a reason when a request is declined", () => {
    expect(SQL).toContain("mkt_orders_declined_shape_check");
  });

  it("keeps schedule urgency and message importance in two columns", () => {
    expect(SQL).toContain("is_urgent boolean not null default false");
    expect(SQL).toContain("content_priority text not null default 'normal'");
    expect(SQL).toContain("check (content_priority in ('high', 'priority', 'normal'))");
  });
});

describe("migration 074 — a week starts on Monday", () => {
  it("enforces it rather than trusting the caller", () => {
    expect(SQL).toContain("check (extract(isodow from week_start) = 1)");
  });

  it("allows one week plan per space per week", () => {
    expect(SQL).toContain("mkt_week_plans_space_week_unique unique (space_id, week_start)");
  });

  it("allows one master plan per space per month, with a month format check", () => {
    expect(SQL).toContain("mkt_master_plans_space_month_unique unique (space_id, month)");
    expect(SQL).toContain("month ~ '^\\d{4}-(0[1-9]|1[0-2])$'");
  });
});

describe("migration 074 — traceability", () => {
  it("keeps whatever the model returned, on both plan levels", () => {
    const aiRawCount = (SQL.match(/ai_raw jsonb null/g) ?? []).length;
    expect(aiRawCount).toBe(2);
  });

  it("records which model wrote a plan", () => {
    expect((SQL.match(/ai_model text null/g) ?? []).length).toBe(2);
  });

  it("records what happened to a post and who did it", () => {
    expect(SQL).toContain("create table if not exists public.mkt_post_log");
    for (const change of ["approved", "posted", "order_declined"]) {
      expect(SQL, change).toContain(`'${change}'`);
    }
  });
});

describe("migration 074 — security contract", () => {
  it("enables row level security on every table", () => {
    for (const table of TABLES) {
      expect(SQL, table).toContain(`alter table public.${table}`);
    }
    expect((SQL.match(/enable row level security/g) ?? []).length).toBe(TABLES.length);
  });

  it("creates no policy at all", () => {
    expect(SQL).not.toMatch(/create policy/i);
  });

  it("revokes everything from the client-facing roles", () => {
    for (const role of ["public", "anon", "authenticated"]) {
      expect(SQL, role).toContain(`revoke all on public.%I from ${role}`);
    }
  });

  it("grants only to service_role", () => {
    const grants = SQL.match(/^grant [^;]+;/gm) ?? [];
    expect(grants.length).toBeGreaterThan(0);
    for (const grant of grants) {
      expect(grant).toContain("to service_role");
    }
  });

  it("keeps the log append-only even for service_role", () => {
    expect(SQL).toContain("grant select, insert on public.mkt_post_log to service_role");
    expect(SQL).not.toMatch(/grant select, insert, update, delete on public\.mkt_post_log/);
    expect(SQL).toContain("the post log must be append-only");
  });

  it("asserts the whole contract before committing", () => {
    for (const marker of [
      "RLS_CONTRACT_VIOLATION",
      "GRANT_CONTRACT_VIOLATION",
      "CONSTRAINT_CONTRACT_VIOLATION",
      "SEED_INCOMPLETE",
      "TABLE_MISSING"
    ]) {
      expect(SQL, marker).toContain(marker);
    }
  });

  it("puts the self-check before commit, not after", () => {
    expect(SQL.lastIndexOf("RLS_CONTRACT_VIOLATION")).toBeLessThan(SQL.lastIndexOf("commit;"));
  });
});

describe("migration 074 — the file explains itself", () => {
  it("says why a space exists rather than one settings row", () => {
    expect(SQL).toContain("THE ONE DECISION EVERYTHING ELSE FOLLOWS FROM: A SPACE");
    expect(SQL).toContain("programs.name");
  });

  it("says why channels are a table rather than a jsonb column", () => {
    expect(SQL).toContain("WHY CHANNELS ARE A TABLE AND NOT A JSONB COLUMN");
  });

  it("lists what it deliberately does not do", () => {
    expect(SQL).toContain("WHAT THIS MIGRATION DOES NOT DO");
  });
});
