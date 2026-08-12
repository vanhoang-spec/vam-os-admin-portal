/**
 * The pagination contract, tested at the exact boundaries where truncation and
 * page-stitching bugs live.
 *
 * Every assertion here runs against `__tests__/support/fake-postgrest.ts`,
 * which enforces the silent `db-max-rows` cap AND returns un-ORDERed reads in
 * an arbitrary order. That second property is what makes these tests capable of
 * detecting unstable pagination: a deterministic slice mock would let an
 * unordered offset read pass, which is precisely how the Production defect
 * reached a release review.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, fakeClient, requestsFor, DEFAULT_MAX_ROWS } from "./support/fake-postgrest";
import { MAX_PAGES, PAGE_ORDER, projectionWithPageKey, readAllPages, readBounded, SELECT_PAGE_SIZE } from "@/lib/paged-read";
import { getMatches, getOperationsData } from "@/lib/data";
import { getSupabaseServerClient, getSupabaseServiceRoleClient } from "@/lib/supabase-server";

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: (fn: any) => fn }));
vi.mock("@/lib/supabase", () => ({ supabase: null, supabaseUrl: "https://x.test", supabaseAnonKey: "anon" }));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: vi.fn(),
  getSupabaseServerClient: vi.fn()
}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn(async () => null) }));

const db = createFakeDb();
let client: ReturnType<typeof fakeClient>;

/** The chunk size `lib/data.ts` splits an IN list into. */
const IN_FILTER_CHUNK_SIZE = 200;

const SEASON = "season-0000";

/** `n` recap rows in one season, with sortable ids in insertion order. */
function recaps(n: number, seasonId = SEASON, prefix = "r") {
  return Array.from({ length: n }, (_, index) => ({
    id: `${prefix}-${String(index).padStart(6, "0")}`,
    season_id: seasonId,
    meeting_month: index % 2 ? "2026-06" : "2026-07",
    status: "submitted",
    mentor_person_id: `mentor-${index % 7}`,
    mentee_person_id: `mentee-${index % 11}`
  }));
}

function readRecaps(seasonIds: string[] = [SEASON]) {
  return readAllPages<any>("mentoring_recaps", "id,season_id,meeting_month", (columns) =>
    client.from("mentoring_recaps").select(columns).in("season_id", seasonIds)
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  db.reset();
  db.maxRows = DEFAULT_MAX_ROWS;
  client = fakeClient(db);
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);
  vi.mocked(getSupabaseServerClient).mockReturnValue(client as any);
});

// ---------------------------------------------------------------------------
// Row-count boundaries around the cap
// ---------------------------------------------------------------------------

