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

function baseStore(): Store {
  return {
    mentor_profiles: [
      { id: "mp-1", person_id: SEASON_PERSON, mentor_code: "M001", intake_batch_id: "b-1" }
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

    const { data } = await getReviewerPool();

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
