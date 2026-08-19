import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(),
  canOperateSeason: vi.fn()
}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/renewal-runtime", () => ({
  submitRenewalAccepted: vi.fn(),
  submitRenewalDeclined: vi.fn(),
  createRenewalInvite: vi.fn(),
  revokeRenewalInvite: vi.fn(),
  regenerateRenewalInvite: vi.fn(),
  confirmRenewalAndApprove: vi.fn()
}));

import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { createRenewalInvite } from "@/lib/renewal-runtime";
import { createRenewalInviteBatch } from "@/lib/renewal-batch";
import { createRenewalInviteBatchAction } from "@/app/actions/renewals";
import {
  RENEWAL_BATCH_CONCURRENCY,
  RENEWAL_BATCH_MAX_SIZE,
  initialRenewalBatchState
} from "@/lib/renewal-types";

/**
 * M075 — safe batch renewal invite creation.
 *
 * The security claim under test is that the batch is a LOOP OVER THE EXISTING
 * TRUSTED PATH, not a second implementation. So the tests assert what the batch
 * delegates and how it reports, and deliberately do NOT re-test token minting —
 * that lives in createRenewalInvite, is mocked here, and already has its own
 * coverage. What matters is that nothing bypasses it.
 */

const PROGRAM = "22222222-2222-4222-8222-222222222222";
const SEASON = "33333333-3333-4333-8333-333333333333";
const P1 = "11111111-1111-4111-8111-000000000001";
const P2 = "11111111-1111-4111-8111-000000000002";
const P3 = "11111111-1111-4111-8111-000000000003";

const FUTURE = new Date(Date.now() + 7 * 86_400_000).toISOString();
const PAST = new Date(Date.now() - 86_400_000).toISOString();

type Fixture = {
  season?: Record<string, unknown> | null;
  people?: Array<Record<string, unknown>>;
  profiles?: Array<Record<string, unknown>>;
  invites?: Array<Record<string, unknown>>;
  seasonError?: unknown;
  peopleError?: unknown;
  profileError?: unknown;
  inviteError?: unknown;
};

/**
 * A Supabase stub shaped like the real chained builder. `in()` resolves as a
 * thenable so `await client.from(...).select(...).in(...)` yields {data,error},
 * while `maybeSingle()` resolves the single-row season lookup.
 */
function client(fixture: Fixture) {
  const {
    season = { id: SEASON, program_id: PROGRAM, code: "UEHM-S12" },
    people = [],
    profiles = [],
    invites = [],
    seasonError = null,
    peopleError = null,
    profileError = null,
    inviteError = null
  } = fixture;

  return {
    from: vi.fn((table: string) => {
      const payload =
        table === "people"
          ? { data: people, error: peopleError }
          : table === "mentor_profiles"
            ? { data: profiles, error: profileError }
            : table === "person_season_invites"
              ? { data: invites, error: inviteError }
              : { data: [], error: null };

      const chain: Record<string, any> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.in = vi.fn(() => chain);
      chain.maybeSingle = vi.fn(async () => ({ data: season, error: seasonError }));
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(payload).then(resolve);
      return chain;
    })
  } as any;
}

function eligibleFixture(personIds: string[]): Fixture {
  return {
    people: personIds.map((id, i) => ({
      id,
      full_name: `Validation Mentor 0${i + 1}`,
      email_primary: `mentor0${i + 1}@example.com`
    })),
    profiles: personIds.map((id, i) => ({ id: `prof-${i}`, person_id: id, mentor_code: `VM-00${i + 1}` })),
    invites: []
  };
}

const input = (personIds: string[]) => ({
  actorAdminUserId: "admin-1",
  personIds,
  programId: PROGRAM,
  seasonId: SEASON,
  expiresAt: FUTURE
});

beforeEach(() => {
  vi.clearAllMocks();
  let n = 0;
  (createRenewalInvite as Mock).mockImplementation(async () => {
    n += 1;
    return { ok: true, outcome: "created", message: "ok", renewalPath: `/renew/token-${n}-${Math.random()}` };
  });
});

