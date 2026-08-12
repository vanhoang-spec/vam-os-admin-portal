/**
 * Regression cover for the Production `/operations` role-divergence bug.
 *
 * Two authorized users on the same URL, month, program and season saw different
 * KPI truth: a scoped Admin read `mentoring_recaps` through an unpaginated
 * `.in()` query that PostgREST silently capped at `db-max-rows` (1000), while an
 * unscoped Super Admin read the same table through a paged loader. With ~2322
 * recaps in Production the Admin lost every row past the cap — including all of
 * the newest month — and the loss surfaced as legitimate zero activity.
 *
 * The mock below reproduces the cap exactly: a `select()` with no `.range()`
 * returns at most MAX_ROWS rows, with `error: null`. Any loader that does not
 * page is therefore silently truncated here, the same way it is in Production.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getOperationsData } from "@/lib/data";
import { computeProgramOperationsKpis } from "@/lib/operations-kpis";
import { getAdminScopeContext, getScopeFilter, canReadSeason, SCOPE_RESOLUTION_ERROR } from "@/lib/program-scope";
import { canEditRecaps } from "@/lib/auth-constants";
import { getSupabaseServerClient, getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { getCurrentAdminUser } from "@/lib/admin-auth";

/** PostgREST `db-max-rows` on Supabase hosted. */
const MAX_ROWS = 1000;

const SEASON_CODE = "UEHM-S11";
const UEH_SEASON = "11111111-1111-4111-8111-111111111111";
const HAM_SEASON = "22222222-2222-4222-8222-222222222222";
const UEH_PROGRAM = "33333333-3333-4333-8333-333333333333";
const HAM_PROGRAM = "44444444-4444-4444-8444-444444444444";

const { tables, rpcResult, mockFrom, mockRpc } = vi.hoisted(() => {
  const tables: Record<string, any[]> = {};
  const errors: Record<string, any> = {};
  const rpcResult: { value: any } = { value: { data: null, error: { code: "PGRST202", message: "not found" } } };
  return { tables, errors, rpcResult, mockFrom: vi.fn(), mockRpc: vi.fn() };
});

const tableErrors: Record<string, any> = {};

function builder(rows: any[], error: any) {
  const self: any = {
    in(column: string, values: string[]) {
      return builder(rows.filter((row) => values.includes(row[column])), error);
    },
    eq(column: string, value: unknown) {
      return builder(rows.filter((row) => row[column] === value), error);
    },
    // PostgREST honours the requested window but never returns more than
    // MAX_ROWS rows for it.
    range(from: number, to: number) {
      if (error) return Promise.resolve({ data: null, error });
      const end = Math.min(to + 1, from + MAX_ROWS);
      return Promise.resolve({ data: rows.slice(from, end), error: null });
    },
    maybeSingle() {
      if (error) return Promise.resolve({ data: null, error });
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    },
    // No `.range()` was chained: the cap applies and nothing signals it.
    then(resolve: any) {
      if (error) return resolve({ data: null, error });
      return resolve({ data: rows.slice(0, MAX_ROWS), error: null });
    }
  };
  return self;
}

function client() {
  return {
    from: (table: string) => ({
      select: () => builder(tables[table] ?? [], tableErrors[table] ?? null)
    }),
    rpc: (...args: unknown[]) => {
      mockRpc(...args);
      return Promise.resolve(rpcResult.value);
    }
  };
}

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: (fn: any) => fn }));
vi.mock("@/lib/supabase", () => ({ supabase: null, supabaseUrl: "https://x.test", supabaseAnonKey: "anon" }));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: vi.fn(),
  getSupabaseServerClient: vi.fn()
}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));

