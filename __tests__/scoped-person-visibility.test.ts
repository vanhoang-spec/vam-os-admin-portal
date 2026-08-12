import { describe, expect, it, vi, beforeEach } from "vitest";
import { getScopedPersonIds, getPerson } from "@/lib/data";
import { getSupabaseServiceRoleClient, getSupabaseServerClient } from "@/lib/supabase-server";

const { mockTables, mockErrors, mockFrom } = vi.hoisted(() => {
  const tables: Record<string, any[]> = {};
  const errors: Record<string, any> = {};

  const fromFn = vi.fn((table: string) => {
    const rows = tables[table] || [];
    const error = errors[table] || null;

    const chain = {
      in: vi.fn((col, vals) => {
        // Mirrors the real client: `.in()` is awaitable and also pageable via
        // `.range()`, which the scoped loader uses to read past PostgREST's
        // silent db-max-rows cap.
        const filtered = error ? [] : rows.filter((r: any) => vals.includes(r[col]));
        return {
          range: (from: number, to: number) =>
            Promise.resolve(error ? { data: [], error } : { data: filtered.slice(from, to + 1), error: null }),
          then: (resolve: any) => resolve(error ? { data: [], error } : { data: filtered, error: null })
        };
      }),
      eq: vi.fn((col, val) => {
        if (error) return { maybeSingle: () => Promise.resolve({ data: null, error }) };
        const filtered = rows.filter(r => r[col] === val);
        return {
          maybeSingle: () => Promise.resolve({ data: filtered[0] || null, error: null })
        };
      }),
      then: (resolve: any) => {
        if (error) resolve({ data: [], error });
        else resolve({ data: rows, error: null });
      }
    };
    return { select: () => chain };
  });

  return { mockTables: tables, mockErrors: errors, mockFrom: fromFn };
});

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({
  cache: (fn: any) => fn
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (t: string) => mockFrom(t)
  }
}));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: vi.fn(),
  getSupabaseServerClient: vi.fn()
}));

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(mockTables)) delete mockTables[key];
  for (const key of Object.keys(mockErrors)) delete mockErrors[key];

  const mockDb = { from: mockFrom };
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(mockDb as any);
  vi.mocked(getSupabaseServerClient).mockReturnValue(mockDb as any);
});

