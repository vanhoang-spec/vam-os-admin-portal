import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  const original = await vi.importActual("react");
  return { ...original, cache: (fn: any) => fn };
});

vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: vi.fn(),
  getSupabaseServerClient: vi.fn()
}));

import { getSupabaseServerClient, getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { getReviewerPool } from "@/lib/data";

/**
 * Minimal but faithful PostgREST fake.
 *
 * It honours the operators `lib/paged-read` actually emits — `.eq`, `.in`,
 * `.not(col,"is",null)`, `.gt(key,cursor)`, `.order`, `.limit`, `.range` — and
 * terminates keyset paging by returning an EMPTY page once the cursor passes
 * the last row. Filtering is real, so these tests exercise the production
 * join/eligibility logic rather than asserting on a hand-fed result.
 */
type Store = Record<string, any[]>;

function makeClient(store: Store) {
  const tableReads: string[] = [];

  function builder(table: string) {
    const preds: Array<(r: any) => boolean> = [];
    let orderKey: string | null = null;
    let limitN = Infinity;

    const q: any = {
      select: () => q,
      eq: (col: string, val: any) => {
        preds.push((r) => r[col] === val);
        return q;
      },
      in: (col: string, vals: any[]) => {
        const set = new Set(vals);
        preds.push((r) => set.has(r[col]));
        return q;
      },
      not: (col: string, op: string, val: any) => {
        if (op === "is" && val === null) preds.push((r) => r[col] !== null && r[col] !== undefined);
        return q;
      },
      gt: (col: string, cursor: any) => {
        preds.push((r) => String(r[col]) > String(cursor));
        return q;
      },
      order: (col: string) => {
        orderKey = col;
        return q;
      },
      limit: (n: number) => {
        limitN = n;
        return q.then ? q : q;
      },
      range: (from: number, to: number) => {
        const rows = run();
        return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
      }
    };

    function run() {
      let rows = (store[table] ?? []).filter((r) => preds.every((p) => p(r)));
      if (orderKey) rows = [...rows].sort((a, b) => String(a[orderKey!]).localeCompare(String(b[orderKey!])));
      return rows.slice(0, limitN === Infinity ? undefined : limitN);
    }

    // `.limit()` is the terminal call for both readAllPages (keyset) and
    // readBounded, so make the builder thenable.
    q.then = (resolve: any, reject: any) => {
      tableReads.push(table);
      return Promise.resolve({ data: run(), error: null }).then(resolve, reject);
    };

    return q;
  }

  return { client: { from: (t: string) => builder(t) }, tableReads };
}

const SEASON_PERSON = "p-mentor-1";
const BATCH = "b-1";
const SEASON = "s-12";

function baseStore(): Store {
  return {
    intake_batches: [{ id: BATCH, season_id: SEASON }],
    // Taking part in the season is what makes someone a candidate. The intake
    // batch on the profile below is incidental — see the SEASON_MEMBERSHIP
    // cases, where it is null exactly as it is for 448 of 449 real profiles.
    person_season_memberships: [
      { id: "psm-1", person_id: SEASON_PERSON, season_id: SEASON, status: "active", role: "mentor" }
    ],
    mentor_profiles: [
      { id: "mp-1", person_id: SEASON_PERSON, mentor_code: "M001", intake_batch_id: BATCH }
    ],
    people: [
      { id: SEASON_PERSON, full_name: "Mentor One", email_primary: "mentor.one@example.com" },
      { id: "p-core-active", full_name: "Core Active", email_primary: "core.active@example.com" },
      { id: "p-core-inactive", full_name: "Core Inactive", email_primary: "core.inactive@example.com" },
      { id: "p-viewer", full_name: "Viewer Person", email_primary: "viewer@example.com" }
    ],
    admin_users: [
      { id: "au-mentor", email: "mentor.one@example.com", role: "reviewer", status: "active", auth_user_id: "a1" },
      { id: "au-core-active", email: "core.active@example.com", role: "core_team", status: "active", auth_user_id: "a2" },
      { id: "au-core-inactive", email: "core.inactive@example.com", role: "core_team", status: "inactive", auth_user_id: "a3" },
      { id: "au-viewer", email: "viewer@example.com", role: "viewer", status: "active", auth_user_id: "a4" }
    ]
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSupabaseServerClient).mockResolvedValue(null as any);
});