describe("M075 batch delegates to the existing trusted create path", () => {
  it("calls createRenewalInvite exactly once per selected mentor", async () => {
    const result = await createRenewalInviteBatch(input([P1, P2, P3]), client(eligibleFixture([P1, P2, P3])));
    expect(createRenewalInvite).toHaveBeenCalledTimes(3);
    expect(result.createdCount).toBe(3);
    expect(result.ok).toBe(true);
  });

  it("passes the same program, season and expiry to every call", async () => {
    await createRenewalInviteBatch(input([P1, P2]), client(eligibleFixture([P1, P2])));
    for (const call of (createRenewalInvite as Mock).mock.calls) {
      expect(call[0]).toMatchObject({
        actorAdminUserId: "admin-1",
        programId: PROGRAM,
        seasonId: SEASON,
        expiresAt: FUTURE
      });
    }
  });

  it("issues a unique raw link per successful mentor", async () => {
    const result = await createRenewalInviteBatch(input([P1, P2, P3]), client(eligibleFixture([P1, P2, P3])));
    const paths = result.results.filter((r) => r.renewalPath).map((r) => r.renewalPath);
    expect(paths).toHaveLength(3);
    expect(new Set(paths).size).toBe(3);
  });

  it("never exceeds the declared concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    (createRenewalInvite as Mock).mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return { ok: true, renewalPath: `/renew/${Math.random()}` };
    });
    const ids = Array.from({ length: 12 }, (_, i) => `11111111-1111-4111-8111-0000000000${String(i).padStart(2, "0")}`);
    await createRenewalInviteBatch(input(ids), client(eligibleFixture(ids)));
    expect(peak).toBeLessThanOrEqual(RENEWAL_BATCH_CONCURRENCY);
  });

  it("de-duplicates a mentor selected twice so they consume one attempt", async () => {
    const result = await createRenewalInviteBatch(input([P1, P1]), client(eligibleFixture([P1])));
    expect(createRenewalInvite).toHaveBeenCalledTimes(1);
    expect(result.results).toHaveLength(1);
  });
});

describe("M075 active-invite protection", () => {
  it("skips a mentor holding a live invite instead of regenerating", async () => {
    const fixture = eligibleFixture([P1, P2]);
    fixture.invites = [{ id: "inv-1", person_id: P2, expires_at: FUTURE, revoked_at: null, outcome: null }];
    const result = await createRenewalInviteBatch(input([P1, P2]), client(fixture));

    expect(createRenewalInvite).toHaveBeenCalledTimes(1);
    expect((createRenewalInvite as Mock).mock.calls[0][0].personId).toBe(P1);

    const skipped = result.results.find((r) => r.personId === P2);
    expect(skipped?.outcome).toBe("skipped_live_invite");
    expect(skipped?.renewalPath).toBeUndefined();
    expect(result.skippedCount).toBe(1);
    expect(result.createdCount).toBe(1);
  });

  it("does not treat an EXPIRED invite as live", async () => {
    const fixture = eligibleFixture([P1]);
    fixture.invites = [{ id: "inv-1", person_id: P1, expires_at: PAST, revoked_at: null, outcome: null }];
    const result = await createRenewalInviteBatch(input([P1]), client(fixture));
    expect(result.results[0].outcome).toBe("created");
  });

  it("does not treat a REVOKED invite as live", async () => {
    const fixture = eligibleFixture([P1]);
    fixture.invites = [
      { id: "inv-1", person_id: P1, expires_at: FUTURE, revoked_at: new Date().toISOString(), outcome: null }
    ];
    const result = await createRenewalInviteBatch(input([P1]), client(fixture));
    expect(result.results[0].outcome).toBe("created");
  });

  it("reports an already-accepted mentor as ineligible, not as holding a link", async () => {
    const fixture = eligibleFixture([P1]);
    fixture.invites = [{ id: "inv-1", person_id: P1, expires_at: PAST, revoked_at: null, outcome: "accepted" }];
    const result = await createRenewalInviteBatch(input([P1]), client(fixture));
    expect(result.results[0].outcome).toBe("not_eligible");
    expect(createRenewalInvite).not.toHaveBeenCalled();
  });
});

