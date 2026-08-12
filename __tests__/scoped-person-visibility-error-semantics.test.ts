import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createFakeDb, fakeClient } from "./support/fake-postgrest";
import { getScopedPersonIds, getPerson } from "@/lib/data";
import { getAllowedSeasonIds, type AdminScopeContext, type ProgramScope } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient, getSupabaseServerClient } from "@/lib/supabase-server";

const { holder, mockTables, mockErrors, mockFrom } = vi.hoisted(() => {
  const holder: { client: any } = { client: null };
  const tables: Record<string, any[]> = {};
  const errors: Record<string, any> = {};

  // Delegates to the shared faithful PostgREST fake (see
  // __tests__/support/fake-postgrest.ts): it enforces the silent db-max-rows
  // cap and returns an un-ORDERed read in an arbitrary order, so a loader that
  // pages without a deterministic key fails here instead of looking correct.
  const fromFn = vi.fn((table: string) => holder.client.from(table));

  return { holder, mockTables: tables, mockErrors: errors, mockFrom: fromFn };
});

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({
  cache: (fn: any) => fn
}));
vi.mock("@/lib/admin-auth", () => ({
  getCurrentAdminUser: vi.fn(async () => null)
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

let errorLog: ReturnType<typeof vi.spyOn>;

const fakeDb = createFakeDb();
holder.client = fakeClient(fakeDb);
Object.assign(fakeDb, { tables: mockTables, errors: mockErrors });

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(mockTables)) delete mockTables[key];
  for (const key of Object.keys(mockErrors)) delete mockErrors[key];
  fakeDb.requests.length = 0;

  const mockDb = { from: mockFrom };
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(mockDb as any);
  vi.mocked(getSupabaseServerClient).mockReturnValue(mockDb as any);
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorLog.mockRestore();
});

/** Every table `mockFrom` was asked for during the test. */
function queriedTables() {
  return mockFrom.mock.calls.map((call) => call[0]);
}

/** Flattened text of everything handed to console.error. */
function loggedText() {
  return errorLog.mock.calls.map((call) => call.map((part) => JSON.stringify(part) ?? String(part)).join(" ")).join("\n");
}

const MEMBERSHIP_FAILURE = { code: "57014", message: "canceling statement due to statement timeout" };