/** ~2322 recaps, matching the recorded Production volume, newest month last. */
function seedRecaps() {
  const months = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];
  const rows: any[] = [];
  let n = 0;
  for (const month of months) {
    for (let i = 0; i < 256; i += 1) {
      rows.push({
        id: `recap-${n++}`,
        season_id: UEH_SEASON,
        meeting_month: month,
        meeting_date: `${month}-15`,
        status: "submitted",
        mentor_person_id: `mentor-${i % 438}`,
        mentee_person_id: `mentee-${i % 637}`
      });
    }
  }
  // July 2026 — the month under investigation — is inserted last, so an
  // unpaginated read past the cap loses all of it.
  for (let i = 0; i < 18; i += 1) {
    rows.push({
      id: `recap-july-${i}`,
      season_id: UEH_SEASON,
      meeting_month: "2026-07",
      meeting_date: "2026-07-15",
      status: "submitted",
      mentor_person_id: `mentor-${i % 3}`,
      mentee_person_id: `mentee-${i % 15}`
    });
  }
  // Another program's season must never leak into the UEHM aggregate.
  rows.push({
    id: "recap-ham",
    season_id: HAM_SEASON,
    meeting_month: "2026-07",
    meeting_date: "2026-07-20",
    status: "submitted",
    mentor_person_id: "mentor-ham",
    mentee_person_id: "mentee-ham"
  });
  return rows;
}

function seedMatches() {
  const rows: any[] = [];
  for (let i = 0; i < 637; i += 1) {
    rows.push({
      id: `match-${i}`,
      season_id: UEH_SEASON,
      status: "active",
      mentor_person_id: `mentor-${i % 438}`,
      mentee_person_id: `mentee-${i}`
    });
  }
  rows.push({ id: "match-ham", season_id: HAM_SEASON, status: "active", mentor_person_id: "mentor-ham", mentee_person_id: "mentee-ham" });
  return rows;
}

function seed() {
  tables.seasons = [
    { id: UEH_SEASON, code: SEASON_CODE, name: "UEH Mentoring Season 11", program_id: UEH_PROGRAM },
    { id: HAM_SEASON, code: "HAM-S6", name: "HAM Season 6", program_id: HAM_PROGRAM }
  ];
  tables.programs = [
    { id: UEH_PROGRAM, code: "UEHM", name: "UEH Mentoring" },
    { id: HAM_PROGRAM, code: "HAM", name: "HAM" }
  ];
  tables.mentoring_recaps = seedRecaps();
  tables.matches = seedMatches();
  tables.events = [{ id: "event-1", season_id: UEH_SEASON, starts_at: "2026-07-10T01:00:00Z" }];
  tables.event_participations = [{ id: "part-1", event_id: "event-1", season_id: UEH_SEASON, person_id: "mentee-0", attendance_status: "attended" }];
  tables.people = [];
  tables.mentee_profiles = [];
  tables.mentor_profiles = [];
  tables.applications = [];
  tables.person_season_memberships = [];
  tables.intake_batches = [];
  tables.v_season_latest_closed_month = [{ season_id: UEH_SEASON, latest_closed_month: "2026-06", previous_closed_month: "2026-05" }];
  tables.admin_scope_access = [];
}

const UEHM_SCOPE = { allowedProgramIds: [UEH_PROGRAM, "UEHM"], allowedSeasonIds: [UEH_SEASON] };

async function kpisFor(scope: any, month: string) {
  const data = await getOperationsData(scope);
  return {
    kpis: computeProgramOperationsKpis({
      seasons: data.seasons.data,
      matches: data.matches.data,
      recaps: data.recaps.data,
      events: data.events.data,
      eventParticipations: data.eventParticipations.data,
      seasonCode: SEASON_CODE,
      selectedMonth: month
    }),
    errors: [data.seasons.error, data.matches.error, data.recaps.error, data.events.error, data.eventParticipations.error].filter(Boolean)
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(tables)) delete tables[key];
  for (const key of Object.keys(tableErrors)) delete tableErrors[key];
  rpcResult.value = { data: null, error: { code: "PGRST202", message: "not found" } };
  seed();
  const db = client();
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db as any);
  vi.mocked(getSupabaseServerClient).mockReturnValue(db as any);
  vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "admin-1", role: "admin", status: "active", auth_user_id: "auth-admin" } as any);
});

