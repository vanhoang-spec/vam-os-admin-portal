import { readFileSync } from "node:fs";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getScopedPersonIds, getPerson, getMentorProfiles, getMenteeProfiles } from "@/lib/data";
import { getSupabaseServiceRoleClient, getSupabaseServerClient } from "@/lib/supabase-server";

const { mockTables, mockErrors, mockFrom, mockSupabaseState } = vi.hoisted(() => {
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
        const filtered = rows.filter((r) => r[col] === val);
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

  const supabaseState = { client: { from: fromFn } as any };

  return { mockTables: tables, mockErrors: errors, mockFrom: fromFn, mockSupabaseState: supabaseState };
});

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({
  cache: (fn: any) => fn
}));
vi.mock("@/lib/admin-auth", () => ({
  getCurrentAdminUser: vi.fn(async () => null)
}));
vi.mock("@/lib/supabase", () => ({
  get supabase() { return mockSupabaseState.client; }
}));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: vi.fn(),
  getSupabaseServerClient: vi.fn()
}));

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(mockTables)) delete mockTables[key];
  for (const key of Object.keys(mockErrors)) delete mockErrors[key];

  const mockDb = { from: mockFrom };
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(mockDb as any);
  vi.mocked(getSupabaseServerClient).mockReturnValue(mockDb as any);
  mockSupabaseState.client = mockDb as any;
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorLog.mockRestore();
});

/** Every table `mockFrom` was asked for during the test, in call order. */
function queriedTables() {
  return mockFrom.mock.calls.map((call) => call[0]);
}

function timesQueried(table: string) {
  return queriedTables().filter((name) => name === table).length;
}

/** Flattened text of everything handed to console.error. */
function loggedText() {
  return errorLog.mock.calls.map((call) => call.map((part) => JSON.stringify(part) ?? String(part)).join(" ")).join("\n");
}

const BATCH_FAILURE = { code: "57014", message: "canceling statement due to statement timeout" };

/**
 * The three person-visibility sources filtered by intake batch IDs. If the batch
 * list cannot be resolved, none of them may run and none may contribute.
 */
const BATCH_DEPENDENT_SOURCES = ["mentor_profiles", "mentee_profiles", "applications"] as const;

/** A scope whose people are reachable through the season sources as well. */
function seedSeasonVisiblePeople() {
  mockTables["person_season_memberships"] = [{ person_id: "person-membership", season_id: "s1", status: "active" }];
  mockTables["applications"] = [{ person_id: "person-app", season_id: "s1" }];
}