describe("Scoped-person visibility error semantics", () => {
  it("1. A membership query failure is reported through the canonical data error logger.", async () => {
    mockTables["person_season_memberships"] = [{ person_id: "person-1", season_id: "s1" }];
    mockErrors["person_season_memberships"] = MEMBERSHIP_FAILURE;

    await getScopedPersonIds({ allowedSeasonIds: ["s1"] });

    expect(errorLog).toHaveBeenCalled();
    const call = errorLog.mock.calls.find((entry) => entry[1] === "person_season_memberships.getScopedPersonIds");
    expect(call).toBeDefined();
    expect(call?.[0]).toBe("[data]");
    expect(call?.[2]).toMatchObject({ code: "57014", message: "canceling statement due to statement timeout" });
  });

  it("2. A membership query failure returns a non-null helper error.", async () => {
    mockErrors["person_season_memberships"] = MEMBERSHIP_FAILURE;

    const { error } = await getScopedPersonIds({ allowedSeasonIds: ["s1"] });

    expect(error).not.toBeNull();
    expect(typeof error).toBe("string");
    expect(error).toContain("person_season_memberships");
  });

  it("3. A membership query failure never returns null, which would mean unrestricted access.", async () => {
    mockTables["person_season_memberships"] = [{ person_id: "person-1", season_id: "s1" }];
    mockErrors["person_season_memberships"] = MEMBERSHIP_FAILURE;

    const { personIds } = await getScopedPersonIds({ allowedSeasonIds: ["s1"] });

    expect(personIds).not.toBeNull();
    expect(personIds).toEqual([]);
  });

  it("4. getPerson propagates the scope-query error.", async () => {
    mockTables["people"] = [{ id: "person-1", full_name: "Scoped Person" }];
    mockTables["person_season_memberships"] = [{ person_id: "person-1", season_id: "s1" }];
    mockErrors["person_season_memberships"] = MEMBERSHIP_FAILURE;

    const result = await getPerson("person-1", { allowedSeasonIds: ["s1"] });

    expect(result.error).not.toBeNull();
    expect(result.error).toContain("person_season_memberships");
  });

  it("5. getPerson does not convert a scope failure into an ordinary not-found result.", async () => {
    mockTables["people"] = [{ id: "person-1", full_name: "Scoped Person" }];
    mockErrors["person_season_memberships"] = MEMBERSHIP_FAILURE;

    const result = await getPerson("person-1", { allowedSeasonIds: ["s1"] });

    // The pre-remediation defect: indistinguishable from a genuine miss.
    expect(result).not.toEqual({ data: null, error: null });
    expect(result.data).toBeNull();
    expect(result.error).not.toBeNull();
  });

  it("6. The direct people query is not executed once scope evaluation has failed.", async () => {
    mockTables["people"] = [{ id: "person-1", full_name: "Scoped Person" }];
    mockErrors["person_season_memberships"] = MEMBERSHIP_FAILURE;

    await getPerson("person-1", { allowedSeasonIds: ["s1"] });

    expect(queriedTables()).not.toContain("people");
  });

  it("7. A matching membership-only person still loads normally when the query succeeds.", async () => {
    mockTables["person_season_memberships"] = [{ person_id: "person-1", season_id: "s1", status: "active" }];
    mockTables["people"] = [{ id: "person-1", full_name: "Membership Only" }];

    const { personIds, error } = await getScopedPersonIds({ allowedSeasonIds: ["s1"] });
    const result = await getPerson("person-1", { allowedSeasonIds: ["s1"] });

    expect(error).toBeNull();
    expect(personIds).toContain("person-1");
    expect(result.error).toBeNull();
    expect(result.data?.id).toBe("person-1");
  });

  it("8. A genuinely out-of-scope person still returns ordinary not-found with no database error.", async () => {
    mockTables["person_season_memberships"] = [{ person_id: "person-other", season_id: "s2", status: "active" }];
    mockTables["people"] = [{ id: "person-other", full_name: "Other Season" }];

    const result = await getPerson("person-other", { allowedSeasonIds: ["s1"] });

    expect(result).toEqual({ data: null, error: null });
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("9. A query failure reveals no person from any program.", async () => {
    mockTables["person_season_memberships"] = [
      { person_id: "person-uehm", season_id: "s-uehm" },
      { person_id: "person-ham", season_id: "s-ham" }
    ];
    mockErrors["person_season_memberships"] = MEMBERSHIP_FAILURE;

    const { personIds, error } = await getScopedPersonIds({ allowedSeasonIds: ["s-uehm"] });

    expect(error).not.toBeNull();
    expect(personIds).toEqual([]);
    expect(personIds).not.toContain("person-uehm");
    expect(personIds).not.toContain("person-ham");
  });

  it("10. Duplicate membership results remain deduplicated.", async () => {
    mockTables["person_season_memberships"] = [
      { person_id: "person-dup", season_id: "s1", role: "mentor" },
      { person_id: "person-dup", season_id: "s1", role: "mentee" }
    ];
    mockTables["applications"] = [{ person_id: "person-dup", season_id: "s1" }];

    const { personIds, error } = await getScopedPersonIds({ allowedSeasonIds: ["s1"] });

    expect(error).toBeNull();
    expect(personIds?.filter((id) => id === "person-dup")).toHaveLength(1);
  });

  it("11. Existing application and profile visibility is unchanged when nothing fails.", async () => {
    mockTables["applications"] = [{ person_id: "person-app", season_id: "s1" }];
    mockTables["intake_batches"] = [{ id: "batch-1", season_id: "s1" }];
    mockTables["mentor_profiles"] = [{ person_id: "person-profile", intake_batch_id: "batch-1" }];

    const { personIds, error } = await getScopedPersonIds({ allowedSeasonIds: ["s1"] });

    expect(error).toBeNull();
    expect(personIds).toContain("person-app");
    expect(personIds).toContain("person-profile");
  });

  it("12. Error logging carries no email, token, password or row payload.", async () => {
    mockTables["person_season_memberships"] = [
      {
        person_id: "person-1",
        season_id: "s1",
        email: "uehm.fixture@example.com",
        access_token: "tok_live_should_never_be_logged",
        password: "hunter2-should-never-be-logged",
        notes: "sensitive mentee note"
      }
    ];
    mockErrors["person_season_memberships"] = MEMBERSHIP_FAILURE;

    await getScopedPersonIds({ allowedSeasonIds: ["s1"] });

    const logged = loggedText();
    expect(logged).toContain("person_season_memberships.getScopedPersonIds");
    expect(logged).not.toContain("uehm.fixture@example.com");
    expect(logged).not.toContain("tok_live_should_never_be_logged");
    expect(logged).not.toContain("hunter2-should-never-be-logged");
    expect(logged).not.toContain("sensitive mentee note");
    expect(logged).not.toContain("person-1");
  });

  it("13. The user-facing scope error exposes no raw database text.", async () => {
    mockErrors["person_season_memberships"] = MEMBERSHIP_FAILURE;

    const { error } = await getScopedPersonIds({ allowedSeasonIds: ["s1"] });

    expect(error).not.toContain("canceling statement due to statement timeout");
    expect(error).not.toContain("57014");
  });
});

function scopeContext(programScopes: ProgramScope[]): AdminScopeContext {
  return {
    adminUser: null,
    authUserId: "auth-user-1",
    globalRole: "admin",
    isSuperAdmin: false,
    programScopes,
    scopeError: null
  };
}

function grant(partial: Partial<ProgramScope>): ProgramScope {
  return { programId: null, seasonId: null, scopeLevel: "read", status: "active", ...partial };
}

/**
 * Both programs run a season whose human-readable code is the identical string
 * "2026". Only the canonical UUIDs and the season -> program binding separate
 * them, which is exactly what these tests exercise.
 */
function seedTwoProgramsWithCollidingSeasonCodes() {
  mockTables["programs"] = [
    { id: "11111111-1111-4111-8111-111111111111", code: "UEHM", name: "UEHM" },
    { id: "22222222-2222-4222-8222-222222222222", code: "HAM", name: "HAM" }
  ];
  mockTables["seasons"] = [
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", code: "2026", name: "UEHM 2026", program_id: "11111111-1111-4111-8111-111111111111" },
    { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", code: "2026", name: "HAM 2026", program_id: "22222222-2222-4222-8222-222222222222" }
  ];
  mockTables["person_season_memberships"] = [
    { person_id: "person-uehm", season_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    { person_id: "person-ham", season_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }
  ];
}

const UEHM_PROGRAM = "11111111-1111-4111-8111-111111111111";
const HAM_PROGRAM = "22222222-2222-4222-8222-222222222222";
const UEHM_SEASON = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HAM_SEASON = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("Cross-program isolation of membership visibility", () => {
  it("A. A UEHM-granted scope cannot return a HAM membership person.", async () => {
    seedTwoProgramsWithCollidingSeasonCodes();
    const allowedSeasonIds = await getAllowedSeasonIds(scopeContext([grant({ programId: UEHM_PROGRAM })]));

    // The program grant resolves to that program's season only.
    expect(allowedSeasonIds).toEqual([UEHM_SEASON]);

    const { personIds, error } = await getScopedPersonIds({ allowedSeasonIds, allowedProgramIds: [UEHM_PROGRAM] });

    expect(error).toBeNull();
    expect(personIds).toContain("person-uehm");
    expect(personIds).not.toContain("person-ham");
  });

  it("B. The mirrored HAM grant is equally confined, so neither program is special-cased.", async () => {
    seedTwoProgramsWithCollidingSeasonCodes();
    const allowedSeasonIds = await getAllowedSeasonIds(scopeContext([grant({ programId: HAM_PROGRAM })]));

    expect(allowedSeasonIds).toEqual([HAM_SEASON]);

    const { personIds } = await getScopedPersonIds({ allowedSeasonIds, allowedProgramIds: [HAM_PROGRAM] });

    expect(personIds).toContain("person-ham");
    expect(personIds).not.toContain("person-uehm");
  });

  it("C. Identical season codes across programs do not merge: a program grant never yields both seasons.", async () => {
    seedTwoProgramsWithCollidingSeasonCodes();

    const uehm = await getAllowedSeasonIds(scopeContext([grant({ programId: UEHM_PROGRAM })]));
    const ham = await getAllowedSeasonIds(scopeContext([grant({ programId: HAM_PROGRAM })]));

    expect(uehm).toHaveLength(1);
    expect(ham).toHaveLength(1);
    expect(uehm).not.toContain(HAM_SEASON);
    expect(ham).not.toContain(UEHM_SEASON);
    // The shared code "2026" is never itself treated as an allowed season id.
    expect(uehm).not.toContain("2026");
    expect(ham).not.toContain("2026");
  });

  it("D. A canonical season-id grant is unambiguous even when the season codes collide.", async () => {
    seedTwoProgramsWithCollidingSeasonCodes();
    const allowedSeasonIds = await getAllowedSeasonIds(scopeContext([grant({ seasonId: UEHM_SEASON })]));

    expect(allowedSeasonIds).toEqual([UEHM_SEASON]);

    const { personIds } = await getScopedPersonIds({ allowedSeasonIds });

    expect(personIds).toEqual(["person-uehm"]);
  });

  it("E. Substituting an unauthorized season id yields the other program's person, so the binding is load-bearing.", async () => {
    seedTwoProgramsWithCollidingSeasonCodes();

    // Mutation guard: if season filtering were dropped or the wrong season id
    // substituted, test A's assertions would invert exactly like this.
    const { personIds } = await getScopedPersonIds({ allowedSeasonIds: [HAM_SEASON], allowedProgramIds: [UEHM_PROGRAM] });

    expect(personIds).toContain("person-ham");
    expect(personIds).not.toContain("person-uehm");
  });

  it("F. A code-based season grant resolves to at most one season and never unions both programs.", async () => {
    seedTwoProgramsWithCollidingSeasonCodes();
    // admin_scope_access.season_id is `text`, so a grant may carry a code.
    const allowedSeasonIds = await getAllowedSeasonIds(scopeContext([grant({ seasonId: "2026" })]));

    // Which of the two colliding codes wins is resolution-order dependent and is
    // reported separately; what must hold here is that access never widens to both.
    expect(allowedSeasonIds).toHaveLength(1);
    expect([UEHM_SEASON, HAM_SEASON]).toContain(allowedSeasonIds[0]);

    const { personIds } = await getScopedPersonIds({ allowedSeasonIds });

    expect(personIds).toHaveLength(1);
    expect(personIds).not.toEqual(expect.arrayContaining(["person-uehm", "person-ham"]));
  });
});