describe("M075 eligibility is re-derived server-side", () => {
  it("refuses a mentor with no canonical profile", async () => {
    const fixture = eligibleFixture([P1]);
    fixture.profiles = [];
    const result = await createRenewalInviteBatch(input([P1]), client(fixture));
    expect(result.results[0].outcome).toBe("not_eligible");
    expect(createRenewalInvite).not.toHaveBeenCalled();
  });

  it("refuses a mentor with duplicate profiles", async () => {
    const fixture = eligibleFixture([P1]);
    fixture.profiles = [
      { id: "a", person_id: P1, mentor_code: "VM-001" },
      { id: "b", person_id: P1, mentor_code: "VM-001-DUP" }
    ];
    const result = await createRenewalInviteBatch(input([P1]), client(fixture));
    expect(result.results[0].outcome).toBe("not_eligible");
    expect(createRenewalInvite).not.toHaveBeenCalled();
  });

  it("refuses a person id with no people row", async () => {
    const fixture = eligibleFixture([P1]);
    fixture.people = [];
    const result = await createRenewalInviteBatch(input([P1]), client(fixture));
    expect(result.results[0].outcome).toBe("not_eligible");
  });

  it("refuses the whole batch when the season is not the canonical current season", async () => {
    const fixture = eligibleFixture([P1]);
    fixture.season = { id: SEASON, program_id: PROGRAM, code: "UEHM-S11" };
    const result = await createRenewalInviteBatch(input([P1]), client(fixture));
    expect(result.ok).toBe(false);
    expect(result.results).toHaveLength(0);
    expect(createRenewalInvite).not.toHaveBeenCalled();
  });

  it("refuses the whole batch when program and season do not resolve together", async () => {
    const fixture = eligibleFixture([P1]);
    fixture.season = null;
    const result = await createRenewalInviteBatch(input([P1]), client(fixture));
    expect(result.ok).toBe(false);
    expect(createRenewalInvite).not.toHaveBeenCalled();
  });

  it("creates nothing when the inventory read fails, rather than guessing", async () => {
    const fixture = eligibleFixture([P1, P2]);
    fixture.inviteError = { code: "57014" };
    const result = await createRenewalInviteBatch(input([P1, P2]), client(fixture));
    expect(result.ok).toBe(false);
    expect(result.results).toHaveLength(0);
    expect(createRenewalInvite).not.toHaveBeenCalled();
  });
});

describe("M075 one failure does not contaminate the others", () => {
  it("marks only the failing mentor as failed", async () => {
    (createRenewalInvite as Mock).mockImplementation(async ({ personId }: { personId: string }) =>
      personId === P2 ? { ok: false, message: "refused" } : { ok: true, renewalPath: `/renew/${personId}` }
    );
    const result = await createRenewalInviteBatch(input([P1, P2, P3]), client(eligibleFixture([P1, P2, P3])));

    const byId = new Map(result.results.map((r) => [r.personId, r]));
    expect(byId.get(P1)?.outcome).toBe("created");
    expect(byId.get(P2)?.outcome).toBe("failed");
    expect(byId.get(P3)?.outcome).toBe("created");
    expect(byId.get(P2)?.renewalPath).toBeUndefined();
    expect(result.createdCount).toBe(2);
    expect(result.failedCount).toBe(1);
  });

  it("does not report whole-batch success when any mentor failed", async () => {
    (createRenewalInvite as Mock).mockImplementation(async ({ personId }: { personId: string }) =>
      personId === P2 ? { ok: false, message: "refused" } : { ok: true, renewalPath: `/renew/${personId}` }
    );
    const result = await createRenewalInviteBatch(input([P1, P2]), client(eligibleFixture([P1, P2])));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("lỗi 1");
  });

  it("survives a mentor whose create THROWS and still serves the rest", async () => {
    (createRenewalInvite as Mock).mockImplementation(async ({ personId }: { personId: string }) => {
      if (personId === P1) throw new Error("boom");
      return { ok: true, renewalPath: `/renew/${personId}` };
    });
    const result = await createRenewalInviteBatch(input([P1, P2, P3]), client(eligibleFixture([P1, P2, P3])));
    const byId = new Map(result.results.map((r) => [r.personId, r]));
    expect(byId.get(P1)?.outcome).toBe("failed");
    expect(byId.get(P2)?.outcome).toBe("created");
    expect(byId.get(P3)?.outcome).toBe("created");
  });

  it("counts every mentor exactly once across the three summary buckets", async () => {
    const fixture = eligibleFixture([P1, P2, P3]);
    fixture.invites = [{ id: "inv", person_id: P3, expires_at: FUTURE, revoked_at: null, outcome: null }];
    (createRenewalInvite as Mock).mockImplementation(async ({ personId }: { personId: string }) =>
      personId === P2 ? { ok: false, message: "refused" } : { ok: true, renewalPath: `/renew/${personId}` }
    );
    const result = await createRenewalInviteBatch(input([P1, P2, P3]), client(fixture));
    expect(result.createdCount + result.failedCount + result.skippedCount).toBe(result.results.length);
    expect(result.results).toHaveLength(3);
  });
});