describe("Intake-batch scope failure error semantics", () => {
  it("1. An intake_batches query failure is reported through the canonical data error logger.", async () => {
    mockTables["intake_batches"] = [{ id: "batch-1", season_id: "s1" }];
    mockErrors["intake_batches"] = BATCH_FAILURE;

    await getScopedPersonIds({ allowedSeasonIds: ["s1"] });

    const call = errorLog.mock.calls.find((entry) => entry[1] === "intake_batches.getScopedIntakeBatchIds");
    expect(call).toBeDefined();
    expect(call?.[0]).toBe("[data]");
    expect(call?.[2]).toMatchObject({ code: "57014", message: "canceling statement due to statement timeout" });
  });

  it("2. The log names intake_batches and the helper, and carries no PII or secrets.", async () => {
    mockTables["intake_batches"] = [
      {
        id: "batch-1",
        season_id: "s1",
        owner_email: "uehm.fixture@example.com",
        access_token: "tok_live_should_never_be_logged",
        password: "hunter2-should-never-be-logged",
        notes: "sensitive batch note"
      }
    ];
    mockErrors["intake_batches"] = BATCH_FAILURE;

    await getScopedPersonIds({ allowedSeasonIds: ["s1"] });

    const logged = loggedText();
    expect(logged).toContain("intake_batches");
    expect(logged).toContain("getScopedIntakeBatchIds");
    expect(logged).not.toContain("uehm.fixture@example.com");
    expect(logged).not.toContain("tok_live_should_never_be_logged");
    expect(logged).not.toContain("hunter2-should-never-be-logged");
    expect(logged).not.toContain("sensitive batch note");
    expect(logged).not.toContain("batch-1");
  });

  it("3. An intake_batches failure returns a non-null typed error from getScopedPersonIds.", async () => {
    mockErrors["intake_batches"] = BATCH_FAILURE;

    const { error } = await getScopedPersonIds({ allowedSeasonIds: ["s1"] });

    expect(error).not.toBeNull();
    expect(typeof error).toBe("string");
    expect(error).toContain("intake_batches");
  });

  it("4. An intake_batches failure is never interpretable as unrestricted scope.", async () => {
    seedSeasonVisiblePeople();
    mockErrors["intake_batches"] = BATCH_FAILURE;

    const { personIds } = await getScopedPersonIds({ allowedSeasonIds: ["s1"] });

    // `null` is the unrestricted sentinel and must never come from a failure.
    expect(personIds).not.toBeNull();
    expect(personIds).toEqual([]);
  });

  it("5. An intake_batches failure is distinguishable from a legitimately empty batch list.", async () => {
    mockTables["intake_batches"] = [{ id: "batch-other", season_id: "s-other" }];
    const legitimate = await getScopedPersonIds({ allowedSeasonIds: ["s1"] });

    mockErrors["intake_batches"] = BATCH_FAILURE;
    const failed = await getScopedPersonIds({ allowedSeasonIds: ["s1"] });

    // Same empty person set, opposite meaning — only `error` separates them.
    expect(legitimate.error).toBeNull();
    expect(failed.error).not.toBeNull();
    expect(legitimate).not.toEqual(failed);
  });

  it("6. The three batch-dependent visibility queries do not execute after an intake-batch failure.", async () => {
    mockTables["mentor_profiles"] = [{ person_id: "person-mentor", intake_batch_id: "batch-1" }];
    mockTables["mentee_profiles"] = [{ person_id: "person-mentee", intake_batch_id: "batch-1" }];
    mockErrors["intake_batches"] = BATCH_FAILURE;

    await getScopedPersonIds({ allowedSeasonIds: ["s1"] });

    expect(queriedTables()).not.toContain("mentor_profiles");
    expect(queriedTables()).not.toContain("mentee_profiles");
    // `applications` is also a season source, so it runs exactly once — for the
    // season pass — and never again for the batch pass.
    expect(timesQueried("applications")).toBe(1);
  });

  it("7. No partial person-ID union survives an intake-batch failure.", async () => {
    seedSeasonVisiblePeople();
    mockTables["matches"] = [{ mentor_person_id: "person-mentor", mentee_person_id: "person-mentee", season_id: "s1" }];
    mockErrors["intake_batches"] = BATCH_FAILURE;

    const { personIds, error } = await getScopedPersonIds({ allowedSeasonIds: ["s1"] });

    expect(error).not.toBeNull();
    expect(personIds).toEqual([]);
    // The season sources succeeded, but their IDs must not be returned as though
    // the scope had been fully evaluated.
    expect(personIds).not.toContain("person-membership");
    expect(personIds).not.toContain("person-app");
    expect(personIds).not.toContain("person-mentor");
  });

  it("8. getPerson propagates the intake-batch error and never queries people.", async () => {
    mockTables["people"] = [{ id: "person-membership", full_name: "Scoped Person" }];
    seedSeasonVisiblePeople();
    mockErrors["intake_batches"] = BATCH_FAILURE;

    const result = await getPerson("person-membership", { allowedSeasonIds: ["s1"] });

    expect(result.data).toBeNull();
    expect(result.error).not.toBeNull();
    expect(result.error).toContain("intake_batches");
    expect(result).not.toEqual({ data: null, error: null });
    expect(queriedTables()).not.toContain("people");
  });

  it("9. The person page routes this error to its operational branch, not ordinary not-found.", async () => {
    seedSeasonVisiblePeople();
    mockErrors["intake_batches"] = BATCH_FAILURE;

    const person = await getPerson("person-membership", { allowedSeasonIds: ["s1"] });

    // This is exactly the value the page branches on.
    const personLookupFailed = Boolean(person.error);
    expect(person.data).toBeNull();
    expect(personLookupFailed).toBe(true);

    const page = readFileSync("app/people/[id]/page.tsx", "utf8");
    expect(page).toContain("const personLookupFailed = Boolean(person.error);");
    // The ordinary not-found copy is reachable only on the false branch.
    expect(page).toMatch(/personLookupFailed[\s\S]*?Không tìm thấy person_id này trong bảng people\./);
  });

  it("10. A legitimate zero-batch scope stays a successful scoped result.", async () => {
    seedSeasonVisiblePeople();
    mockTables["intake_batches"] = [{ id: "batch-other", season_id: "s-other" }];

    const { personIds, error } = await getScopedPersonIds({ allowedSeasonIds: ["s1"] });

    expect(error).toBeNull();
    expect(personIds).toContain("person-membership");
    expect(personIds).toContain("person-app");
  });

  it("11. Valid matching intake batches still feed all three dependent sources.", async () => {
    mockTables["intake_batches"] = [{ id: "batch-1", season_id: "s1" }];
    mockTables["mentor_profiles"] = [{ person_id: "person-mentor", intake_batch_id: "batch-1" }];
    mockTables["mentee_profiles"] = [{ person_id: "person-mentee", intake_batch_id: "batch-1" }];
    mockTables["applications"] = [{ person_id: "person-batch-app", intake_batch_id: "batch-1" }];

    const { personIds, error } = await getScopedPersonIds({ allowedSeasonIds: ["s1"] });

    expect(error).toBeNull();
    for (const source of BATCH_DEPENDENT_SOURCES) {
      expect(queriedTables()).toContain(source);
    }
    expect(personIds).toContain("person-mentor");
    expect(personIds).toContain("person-mentee");
    expect(personIds).toContain("person-batch-app");
  });

  it("12. Wrong-season intake batches and their people remain excluded.", async () => {
    mockTables["intake_batches"] = [
      { id: "batch-s1", season_id: "s1" },
      { id: "batch-s2", season_id: "s2" }
    ];
    mockTables["mentor_profiles"] = [
      { person_id: "person-in", intake_batch_id: "batch-s1" },
      { person_id: "person-out", intake_batch_id: "batch-s2" }
    ];

    const { personIds, error } = await getScopedPersonIds({ allowedSeasonIds: ["s1"] });

    expect(error).toBeNull();
    expect(personIds).toContain("person-in");
    expect(personIds).not.toContain("person-out");
  });

  it("13. A UEHM scope cannot consume HAM intake batches.", async () => {
    mockTables["intake_batches"] = [
      { id: "batch-uehm", season_id: "s-uehm" },
      { id: "batch-ham", season_id: "s-ham" }
    ];
    mockTables["mentee_profiles"] = [
      { person_id: "person-uehm", intake_batch_id: "batch-uehm" },
      { person_id: "person-ham", intake_batch_id: "batch-ham" }
    ];

    const { personIds } = await getScopedPersonIds({ allowedSeasonIds: ["s-uehm"] });

    expect(personIds).toContain("person-uehm");
    expect(personIds).not.toContain("person-ham");
  });

  it("14. Identical human-readable batch and season codes never override canonical ID scoping.", async () => {
    // Both programs run a batch whose code is the identical string "B1", inside
    // seasons whose codes are both "2026". Only the UUIDs separate them.
    mockTables["intake_batches"] = [
      { id: "11111111-1111-4111-8111-111111111111", season_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", code: "B1" },
      { id: "22222222-2222-4222-8222-222222222222", season_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", code: "B1" }
    ];
    mockTables["mentor_profiles"] = [
      { person_id: "person-uehm", intake_batch_id: "11111111-1111-4111-8111-111111111111" },
      { person_id: "person-ham", intake_batch_id: "22222222-2222-4222-8222-222222222222" }
    ];

    const { personIds } = await getScopedPersonIds({ allowedSeasonIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"] });

    expect(personIds).toEqual(["person-uehm"]);
    // The shared code is never itself treated as a batch or season identifier.
    expect(personIds).not.toContain("person-ham");
    expect(personIds).not.toContain("B1");
  });

  it("15. Unrestricted/global scope behaviour is unchanged.", async () => {
    mockErrors["intake_batches"] = BATCH_FAILURE;

    const { personIds, error } = await getScopedPersonIds(undefined);

    expect(personIds).toBeNull();
    expect(error).toBeNull();
    expect(queriedTables()).not.toContain("intake_batches");
  });

  it("16. Membership-only visibility keeps working when intake_batches succeeds.", async () => {
    mockTables["person_season_memberships"] = [{ person_id: "person-membership", season_id: "s1", status: "active" }];
    mockTables["people"] = [{ id: "person-membership", full_name: "Membership Only" }];
    mockTables["intake_batches"] = [];

    const result = await getPerson("person-membership", { allowedSeasonIds: ["s1"] });

    expect(result.error).toBeNull();
    expect(result.data?.id).toBe("person-membership");
  });

  it("17. One intake-batch failure produces exactly one log entry and one error.", async () => {
    seedSeasonVisiblePeople();
    mockErrors["intake_batches"] = BATCH_FAILURE;

    const { error } = await getScopedPersonIds({ allowedSeasonIds: ["s1"] });

    const batchLogs = errorLog.mock.calls.filter((entry) => String(entry[1]).includes("intake_batches"));
    expect(batchLogs).toHaveLength(1);
    // One failure, one log, one user-facing message — no second error from a
    // downstream layer re-reporting the same fault.
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(error).toBe(`Không xác minh được phạm vi truy cập. Vui lòng thử lại hoặc liên hệ quản trị viên. (intake_batches)`);
  });

  it("18. The user-facing intake-batch error exposes no raw database text.", async () => {
    mockErrors["intake_batches"] = BATCH_FAILURE;

    const { error } = await getScopedPersonIds({ allowedSeasonIds: ["s1"] });

    expect(error).not.toContain("canceling statement due to statement timeout");
    expect(error).not.toContain("57014");
  });

  it("19. The season-less scope path reports its intake_batches failure too.", async () => {
    // No allowedSeasonIds, so the helper takes the unfiltered select branch.
    mockErrors["intake_batches"] = BATCH_FAILURE;

    const { personIds, error } = await getScopedPersonIds({ allowedProgramIds: ["p1"] });

    expect(error).not.toBeNull();
    expect(personIds).toEqual([]);
    expect(queriedTables()).not.toContain("mentor_profiles");
  });
});

describe("Batch-dependent profile loaders fail closed on an intake-batch error", () => {
  it("20. getMentorProfiles reports the scope error instead of a short profile list.", async () => {
    mockTables["person_season_memberships"] = [{ person_id: "person-membership", season_id: "s1", status: "active" }];
    mockTables["mentor_profiles"] = [{ person_id: "person-membership", intake_batch_id: "batch-1" }];
    mockErrors["intake_batches"] = BATCH_FAILURE;

    const result = await getMentorProfiles({ allowedSeasonIds: ["s1"] });

    expect(result.error).not.toBeNull();
    expect(result.error).toContain("intake_batches");
    expect(result.data).toEqual([]);
  });

  it("21. getMenteeProfiles reports the scope error instead of a short profile list.", async () => {
    mockTables["person_season_memberships"] = [{ person_id: "person-membership", season_id: "s1", status: "active" }];
    mockTables["mentee_profiles"] = [{ person_id: "person-membership", intake_batch_id: "batch-1" }];
    mockErrors["intake_batches"] = BATCH_FAILURE;

    const result = await getMenteeProfiles({ allowedSeasonIds: ["s1"] });

    expect(result.error).not.toBeNull();
    expect(result.error).toContain("intake_batches");
    expect(result.data).toEqual([]);
  });
});

describe("The removed partial-result behaviour stays removed", () => {
  it("22. Restoring `error -> []` in getScopedIntakeBatchIds cannot pass this suite.", async () => {
    seedSeasonVisiblePeople();
    mockErrors["intake_batches"] = BATCH_FAILURE;

    const { personIds, error } = await getScopedPersonIds({ allowedSeasonIds: ["s1"] });

    // The old behaviour returned an empty batch list with no error, which left
    // the season-derived IDs in place and reported success. Both halves of that
    // outcome are asserted against here.
    expect(error).not.toBeNull();
    expect(personIds).toEqual([]);

    const source = readFileSync("lib/data.ts", "utf8");
    const helper = source.slice(source.indexOf("async function getScopedIntakeBatchIds"));
    const body = helper.slice(0, helper.indexOf("\n}\n"));
    expect(body).toContain("scopeBatchError(\"intake_batches\")");
    expect(body).not.toContain("logDataError(\"intake_batches.scope\"");
  });
});

describe("Missing Supabase client error semantics", () => {
  function simulateMissingClient() {
    mockSupabaseState.client = null;
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(null);
    vi.mocked(getSupabaseServerClient).mockReturnValue(null);
  }

  it("23. Restricted scope + missing client returns a non-null canonical safe environment-error.", async () => {
    simulateMissingClient();
    // Use allowedProgramIds to bypass the season-based tables (which would fail early on the server-only applications table)
    // and hit getScopedIntakeBatchIds directly.
    const { error } = await getScopedPersonIds({ allowedProgramIds: ["p1"] });
    expect(error).toBe("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc NEXT_PUBLIC_SUPABASE_ANON_KEY trong .env.local.");
  });

  it("24. Missing client cannot be interpreted as unrestricted access.", async () => {
    simulateMissingClient();
    const { personIds } = await getScopedPersonIds({ allowedProgramIds: ["p1"] });
    expect(personIds).not.toBeNull();
    expect(personIds).toEqual([]);
  });

  it("25. Missing client cannot be interpreted as legitimate zero intake batches.", async () => {
    const legitimate = await getScopedPersonIds({ allowedProgramIds: ["p1"] });

    simulateMissingClient();
    const failed = await getScopedPersonIds({ allowedProgramIds: ["p1"] });

    expect(legitimate.error).toBeNull();
    expect(failed.error).not.toBeNull();
  });

  it("26. getScopedPersonIds() returns no partial person IDs.", async () => {
    simulateMissingClient();
    const { personIds, error } = await getScopedPersonIds({ allowedProgramIds: ["p1"] });
    expect(personIds).toEqual([]);
    expect(error).not.toBeNull();
  });

  it("27. Mentor-profile, mentee-profile and application queries do not run.", async () => {
    simulateMissingClient();
    await getScopedPersonIds({ allowedProgramIds: ["p1"] });
    expect(queriedTables()).toEqual([]);
  });

  it("28. getPerson() does not query people and receives operational error.", async () => {
    simulateMissingClient();
    const result = await getPerson("person-membership", { allowedProgramIds: ["p1"] });
    expect(result.data).toBeNull();
    expect(result.error).not.toBeNull();
    expect(queriedTables()).not.toContain("people");
  });

  it("29. getMentorProfiles() propagates the error.", async () => {
    simulateMissingClient();
    const result = await getMentorProfiles({ allowedProgramIds: ["p1"] });
    expect(result.error).not.toBeNull();
    expect(result.data).toEqual([]);
  });

  it("30. getMenteeProfiles() propagates the error.", async () => {
    simulateMissingClient();
    const result = await getMenteeProfiles({ allowedProgramIds: ["p1"] });
    expect(result.error).not.toBeNull();
    expect(result.data).toEqual([]);
  });

  it("31. Unrestricted scope behavior remains unchanged.", async () => {
    simulateMissingClient();
    const { personIds, error } = await getScopedPersonIds(undefined);
    expect(personIds).toBeNull();
    expect(error).toBeNull();
  });

  it("32. No environment value or secret appears in returned errors or logs.", async () => {
    simulateMissingClient();
    const { error } = await getScopedPersonIds({ allowedProgramIds: ["p1"] });
    expect(error).not.toContain("http");
    expect(error).not.toContain("sb_");
    expect(error).not.toContain("eyJ");
    // Module convention is to just return envError without double logging it in scope evaluation.
    expect(errorLog).toHaveBeenCalledTimes(0);
  });
});