describe("Operations aggregate parity across roles", () => {
  it("1. authorized Admin and Super Admin get identical July aggregates", async () => {
    const superAdmin = await kpisFor(undefined, "2026-07");
    const admin = await kpisFor(UEHM_SCOPE, "2026-07");

    expect(admin.errors).toEqual([]);
    expect(superAdmin.errors).toEqual([]);
    expect(admin.kpis).toEqual(superAdmin.kpis);
    // The exact values the scoped path used to lose entirely.
    expect(admin.kpis.recapCount).toBe(18);
    expect(admin.kpis.activeMenteeCount).toBe(15);
    expect(admin.kpis.activeMentorCount).toBe(3);
    expect(admin.kpis.mentorWithoutRecapCount).toBe(435);
  });

  it("1b. the scoped loader returns every recap, not just the first page", async () => {
    const data = await getOperationsData(UEHM_SCOPE);
    expect(data.recaps.data.length).toBeGreaterThan(MAX_ROWS);
    expect(data.recaps.data.length).toBe(tables.mentoring_recaps.filter((r) => r.season_id === UEH_SEASON).length);
  });

  it("1c. matches the pre-aggregated RPC payload the Super Admin path uses", async () => {
    rpcResult.value = {
      data: {
        seasons: tables.seasons,
        people: [],
        mentees: [],
        matches: tables.matches,
        recaps: tables.mentoring_recaps,
        events: tables.events,
        eventParticipations: tables.event_participations
      },
      error: null
    };
    const viaRpc = await getOperationsData(undefined);
    const rpcKpis = computeProgramOperationsKpis({
      seasons: viaRpc.seasons.data,
      matches: viaRpc.matches.data,
      recaps: viaRpc.recaps.data,
      events: viaRpc.events.data,
      eventParticipations: viaRpc.eventParticipations.data,
      seasonCode: SEASON_CODE,
      selectedMonth: "2026-07"
    });
    const admin = await kpisFor(UEHM_SCOPE, "2026-07");
    expect(admin.kpis).toEqual(rpcKpis);
  });

  it("2. an authorized Reviewer with read scope gets the same aggregate", async () => {
    const reviewer = await kpisFor({ allowedProgramIds: [UEH_PROGRAM], allowedSeasonIds: [UEH_SEASON] }, "2026-07");
    const superAdmin = await kpisFor(undefined, "2026-07");
    expect(reviewer.kpis).toEqual(superAdmin.kpis);
  });

  it("5. different months still produce different values", async () => {
    const july = await kpisFor(UEHM_SCOPE, "2026-07");
    const june = await kpisFor(UEHM_SCOPE, "2026-06");
    expect(july.kpis.recapCount).toBe(18);
    expect(june.kpis.recapCount).toBe(256);
    expect(june.kpis.recapCount).not.toBe(july.kpis.recapCount);
  });

  it("no cross-program contamination: HAM rows never enter the UEHM aggregate", async () => {
    const admin = await getOperationsData(UEHM_SCOPE);
    expect(admin.recaps.data.some((row: any) => row.season_id === HAM_SEASON)).toBe(false);
    expect(admin.matches.data.some((row: any) => row.season_id === HAM_SEASON)).toBe(false);

    const superAdmin = await kpisFor(undefined, "2026-07");
    expect(superAdmin.kpis.recapCount).toBe(18); // not 19
  });

  it("9. the scoped read is still filtered to granted seasons only", async () => {
    const hamOnly = await getOperationsData({ allowedProgramIds: [HAM_PROGRAM], allowedSeasonIds: [HAM_SEASON] });
    expect(hamOnly.recaps.data.every((row: any) => row.season_id === HAM_SEASON)).toBe(true);
    expect(hamOnly.recaps.data.some((row: any) => row.season_id === UEH_SEASON)).toBe(false);
  });
});