describe("M075 raw token safety", () => {
  it("returns a raw path only for created mentors", async () => {
    const fixture = eligibleFixture([P1, P2]);
    fixture.invites = [{ id: "inv", person_id: P2, expires_at: FUTURE, revoked_at: null, outcome: null }];
    const result = await createRenewalInviteBatch(input([P1, P2]), client(fixture));
    expect(result.results.find((r) => r.personId === P1)?.renewalPath).toMatch(/^\/renew\//);
    expect(result.results.find((r) => r.personId === P2)?.renewalPath).toBeUndefined();
  });

  it("never writes a raw path into any table through the batch", async () => {
    const stub = client(eligibleFixture([P1]));
    await createRenewalInviteBatch(input([P1]), stub);
    // Only the three read tables are ever touched, and only via select().
    const tables = (stub.from as Mock).mock.calls.map((c: unknown[]) => c[0]);
    expect(new Set(tables)).toEqual(new Set(["seasons", "people", "mentor_profiles", "person_season_invites"]));
  });

  it("does not log the raw path when a mentor fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    (createRenewalInvite as Mock).mockImplementation(async () => {
      throw Object.assign(new Error("boom"), { code: "XX000" });
    });
    await createRenewalInviteBatch(input([P1]), client(eligibleFixture([P1])));
    for (const call of spy.mock.calls) {
      expect(JSON.stringify(call)).not.toMatch(/\/renew\//);
    }
    spy.mockRestore();
  });
});

describe("M075 batch size ceiling", () => {
  it("declares a limit that is small enough for a default serverless budget", () => {
    expect(RENEWAL_BATCH_MAX_SIZE).toBeLessThanOrEqual(50);
    expect(RENEWAL_BATCH_MAX_SIZE).toBeGreaterThan(1);
  });

  it("refuses a batch larger than the ceiling without calling create at all", async () => {
    const ids = Array.from(
      { length: RENEWAL_BATCH_MAX_SIZE + 1 },
      (_, i) => `11111111-1111-4111-8111-0000000${String(i).padStart(5, "0")}`
    );
    const result = await createRenewalInviteBatch(input(ids), client(eligibleFixture(ids)));
    expect(result.ok).toBe(false);
    expect(result.message).toContain(String(RENEWAL_BATCH_MAX_SIZE));
    expect(createRenewalInvite).not.toHaveBeenCalled();
  });

  it("accepts a batch exactly at the ceiling", async () => {
    const ids = Array.from(
      { length: RENEWAL_BATCH_MAX_SIZE },
      (_, i) => `11111111-1111-4111-8111-0000000${String(i).padStart(5, "0")}`
    );
    const result = await createRenewalInviteBatch(input(ids), client(eligibleFixture(ids)));
    expect(result.createdCount).toBe(RENEWAL_BATCH_MAX_SIZE);
  });
});