describe("CRM Scoped-Person Visibility via Memberships", () => {
  it("1. Matching program and season membership-only person is visible.", async () => {
    mockTables["person_season_memberships"] = [
      { person_id: "person-1", season_id: "s1", status: "active" }
    ];
    const scope = { allowedSeasonIds: ["s1"], allowedProgramIds: ["p1"] };
    const { personIds: ids } = await getScopedPersonIds(scope);
    expect(ids).toContain("person-1");
  });

  it("2. Wrong program is excluded.", async () => {
    // In our implementation, we match on allowedSeasonIds.
    // If a person is in season s2 (which belongs to a wrong program),
    // they won't be in allowedSeasonIds.
    mockTables["person_season_memberships"] = [
      { person_id: "person-1", season_id: "s2", status: "active" }
    ];
    const scope = { allowedSeasonIds: ["s1"], allowedProgramIds: ["p1"] };
    const { personIds: ids } = await getScopedPersonIds(scope);
    expect(ids).not.toContain("person-1");
  });

  it("3. Wrong season is excluded.", async () => {
    mockTables["person_season_memberships"] = [
      { person_id: "person-1", season_id: "s2", status: "active" }
    ];
    const scope = { allowedSeasonIds: ["s1"] };
    const { personIds: ids } = await getScopedPersonIds(scope);
    expect(ids).not.toContain("person-1");
  });

  it("4. Correct person loads through getPerson.", async () => {
    mockTables["person_season_memberships"] = [
      { person_id: "person-1", season_id: "s1", status: "active" }
    ];
    mockTables["people"] = [
      { id: "person-1", full_name: "Test Person" }
    ];
    const scope = { allowedSeasonIds: ["s1"] };
    const result = await getPerson("person-1", scope);
    expect(result.data?.id).toBe("person-1");
    expect(result.data?.full_name).toBe("Test Person");
  });

  it("5. Existing application/profile visibility remains unchanged.", async () => {
    mockTables["applications"] = [
      { person_id: "person-app", season_id: "s1" }
    ];
    const scope = { allowedSeasonIds: ["s1"] };
    const { personIds: ids } = await getScopedPersonIds(scope);
    expect(ids).toContain("person-app");
  });

  it("6. Duplicate IDs across membership and another source are returned once.", async () => {
    mockTables["person_season_memberships"] = [
      { person_id: "person-dup", season_id: "s1", status: "active" }
    ];
    mockTables["applications"] = [
      { person_id: "person-dup", season_id: "s1" }
    ];
    const scope = { allowedSeasonIds: ["s1"] };
    const { personIds: ids } = await getScopedPersonIds(scope);
    expect(ids?.filter(id => id === "person-dup").length).toBe(1);
  });

  it("7. Another intake batch in the same allowed season follows the existing season-level scope policy.", async () => {
    mockTables["intake_batches"] = [
      { id: "batch-1", season_id: "s1" }
    ];
    mockTables["mentor_profiles"] = [
      { person_id: "person-batch", intake_batch_id: "batch-1" }
    ];
    mockTables["person_season_memberships"] = [
      { person_id: "person-batch", season_id: "s1" }
    ];
    const scope = { allowedSeasonIds: ["s1"] };
    const { personIds: ids } = await getScopedPersonIds(scope);
    expect(ids).toContain("person-batch");
  });

  it("8. Lifecycle statuses follow the established CRM visibility policy; no invented active-only restriction.", async () => {
    mockTables["person_season_memberships"] = [
      { person_id: "person-paused", season_id: "s1", status: "paused" },
      { person_id: "person-withdrawn", season_id: "s1", status: "withdrawn" },
      { person_id: "person-invited", season_id: "s1", status: "invited" },
      { person_id: "person-cancelled", season_id: "s1", status: "cancelled" }
    ];
    const scope = { allowedSeasonIds: ["s1"] };
    const { personIds: ids } = await getScopedPersonIds(scope);
    expect(ids).toContain("person-paused");
    expect(ids).toContain("person-withdrawn");
    expect(ids).toContain("person-invited");
    expect(ids).toContain("person-cancelled");
  });

  it("9. Membership query failure does not broaden access.", async () => {
    mockTables["applications"] = [
      { person_id: "person-app", season_id: "s1" }
    ];
    mockTables["person_season_memberships"] = [
      { person_id: "person-membership", season_id: "s1", status: "active" }
    ];
    mockErrors["person_season_memberships"] = { message: "Simulated DB error" };
    const scope = { allowedSeasonIds: ["s1"] };
    const { personIds: ids, error } = await getScopedPersonIds(scope);

    // Scope evaluation failed, so it fails closed and reports rather than
    // continuing with a partial result as though the query had succeeded.
    expect(error).not.toBeNull();
    expect(ids).toEqual([]);
    expect(ids).not.toBeNull();
    expect(ids).not.toContain("person-membership");
    expect(ids).not.toContain("person-app");
  });

  it("10. UEHM scope cannot see HAM or another program.", async () => {
    mockTables["person_season_memberships"] = [
      { person_id: "person-ham", season_id: "s-ham", program_id: "p-ham" },
      { person_id: "person-uehm", season_id: "s-uehm", program_id: "p-uehm" }
    ];
    // UEHM admin has allowedSeasonIds strictly limited to UEHM seasons.
    const scope = { allowedSeasonIds: ["s-uehm"] };
    const { personIds: ids } = await getScopedPersonIds(scope);
    expect(ids).toContain("person-uehm");
    expect(ids).not.toContain("person-ham");
  });

  it("11. Unrestricted/global scope behavior remains unchanged.", async () => {
    // getScopedPersonIds returns `null` for global scope (!scope).
    const scope = undefined;
    const { personIds: ids } = await getScopedPersonIds(scope);
    expect(ids).toBeNull();
  });

  it("12. The generic membership-only scenario no longer returns the 'person not found' result.", async () => {
    mockTables["person_season_memberships"] = [
      { person_id: "person-1", season_id: "s1", status: "active" }
    ];
    mockTables["people"] = [
      { id: "person-1" }
    ];
    const scope = { allowedSeasonIds: ["s1"] };
    const result = await getPerson("person-1", scope);
    expect(result.data).not.toBeNull();
    expect(result.error).toBeNull();
  });
});