describe("Failures and denials never render as zero activity", () => {
  it("4. a recap query failure surfaces an error instead of a zero aggregate", async () => {
    tableErrors.mentoring_recaps = { code: "57014", message: "statement timeout" };
    const result = await kpisFor(UEHM_SCOPE, "2026-07");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(String(result.errors[0])).toContain("mentoring_recaps");
  });

  it("4b. an unreadable admin_scope_access reports a scope error, not an empty scope", async () => {
    tableErrors.admin_scope_access = { code: "42501", message: "permission denied" };
    const ctx = await getAdminScopeContext();
    expect(ctx.scopeError).toBe(SCOPE_RESOLUTION_ERROR);
    expect(ctx.programScopes).toEqual([]);
    // Still fails closed for data: the error must not widen access.
    expect(await getScopeFilter(ctx)).toEqual({ allowedProgramIds: [], allowedSeasonIds: [] });
  });

  it("4c. a missing service-role credential is an error, not an ungranted user", async () => {
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(null as any);
    const ctx = await getAdminScopeContext();
    expect(ctx.scopeError).toBe(SCOPE_RESOLUTION_ERROR);
  });

  it("3. a user with no season/program grant is denied, not given zeros", async () => {
    tables.admin_scope_access = [];
    const ctx = await getAdminScopeContext();
    expect(ctx.scopeError).toBeNull();
    expect(await canReadSeason(ctx, SEASON_CODE)).toBe(false);
  });

  it("3b. a user granted only another program is denied the UEHM aggregate", async () => {
    tables.admin_scope_access = [{ user_id: "auth-admin", program_id: HAM_PROGRAM, season_id: null, role: "read", status: "active" }];
    const ctx = await getAdminScopeContext();
    expect(await canReadSeason(ctx, SEASON_CODE)).toBe(false);
    expect(await canReadSeason(ctx, "HAM-S6")).toBe(true);
  });

  it("3c. a user granted UEHM-S11 is allowed the aggregate", async () => {
    tables.admin_scope_access = [{ user_id: "auth-admin", program_id: null, season_id: UEH_SEASON, role: "read", status: "active" }];
    const ctx = await getAdminScopeContext();
    expect(await canReadSeason(ctx, SEASON_CODE)).toBe(true);
  });
});

describe("Scope and role semantics are unchanged", () => {
  it("8. Super Admin still bypasses the scope filter", async () => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "su", role: "super_admin", status: "active", auth_user_id: "auth-su" } as any);
    const ctx = await getAdminScopeContext();
    expect(ctx.isSuperAdmin).toBe(true);
    expect(await getScopeFilter(ctx)).toBeUndefined();
  });

  it("9b. only active grants for this user are read", async () => {
    tables.admin_scope_access = [
      { user_id: "auth-admin", program_id: UEH_PROGRAM, season_id: null, role: "read", status: "active" },
      { user_id: "auth-admin", program_id: HAM_PROGRAM, season_id: null, role: "read", status: "revoked" },
      { user_id: "someone-else", program_id: HAM_PROGRAM, season_id: null, role: "full_access", status: "active" }
    ];
    const ctx = await getAdminScopeContext();
    expect(ctx.programScopes).toEqual([{ programId: UEH_PROGRAM, seasonId: null, scopeLevel: "read", status: "active" }]);
  });

  it("6. detail and action permissions stay role-dependent", () => {
    expect(canEditRecaps({ role: "super_admin" })).toBe(true);
    expect(canEditRecaps({ role: "admin" })).toBe(true);
    expect(canEditRecaps({ role: "reviewer" })).toBe(false);
    expect(canEditRecaps({ role: "viewer" })).toBe(false);
  });

  it("6b. aggregate KPIs carry no PII regardless of role", async () => {
    const admin = await kpisFor(UEHM_SCOPE, "2026-07");
    expect(JSON.stringify(admin.kpis)).not.toContain("@");
    expect(Object.keys(admin.kpis)).not.toEqual(expect.arrayContaining(["email", "people", "name"]));
  });
});