describe("M075 batch action authorization", () => {
  function form(fields: Record<string, string>) {
    const data = new FormData();
    for (const [k, v] of Object.entries(fields)) data.set(k, v);
    return data;
  }
  const valid = {
    program_id: PROGRAM,
    season_id: SEASON,
    expires_days: "14",
    person_ids: JSON.stringify([P1])
  };

  function authorize(ok: boolean) {
    (getAdminScopeContext as Mock).mockResolvedValue({
      adminUser: { id: "admin-1", role: "super_admin", status: "active", email: "a@b.c" }
    });
    (canOperateSeason as Mock).mockResolvedValue(ok);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client(eligibleFixture([P1])));
  }

  it("refuses an operator without season scope and creates nothing", async () => {
    authorize(false);
    const result = await createRenewalInviteBatchAction(initialRenewalBatchState, form(valid));
    expect(result.ok).toBe(false);
    expect(result.results).toHaveLength(0);
    expect(createRenewalInvite).not.toHaveBeenCalled();
  });

  it("refuses an inactive admin", async () => {
    (getAdminScopeContext as Mock).mockResolvedValue({
      adminUser: { id: "admin-1", role: "super_admin", status: "suspended" }
    });
    (canOperateSeason as Mock).mockResolvedValue(true);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client(eligibleFixture([P1])));
    const result = await createRenewalInviteBatchAction(initialRenewalBatchState, form(valid));
    expect(result.ok).toBe(false);
    expect(createRenewalInvite).not.toHaveBeenCalled();
  });

  it("allows an authorized operator", async () => {
    authorize(true);
    const result = await createRenewalInviteBatchAction(initialRenewalBatchState, form(valid));
    expect(result.createdCount).toBe(1);
  });

  it("rejects a malformed person_ids payload before authorization", async () => {
    authorize(true);
    const result = await createRenewalInviteBatchAction(
      initialRenewalBatchState,
      form({ ...valid, person_ids: "not-json" })
    );
    expect(result.ok).toBe(false);
    expect(createRenewalInvite).not.toHaveBeenCalled();
  });

  it("rejects a non-array person_ids payload", async () => {
    authorize(true);
    const result = await createRenewalInviteBatchAction(
      initialRenewalBatchState,
      form({ ...valid, person_ids: JSON.stringify({ id: P1 }) })
    );
    expect(result.ok).toBe(false);
    expect(createRenewalInvite).not.toHaveBeenCalled();
  });

  it("rejects a non-UUID person id", async () => {
    authorize(true);
    const result = await createRenewalInviteBatchAction(
      initialRenewalBatchState,
      form({ ...valid, person_ids: JSON.stringify(["not-a-uuid"]) })
    );
    expect(result.ok).toBe(false);
    expect(createRenewalInvite).not.toHaveBeenCalled();
  });

  it("rejects an empty selection", async () => {
    authorize(true);
    const result = await createRenewalInviteBatchAction(
      initialRenewalBatchState,
      form({ ...valid, person_ids: "[]" })
    );
    expect(result.ok).toBe(false);
    expect(createRenewalInvite).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range expiry", async () => {
    authorize(true);
    for (const days of ["0", "61", "abc"]) {
      (createRenewalInvite as Mock).mockClear();
      const result = await createRenewalInviteBatchAction(
        initialRenewalBatchState,
        form({ ...valid, expires_days: days })
      );
      expect(result.ok).toBe(false);
      expect(createRenewalInvite).not.toHaveBeenCalled();
    }
  });

  it("rejects a non-UUID program or season", async () => {
    authorize(true);
    const result = await createRenewalInviteBatchAction(
      initialRenewalBatchState,
      form({ ...valid, program_id: "nope" })
    );
    expect(result.ok).toBe(false);
    expect(createRenewalInvite).not.toHaveBeenCalled();
  });

  it("refuses a batch over the ceiling at the action boundary", async () => {
    authorize(true);
    const ids = Array.from(
      { length: RENEWAL_BATCH_MAX_SIZE + 1 },
      (_, i) => `11111111-1111-4111-8111-0000000${String(i).padStart(5, "0")}`
    );
    const result = await createRenewalInviteBatchAction(
      initialRenewalBatchState,
      form({ ...valid, person_ids: JSON.stringify(ids) })
    );
    expect(result.ok).toBe(false);
    expect(createRenewalInvite).not.toHaveBeenCalled();
  });
});