describe("getReviewerPool eligibility", () => {
  it("CORE_TEAM_POOL: an ACTIVE core_team account with a people identity but no mentor_profile appears", async () => {
    const { client } = makeClient(baseStore());
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    const { data, error } = await getReviewerPool();
    expect(error).toBeNull();

    const core = data.find((r) => r.person_id === "p-core-active");
    expect(core).toBeDefined();
    expect(core?.mentor_profile_id).toBeNull();
    expect(core?.admin_user_id).toBe("au-core-active");
    expect(core?.admin_user_role).toBe("core_team");
    expect(core?.admin_user_status).toBe("active");
    // Grant is keyed on person_id — without it the row could not be actioned.
    expect(core?.person_id).toBe("p-core-active");
  });

  it("ACTIVE_POOL_POLICY: an INACTIVE core_team account is NOT offered as a grantable candidate", async () => {
    const { client } = makeClient(baseStore());
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    const { data, error } = await getReviewerPool();
    expect(error).toBeNull();

    expect(data.find((r) => r.person_id === "p-core-inactive")).toBeUndefined();
    expect(data.find((r) => r.admin_user_id === "au-core-inactive")).toBeUndefined();
  });

  it("ROLE_ALLOWLIST: a non-eligible account role (viewer) is not appended", async () => {
    const { client } = makeClient(baseStore());
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    const { data } = await getReviewerPool();
    expect(data.find((r) => r.person_id === "p-viewer")).toBeUndefined();
  });

  it("ELIGIBLE_ROLES: reviewer, core_team, admin and super_admin all qualify when active", async () => {
    const store = baseStore();
    store.people.push(
      { id: "p-admin", full_name: "Admin P", email_primary: "admin.p@example.com" },
      { id: "p-super", full_name: "Super P", email_primary: "super.p@example.com" },
      { id: "p-rev", full_name: "Rev P", email_primary: "rev.p@example.com" }
    );
    store.admin_users.push(
      { id: "au-admin", email: "admin.p@example.com", role: "admin", status: "active", auth_user_id: "a5" },
      { id: "au-super", email: "super.p@example.com", role: "super_admin", status: "active", auth_user_id: "a6" },
      { id: "au-rev", email: "rev.p@example.com", role: "reviewer", status: "active", auth_user_id: "a7" }
    );
    const { client } = makeClient(store);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    const { data } = await getReviewerPool();
    for (const pid of ["p-admin", "p-super", "p-rev"]) {
      expect(data.find((r) => r.person_id === pid)).toBeDefined();
    }
  });

  it("NO_PERSON_SYNTHESIS: an eligible admin with NO people row is dropped, never invented", async () => {
    const store = baseStore();
    store.admin_users.push({
      id: "au-orphan",
      email: "orphan.admin@example.com",
      role: "admin",
      status: "active",
      auth_user_id: "a9"
    });
    // Deliberately no matching people row for orphan.admin@example.com.
    const { client } = makeClient(store);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    const { data } = await getReviewerPool();

    expect(data.find((r) => r.admin_user_id === "au-orphan")).toBeUndefined();
    expect(data.find((r) => r.email_primary === "orphan.admin@example.com")).toBeUndefined();
    // The people table was not mutated.
    expect(store.people.some((p) => p.email_primary === "orphan.admin@example.com")).toBe(false);
    expect(store.people).toHaveLength(4);
  });

  it("NO_DUPLICATE_POOL_ROWS: an account reachable via BOTH mentor_profile and admin email appears once", async () => {
    const store = baseStore();
    // The mentor already resolves through mentor_profiles; its admin_users row
    // is an eligible reviewer, so the append pass must not re-emit it.
    const { client } = makeClient(store);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    // Mentor candidates are season-scoped, so the duplicate this case guards
    // against can only arise once a batch is chosen.
    const { data } = await getReviewerPool({ intakeBatchId: BATCH });

    const forMentor = data.filter((r) => r.person_id === SEASON_PERSON);
    expect(forMentor).toHaveLength(1);
    expect(forMentor[0].mentor_profile_id).toBe("mp-1");
    expect(forMentor[0].admin_user_id).toBe("au-mentor");

    // No person_id is emitted twice anywhere in the pool.
    const personIds = data.map((r) => r.person_id).filter(Boolean);
    expect(new Set(personIds).size).toBe(personIds.length);
  });

  it("STABLE_ROW_IDENTITY: every row carries a stable non-null key for React", async () => {
    const { client } = makeClient(baseStore());
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    const { data } = await getReviewerPool();
    expect(data.length).toBeGreaterThan(0);
    const keys = data.map((r) => r.person_id ?? r.mentor_profile_id ?? r.email_primary ?? r.admin_user_id);
    expect(keys.every((k) => typeof k === "string" && k.length > 0)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * The pool used to filter mentors by `mentor_profiles.intake_batch_id`.
 *
 * That column records the intake a mentor ARRIVED through, and only the
 * new-application approval path writes it. On Production 448 of 449 mentor
 * profiles carry NULL, so the mentor half of the page could surface at most one
 * person: every mentor who joined by historical import or by season renewal was
 * invisible, which is the whole standing mentor base. Season 12 had 193 active
 * mentors and not one could be granted review rights through this page.
 *
 * These cases pin the replacement: participation in the season decides.
 */
describe("getReviewerPool season membership", () => {
  it("NULL_INTAKE_BATCH_STILL_APPEARS: a renewal mentor with no intake batch is a candidate", () => {
    const store = baseStore();
    store.people.push({ id: "p-renewal", full_name: "Renewal Mentor", email_primary: "renewal@example.com" });
    // Exactly the production shape: a real mentor profile, no intake batch.
    store.mentor_profiles.push({ id: "mp-renewal", person_id: "p-renewal", mentor_code: "UEHRM10032", intake_batch_id: null });
    store.person_season_memberships.push({ id: "psm-renewal", person_id: "p-renewal", season_id: SEASON, status: "active", role: "mentor" });

    const { client } = makeClient(store);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    return getReviewerPool({ intakeBatchId: BATCH }).then(({ data, error }) => {
      expect(error).toBeNull();
      const row = data.find((r) => r.person_id === "p-renewal");
      expect(row).toBeDefined();
      expect(row?.mentor_code).toBe("UEHRM10032");
      expect(row?.intake_batch_id).toBeNull();
      // No account yet — this is precisely the row an admin needs to grant.
      expect(row?.admin_user_id).toBeNull();
    });
  });

  it("NON_MEMBER_EXCLUDED: a mentor profile with no membership in that season is not offered", async () => {
    const store = baseStore();
    store.people.push({ id: "p-stranger", full_name: "Other Season", email_primary: "stranger@example.com" });
    store.mentor_profiles.push({ id: "mp-stranger", person_id: "p-stranger", mentor_code: "M999", intake_batch_id: null });
    // Deliberately no person_season_memberships row for this season.

    const { client } = makeClient(store);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    const { data } = await getReviewerPool({ intakeBatchId: BATCH });
    expect(data.find((r) => r.person_id === "p-stranger")).toBeUndefined();
  });

  it("ENDED_MEMBERSHIP_EXCLUDED: a completed membership does not make someone a candidate", async () => {
    const store = baseStore();
    store.people.push({ id: "p-last-season", full_name: "Last Season", email_primary: "last@example.com" });
    store.mentor_profiles.push({ id: "mp-last", person_id: "p-last-season", mentor_code: "M888", intake_batch_id: null });
    store.person_season_memberships.push({ id: "psm-last", person_id: "p-last-season", season_id: SEASON, status: "completed", role: "mentor" });

    const { client } = makeClient(store);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    const { data } = await getReviewerPool({ intakeBatchId: BATCH });
    expect(data.find((r) => r.person_id === "p-last-season")).toBeUndefined();
  });

  it("WRONG_SEASON_EXCLUDED: an active membership in a DIFFERENT season does not carry over", async () => {
    const store = baseStore();
    store.people.push({ id: "p-other", full_name: "Other Season Active", email_primary: "other@example.com" });
    store.mentor_profiles.push({ id: "mp-other", person_id: "p-other", mentor_code: "M777", intake_batch_id: null });
    store.person_season_memberships.push({ id: "psm-other", person_id: "p-other", season_id: "s-11", status: "active", role: "mentor" });

    const { client } = makeClient(store);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    const { data } = await getReviewerPool({ intakeBatchId: BATCH });
    expect(data.find((r) => r.person_id === "p-other")).toBeUndefined();
  });

  it("STAFF_ROWS_SURVIVE_AN_EMPTY_MENTOR_HALF: Core Team is an independent source", async () => {
    // The old code returned early when the mentor query found nobody, which
    // took the staff rows down with it — the page went blank rather than
    // merely mentor-less.
    const store = baseStore();
    store.person_season_memberships = [];

    const { client } = makeClient(store);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    const { data, error } = await getReviewerPool({ intakeBatchId: BATCH });
    expect(error).toBeNull();
    expect(data.find((r) => r.person_id === "p-core-active")).toBeDefined();
  });

  it("NO_BATCH_NO_SEASON: without a batch there is no season, so no mentor is offered", async () => {
    const { client } = makeClient(baseStore());
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    const { data } = await getReviewerPool();
    // The page disables its grant buttons in this state; offering mentors
    // there would be offering an action that cannot be taken.
    expect(data.every((r) => r.mentor_profile_id === null)).toBe(true);
    // Staff accounts are still listed.
    expect(data.find((r) => r.person_id === "p-core-active")).toBeDefined();
  });

  it("UNKNOWN_BATCH: a batch id that resolves to no season yields no mentor candidates", async () => {
    const { client } = makeClient(baseStore());
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);

    const { data, error } = await getReviewerPool({ intakeBatchId: "b-does-not-exist" });
    expect(error).toBeNull();
    expect(data.every((r) => r.mentor_profile_id === null)).toBe(true);
  });
});