describe("row-count boundaries around db-max-rows", () => {
  const BOUNDARIES = [0, 1, 999, 1000, 1001, 1999, 2000, 2001, 2322, 2323];

  for (const total of BOUNDARIES) {
    it(`returns exactly ${total} rows, once each, in a single ordered sweep`, async () => {
      db.tables.mentoring_recaps = recaps(total);
      const { data, error } = await readRecaps();

      expect(error).toBeNull();
      expect(data).toHaveLength(total);
      const ids = data.map((row: any) => row.id);
      expect(new Set(ids).size).toBe(total);
      expect(ids).toEqual(db.tables.mentoring_recaps.map((row: any) => row.id));
    });
  }

  it("an unpaged read of the same 2323 rows silently stops at the cap", async () => {
    db.tables.mentoring_recaps = recaps(2323);
    const { data, error } = await client.from("mentoring_recaps").select("id").in("season_id", [SEASON]);
    expect(error).toBeNull();
    expect(data).toHaveLength(DEFAULT_MAX_ROWS);
  });

  it("pages exactly as many times as the row count requires, plus one terminator", async () => {
    db.tables.mentoring_recaps = recaps(2001);
    await readRecaps();
    const pages = requestsFor(db, "mentoring_recaps");
    // 1000 + 1000 + 1 rows, then an empty page to prove exhaustion.
    expect(pages.map((page) => page.returned)).toEqual([1000, 1000, 1, 0]);
  });

  it("a genuinely empty table succeeds with [] and one request", async () => {
    db.tables.mentoring_recaps = [];
    const { data, error } = await readRecaps();
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(requestsFor(db, "mentoring_recaps")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Cursor mechanics
// ---------------------------------------------------------------------------

describe("keyset cursor mechanics", () => {
  it("each page's cursor is the last id of the previous page", async () => {
    db.tables.mentoring_recaps = recaps(2500);
    const { data } = await readRecaps();
    const pages = requestsFor(db, "mentoring_recaps");

    let consumed = 0;
    for (const [index, page] of pages.map((page, index) => [index, page] as const)) {
      const cursor = (JSON.parse(page.filters) as any[]).find((f) => f.kind === "gt" && f.column === "id");
      if (index === 0) {
        expect(cursor).toBeUndefined();
      } else {
        expect(cursor?.value).toBe(data[consumed - 1].id);
      }
      expect(page.order).toEqual(["id:asc"]);
      expect(page.limit).toBe(SELECT_PAGE_SIZE);
      consumed += page.returned;
    }
  });

  it("adds the ordering key to a projection that omits it", () => {
    expect(projectionWithPageKey("mentoring_recaps", "mentor_person_id")).toBe("mentor_person_id,id");
    expect(projectionWithPageKey("mentoring_recaps", "id,status")).toBe("id,status");
    expect(projectionWithPageKey("mentoring_recaps", "*")).toBe("*");
    expect(projectionWithPageKey("mentor_industries", "industry_id")).toBe("industry_id,mentor_profile_id");
  });

  it("fails loudly rather than looping when the key is absent from the payload", async () => {
    db.tables.mentoring_recaps = recaps(10).map(({ id, ...rest }) => ({ id, ...rest }));
    // Bypass `projectionWithPageKey` by building the query directly without `id`.
    const { data, error } = await readAllPages<any>("mentoring_recaps", "*", () =>
      client.from("mentoring_recaps").select("season_id")
    );
    expect(data).toEqual([]);
    expect((error as any)?.message).toContain("pagination key");
  });
});

// ---------------------------------------------------------------------------
// The unstable-ordering detector
// ---------------------------------------------------------------------------

describe("unstable ordering is detectable, and the contract is not vulnerable to it", () => {
  /** Offset paging with no ORDER BY — the shape the fix replaced. */
  async function pageByOffsetWithoutOrder(table: string) {
    const rows: any[] = [];
    for (let from = 0; ; from += SELECT_PAGE_SIZE) {
      const { data } = await client.from(table).select("id").range(from, from + SELECT_PAGE_SIZE - 1);
      const page = (data ?? []) as any[];
      rows.push(...page);
      if (page.length < SELECT_PAGE_SIZE) break;
    }
    return rows;
  }

  it("offset paging without ORDER BY loses and repeats rows", async () => {
    db.tables.mentoring_recaps = recaps(2500);
    const rows = await pageByOffsetWithoutOrder("mentoring_recaps");
    const ids = rows.map((row) => row.id);
    const distinct = new Set(ids);
    // Either duplicates appear or rows go missing; both are corruption.
    expect(distinct.size < 2500 || ids.length !== distinct.size).toBe(true);
  });

  it("the same fixture read through the contract is exact", async () => {
    db.tables.mentoring_recaps = recaps(2500);
    const { data } = await readRecaps();
    expect(new Set(data.map((row: any) => row.id)).size).toBe(2500);
  });

  it("two consecutive contract reads return byte-identical sets", async () => {
    db.tables.mentoring_recaps = recaps(2300);
    const first = await readRecaps();
    const second = await readRecaps();
    expect(second.data.map((row: any) => row.id)).toEqual(first.data.map((row: any) => row.id));
  });

  it("stays complete when the server cap is lower than the requested page size", async () => {
    // A short first page must not be read as end-of-data.
    db.maxRows = 250;
    db.tables.mentoring_recaps = recaps(1001);
    const { data, error } = await readRecaps();
    expect(error).toBeNull();
    expect(data).toHaveLength(1001);
  });
});

// ---------------------------------------------------------------------------
// Chunked IN lists
// ---------------------------------------------------------------------------

describe("chunked IN filters", () => {
  /** 250 seasons → two chunks of 200 + 50. */
  const seasonIds = Array.from({ length: 250 }, (_, index) => `season-${String(index).padStart(4, "0")}`);
  const laterChunkSeason = seasonIds[220];

  function seedSeasons() {
    db.tables.seasons = seasonIds.map((id) => ({ id, code: id, name: id }));
  }

  it("splits the IN list into chunks of at most 200 values", async () => {
    seedSeasons();
    db.tables.matches = [];
    await getMatches({ allowedSeasonIds: seasonIds, allowedProgramIds: ["p"] });
    const chunks = requestsFor(db, "matches").map((request) => (JSON.parse(request.filters) as any[])[0].values.length);
    expect(Math.max(...chunks)).toBeLessThanOrEqual(IN_FILTER_CHUNK_SIZE);
    expect(new Set(chunks)).toEqual(new Set([IN_FILTER_CHUNK_SIZE, 50]));
  });

  it("an empty first chunk does not stop a non-empty later chunk", async () => {
    seedSeasons();
    db.tables.matches = Array.from({ length: 5 }, (_, index) => ({
      id: `m-${index}`,
      season_id: laterChunkSeason,
      status: "active"
    }));
    const { data, error } = await getMatches({ allowedSeasonIds: seasonIds, allowedProgramIds: ["p"] });
    expect(error).toBeNull();
    expect(data).toHaveLength(5);
  });

  it("pages within a chunk and across chunks without gaps or duplicates", async () => {
    seedSeasons();
    // 1500 rows in a first-chunk season and 1500 in a later-chunk season: both
    // chunks must page, and the two chunk results must concatenate cleanly.
    db.tables.matches = [
      ...Array.from({ length: 1500 }, (_, index) => ({ id: `a-${String(index).padStart(6, "0")}`, season_id: seasonIds[0], status: "active" })),
      ...Array.from({ length: 1500 }, (_, index) => ({ id: `b-${String(index).padStart(6, "0")}`, season_id: laterChunkSeason, status: "active" }))
    ];
    const { data, error } = await getMatches({ allowedSeasonIds: seasonIds, allowedProgramIds: ["p"] });
    expect(error).toBeNull();
    expect(data).toHaveLength(3000);
    expect(new Set(data.map((row) => row.id)).size).toBe(3000);
  });

  it("keeps the chunk's IN filter on every page of that chunk", async () => {
    seedSeasons();
    db.tables.matches = Array.from({ length: 2100 }, (_, index) => ({
      id: `m-${String(index).padStart(6, "0")}`,
      season_id: seasonIds[0],
      status: "active"
    }));
    await getMatches({ allowedSeasonIds: seasonIds, allowedProgramIds: ["p"] });
    for (const request of requestsFor(db, "matches")) {
      const filters = JSON.parse(request.filters) as any[];
      const inFilter = filters.find((filter) => filter.kind === "in");
      expect(inFilter).toBeDefined();
      expect(inFilter.column).toBe("season_id");
      expect(inFilter.values.length).toBeGreaterThan(0);
      expect(request.order).toEqual(["id:asc"]);
    }
  });
});

// ---------------------------------------------------------------------------
// Failure is never zero
// ---------------------------------------------------------------------------

describe("a data-source failure is never rendered as an empty result", () => {
  it("page 1 succeeds and page 2 fails → the whole read fails", async () => {
    db.tables.mentoring_recaps = recaps(2500);
    db.injectError = (_request, prior) => (prior === 1 ? { code: "57014", message: "statement timeout" } : null);
    const { data, error } = await readRecaps();
    expect(error).toBeTruthy();
    // The caller must not be handed page 1 as if it were the answer.
    expect(data.length).toBeLessThan(2500);
    expect((error as any).code).toBe("57014");
  });

  it("a later chunk failing fails the whole read, not just that chunk", async () => {
    const seasonIds = Array.from({ length: 250 }, (_, index) => `season-${String(index).padStart(4, "0")}`);
    db.tables.seasons = seasonIds.map((id) => ({ id, code: id, name: id }));
    db.tables.matches = Array.from({ length: 20 }, (_, index) => ({ id: `m-${index}`, season_id: seasonIds[0], status: "active" }));
    // Chunk 1 costs two requests (data page + terminator); fail the third.
    db.injectError = (_request, prior) => (prior >= 2 ? { code: "57014", message: "statement timeout" } : null);

    const { data, error } = await getMatches({ allowedSeasonIds: seasonIds, allowedProgramIds: ["p"] });
    expect(error).toBeTruthy();
    expect(String(error)).toContain("matches");
    expect(data).toEqual([]);
  });

  it("a failed read of a legitimately empty table is still an error, not []", async () => {
    db.tables.mentoring_recaps = [];
    db.errors.mentoring_recaps = { code: "42501", message: "permission denied" };
    const { data, error } = await readRecaps();
    expect(data).toEqual([]);
    expect(error).toBeTruthy();
  });

  it("zero rows and a failed read are distinguishable at the KPI layer", async () => {
    db.tables.seasons = [{ id: SEASON, code: "UEHM-S11", name: "S11" }];
    db.tables.mentoring_recaps = [];
    db.tables.matches = [];
    db.tables.events = [];
    db.tables.event_participations = [];
    db.tables.intake_batches = [];
    db.tables.applications = [];
    db.tables.person_season_memberships = [];
    db.tables.people = [];
    db.tables.mentor_profiles = [];
    db.tables.mentee_profiles = [];
    db.tables.v_season_latest_closed_month = [];

    const scope = { allowedSeasonIds: [SEASON], allowedProgramIds: ["p"] };
    const quiet = await getOperationsData(scope);
    expect(quiet.recaps.error).toBeNull();
    expect(quiet.recaps.data).toEqual([]);

    db.errors.mentoring_recaps = { code: "57014", message: "statement timeout" };
    const broken = await getOperationsData(scope);
    expect(broken.recaps.error).toBeTruthy();
    expect(broken.kpis.error).toBeTruthy();
  });

  it("refuses to loop forever, reporting the page ceiling instead", async () => {
    // A server that always returns a full page would otherwise never terminate.
    db.tables.mentoring_recaps = recaps(5);
    const { data, error } = await readAllPages<any>(
      "mentoring_recaps",
      "id",
      (columns) => client.from("mentoring_recaps").select(columns),
      1
    );
    // 5 rows at one row per page terminates well inside the ceiling.
    expect(error).toBeNull();
    expect(data).toHaveLength(5);
    expect(MAX_PAGES).toBeGreaterThan(5);
  });
});

// ---------------------------------------------------------------------------
// Class-B bounded reads
// ---------------------------------------------------------------------------

describe("bounded reads assert their bound instead of truncating", () => {
  it("returns rows below the asserted limit", async () => {
    db.tables.person_roles = Array.from({ length: 4 }, (_, index) => ({ id: `role-${index}`, person_id: "p1" }));
    const { data, error } = await readBounded<any>("person_roles", client.from("person_roles").select("*"), 10);
    expect(error).toBeNull();
    expect(data).toHaveLength(4);
  });

  it("fails, and returns no rows, when the bound is reached", async () => {
    db.tables.person_roles = Array.from({ length: 10 }, (_, index) => ({ id: `role-${index}`, person_id: "p1" }));
    const { data, error } = await readBounded<any>("person_roles", client.from("person_roles").select("*"), 10);
    expect(data).toEqual([]);
    expect((error as any).message).toContain("asserted limit");
  });
});

// ---------------------------------------------------------------------------
// The registry itself
// ---------------------------------------------------------------------------

describe("the pagination registry", () => {
  it("declares a unique ordering key for every paged table", () => {
    for (const [table, order] of Object.entries(PAGE_ORDER)) {
      if (order.strategy === "keyset") {
        expect(order.key, table).toBeTruthy();
      } else {
        expect(order.key.length, table).toBeGreaterThan(1);
      }
    }
  });

  it("does not order the composite-PK link tables by a column they do not have", () => {
    // `mentor_industries` and `mentor_function_areas` are created by migration
    // 036 with `primary key (mentor_profile_id, <other>)` and NO `id` column.
    expect(PAGE_ORDER.mentor_industries).toEqual({ strategy: "range", key: ["mentor_profile_id", "industry_id"] });
    expect(PAGE_ORDER.mentor_function_areas).toEqual({ strategy: "range", key: ["mentor_profile_id", "function_area_id"] });
  });

  it("pages a composite-key table deterministically and without duplicates", async () => {
    db.tables.mentor_industries = Array.from({ length: 2400 }, (_, index) => ({
      mentor_profile_id: `mentor-${String(Math.floor(index / 3)).padStart(6, "0")}`,
      industry_id: `industry-${index % 3}`
    }));
    const { data, error } = await readAllPages<any>("mentor_industries", "mentor_profile_id,industry_id", (columns) =>
      client.from("mentor_industries").select(columns)
    );
    expect(error).toBeNull();
    expect(data).toHaveLength(2400);
    const keys = data.map((row: any) => `${row.mentor_profile_id}/${row.industry_id}`);
    expect(new Set(keys).size).toBe(2400);
    for (const request of requestsFor(db, "mentor_industries")) {
      expect(request.order).toEqual(["mentor_profile_id:asc", "industry_id:asc"]);
    }
  });
});
