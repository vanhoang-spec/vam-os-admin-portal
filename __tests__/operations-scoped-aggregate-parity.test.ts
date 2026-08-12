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
 * The shared fake in `__tests__/support/fake-postgrest.ts` reproduces both
 * halves of the real failure: the cap is applied silently, AND a read with no
 * `ORDER BY` comes back in an arbitrary order. "Old behaviour" is not simulated
 * by commentary — `readOldUnpagedWay` below issues the exact query the blocked
 * commit's parent issued, so the Production symptom is reproduced inside the
 * test rather than asserted about.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, fakeClient, DEFAULT_MAX_ROWS, requestsFor } from "./support/fake-postgrest";
import { getOperationsData } from "@/lib/data";
import { computeProgramOperationsKpis } from "@/lib/operations-kpis";
import { getAdminScopeContext, getScopeFilter, canReadSeason, SCOPE_RESOLUTION_ERROR } from "@/lib/program-scope";
import { canEditRecaps } from "@/lib/auth-constants";
import { getSupabaseServerClient, getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { getCurrentAdminUser } from "@/lib/admin-auth";

/** PostgREST `db-max-rows` on Supabase hosted. */
const MAX_ROWS = DEFAULT_MAX_ROWS;

const SEASON_CODE = "UEHM-S11";
const UEH_SEASON = "11111111-1111-4111-8111-111111111111";
const HAM_SEASON = "22222222-2222-4222-8222-222222222222";
const UEH_PROGRAM = "33333333-3333-4333-8333-333333333333";
const HAM_PROGRAM = "44444444-4444-4444-8444-444444444444";

const { rpcResult, mockRpc } = vi.hoisted(() => ({
  rpcResult: { value: { data: null, error: { code: "PGRST202", message: "not found" } } as any },
  mockRpc: vi.fn()
}));

const db = createFakeDb();
const tables = db.tables;
const tableErrors = db.errors;

function client() {
  return fakeClient(db, {
    rpc: (...args: unknown[]) => {
      mockRpc(...args);
      return rpcResult.value;
    }
  });
}

/**
 * The read `lib/data.ts` issued before the fix: a bare `.in()` with no
 * `.range()` and no `ORDER BY`. Kept verbatim so the original defect stays
 * provable from this suite even after the fixed loader is refactored again.
 */
async function readOldUnpagedWay(table: string, column: string, values: string[], columns: string) {
  return client().from(table).select(columns).in(column, values);
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
  db.reset();
  rpcResult.value = { data: null, error: { code: "PGRST202", message: "not found" } };
  seed();
  const supabase = client();
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(supabase as any);
  vi.mocked(getSupabaseServerClient).mockResolvedValue(supabase as any);
  vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "admin-1", role: "admin", status: "active", auth_user_id: "auth-admin" } as any);
});

describe("Root cause: the Production bug, reproduced and then closed", () => {
  it("R1. the old unpaged scoped read silently returns exactly 1000 rows with error null", async () => {
    const { data, error } = await readOldUnpagedWay("mentoring_recaps", "season_id", [UEH_SEASON], "id,meeting_month");
    expect(error).toBeNull();
    expect(data).toHaveLength(MAX_ROWS);
    // Nothing in the response distinguishes this from a complete read.
  });

  it("R2. the rows past the cap — including every July recap — are the ones lost", async () => {
    const all = tables.mentoring_recaps.filter((row: any) => row.season_id === UEH_SEASON);
    expect(all.length).toBeGreaterThan(MAX_ROWS);
    const { data } = await readOldUnpagedWay("mentoring_recaps", "season_id", [UEH_SEASON], "id,meeting_month");
    expect((data as any[]).length).toBeLessThan(all.length);
    expect(all.filter((row: any) => row.meeting_month === "2026-07")).toHaveLength(18);
  });

  it("R3. the old read produced scoped recapCount 0 while the full aggregate was 18", async () => {
    const { data: truncated } = await readOldUnpagedWay(
      "mentoring_recaps",
      "season_id",
      [UEH_SEASON],
      "id,season_id,meeting_month,status,mentor_person_id,mentee_person_id"
    );
    const oldKpis = computeProgramOperationsKpis({
      seasons: tables.seasons as any,
      matches: tables.matches as any,
      recaps: truncated as any,
      events: tables.events as any,
      eventParticipations: tables.event_participations as any,
      seasonCode: SEASON_CODE,
      selectedMonth: "2026-07"
    });
    const fixed = await kpisFor(UEHM_SCOPE, "2026-07");

    // The exact Production divergence: same season, same month, two answers.
    expect(oldKpis.recapCount).toBe(0);
    expect(oldKpis.activeMenteeCount).toBe(0);
    expect(oldKpis.activeMentorCount).toBe(0);
    expect(fixed.kpis.recapCount).toBe(18);
    expect(fixed.kpis.activeMenteeCount).toBe(15);
    expect(fixed.kpis.activeMentorCount).toBe(3);
    expect(fixed.kpis.recapCount).not.toBe(oldKpis.recapCount);
  });

  it("R4. every scoped recap page is ordered and carries an identical filter set", async () => {
    await getOperationsData(UEHM_SCOPE);
    // `/operations` issues several recap reads. Isolate the KPI read — the one
    // that broke in Production — by its projection; `recap_url` appears only in
    // OPS_RECAPS_SELECT, and that read is issued exactly once per page load.
    const pages = requestsFor(db, "mentoring_recaps").filter((request) => request.columns.includes("recap_url"));
    expect(pages.length).toBeGreaterThan(2);
    // Reverting the ordering key would leave `order` empty on every page.
    for (const page of pages) expect(page.order).toEqual(["id:asc"]);
    // Every page must carry the same scope predicate. The only legitimate
    // difference between pages is the keyset cursor (`id > :last`), so it is
    // stripped before comparing; anything else differing would mean a page read
    // a different slice of the table than its siblings.
    const scopeFilters = new Set(
      pages.map((page) =>
        JSON.stringify(
          (JSON.parse(page.filters) as any[]).filter((filter) => !(filter.kind === "gt" && filter.column === "id"))
        )
      )
    );
    expect(scopeFilters.size).toBe(1);
    expect(JSON.parse(Array.from(scopeFilters)[0])).toEqual([{ kind: "in", column: "season_id", values: [UEH_SEASON] }]);
    // Every page after the first must carry a keyset cursor. Without it the
    // read is offset paging wearing an ORDER BY, and rows can shift between
    // pages under concurrent writes.
    const cursors: string[] = [];
    for (const page of pages.slice(1)) {
      const cursor = (JSON.parse(page.filters) as any[]).find((filter) => filter.kind === "gt" && filter.column === "id");
      expect(cursor).toBeDefined();
      cursors.push(String(cursor.value));
    }
    // Cursors advance strictly, so no two pages can overlap.
    expect([...cursors].sort()).toEqual(cursors);
    expect(new Set(cursors).size).toBe(cursors.length);
    // The read terminates on an empty page, never on a short one.
    expect(pages[pages.length - 1].returned).toBe(0);
  });

  it("R5. the scoped read returns each recap exactly once — no gaps, no duplicates", async () => {
    const data = await getOperationsData(UEHM_SCOPE);
    const expected = tables.mentoring_recaps.filter((row: any) => row.season_id === UEH_SEASON).map((row: any) => row.id).sort();
    const seen = data.recaps.data.map((row: any) => row.id).sort();
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toEqual(expected);
  });
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
