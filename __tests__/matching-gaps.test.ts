/**
 * Direct production tests for lib/matching-gaps.ts — what is left over once the
 * mentors have taken the mentees they interviewed.
 *
 * The arithmetic here decides what the organisers work on next, so the cases
 * below pin it: a place granted by core_team counts as capacity, a mentee with
 * an active match is not waiting, and a refused mentor is listed with the row
 * needed to grant them another place.
 *
 * Classification: DIRECT PRODUCTION TESTS (call actual production exports).
 */
import { vi, describe, it, expect, beforeEach, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(),
  canReadSeason: vi.fn()
}));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canReadSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getMatchingGaps } from "@/lib/matching-gaps";

type ChainResult = { data?: unknown; error?: unknown; count?: number };

function makeChain(result: ChainResult = {}) {
  const resolved = Promise.resolve({ data: null, error: null, ...result });
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const method of ["select", "eq", "neq", "in", "is", "ilike", "order", "limit"]) {
    chain[method] = self;
  }
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null, ...result });
  chain.then = (f: unknown, r: unknown) => (resolved as Promise<unknown>).then(f as never, r as never);
  chain.catch = (r: unknown) => (resolved as Promise<unknown>).catch(r as never);
  chain.finally = (f: unknown) => (resolved as Promise<unknown>).finally(f as never);
  return chain;
}

function makeClient(byTable: Record<string, unknown[]>) {
  const queues = new Map(Object.entries(byTable).map(([table, chains]) => [table, [...chains]]));
  const tables: string[] = [];
  const from = vi.fn((table: string) => {
    tables.push(table);
    const queue = queues.get(table);
    if (queue && queue.length) return queue.length > 1 ? queue.shift() : queue[0];
    return makeChain();
  });
  return { client: { from } as unknown as ReturnType<typeof getSupabaseServiceRoleClient>, tables };
}

const SEASON = "00000000-0000-4000-8000-000000000001";
const MENTOR_A = "00000000-0000-4000-8000-00000000000a";
const MENTOR_B = "00000000-0000-4000-8000-00000000000b";
const MENTEE_TAKEN = "00000000-0000-4000-8000-00000000001a";
const APP_WAITING = "00000000-0000-4000-8000-00000000002a";
const APP_TAKEN = "00000000-0000-4000-8000-00000000002b";

beforeEach(() => {
  vi.resetAllMocks();
  (getCurrentAdminUser as Mock).mockResolvedValue({ id: "admin-1", email: "ops@example.com", role: "core_team" });
  (getAdminScopeContext as Mock).mockResolvedValue({ isSuperAdmin: true });
  (canReadSeason as Mock).mockResolvedValue(true);
});

describe("getMatchingGaps — authorization", () => {
  it("refuses a reviewer: this is the organisers' working list", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: "u", email: "m@example.com", role: "reviewer" });
    const { client, tables } = makeClient({});
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await getMatchingGaps({ seasonId: SEASON });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("không có quyền");
    expect(tables).toHaveLength(0);
  });

  it("refuses a season the operator cannot read", async () => {
    (canReadSeason as Mock).mockResolvedValue(false);
    const { client, tables } = makeClient({});
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await getMatchingGaps({ seasonId: SEASON });

    expect(result.ok).toBe(false);
    expect(tables).toHaveLength(0);
  });

  it("rejects a malformed season id before touching the database", async () => {
    const { client, tables } = makeClient({});
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await getMatchingGaps({ seasonId: "not-a-uuid" });

    expect(result.ok).toBe(false);
    expect(tables).toHaveLength(0);
  });
});

describe("getMatchingGaps — who is still waiting", () => {
  it("leaves out a candidate who already has an active match", async () => {
    const { client } = makeClient({
      matches: [makeChain({ data: [{ id: "m1", mentor_person_id: MENTOR_A, mentee_person_id: MENTEE_TAKEN }] })],
      applications: [
        makeChain({
          data: [
            { id: APP_WAITING, person_id: null, full_name: "Chờ ghép", email_primary: "a@example.com", status: "interview_completed", submitted_at: "2026-08-01" },
            { id: APP_TAKEN, person_id: MENTEE_TAKEN, full_name: "Đã ghép", email_primary: "b@example.com", status: "approved_as_mentee", submitted_at: "2026-08-02" }
          ]
        })
      ],
      application_reviews: [
        makeChain({ data: [{ application_id: APP_WAITING, status: "submitted", total_score: 21 }] })
      ],
      mentor_season_confirmations: [makeChain({ data: [] })]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await getMatchingGaps({ seasonId: SEASON });

    expect(result.ok).toBe(true);
    expect(result.mentees.map((row) => row.application_id)).toEqual([APP_WAITING]);
    expect(result.totals.menteesWaiting).toBe(1);
    expect(result.totals.activeMatches).toBe(1);
  });

  it("shows the interview score so the list can be worked in order", async () => {
    const { client } = makeClient({
      matches: [makeChain({ data: [] })],
      applications: [
        makeChain({
          data: [
            { id: APP_WAITING, person_id: null, full_name: "Chờ ghép", email_primary: "a@example.com", status: "interview_completed", submitted_at: "2026-08-01" }
          ]
        })
      ],
      application_reviews: [
        makeChain({ data: [{ application_id: APP_WAITING, status: "submitted", total_score: 23 }] })
      ],
      mentor_season_confirmations: [makeChain({ data: [] })]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await getMatchingGaps({ seasonId: SEASON });

    expect(result.mentees[0].interview_score).toBe(23);
    expect(result.mentees[0].interview_review_status).toBe("submitted");
  });
});

describe("getMatchingGaps — who still has room", () => {
  it("counts a granted extra place as capacity and lists only mentors with room", async () => {
    const { client } = makeClient({
      matches: [
        makeChain({
          data: [
            { id: "m1", mentor_person_id: MENTOR_A, mentee_person_id: "x1" },
            { id: "m2", mentor_person_id: MENTOR_B, mentee_person_id: "x2" }
          ]
        })
      ],
      applications: [makeChain({ data: [] })],
      mentor_season_confirmations: [
        makeChain({
          data: [
            // Full: one place, one mentee.
            { id: "conf-a", person_id: MENTOR_A, status: "confirmed", max_mentees: 1, extra_slots: 0, agree_to_interview: true },
            // Room: two declared plus one granted, one taken.
            { id: "conf-b", person_id: MENTOR_B, status: "confirmed", max_mentees: 2, extra_slots: 1, agree_to_interview: false }
          ]
        })
      ],
      people: [
        makeChain({
          data: [
            { id: MENTOR_A, full_name: "Mentor A", email_primary: "a@example.com" },
            { id: MENTOR_B, full_name: "Mentor B", email_primary: "b@example.com" }
          ]
        })
      ]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await getMatchingGaps({ seasonId: SEASON });

    expect(result.mentors).toHaveLength(1);
    expect(result.mentors[0].person_id).toBe(MENTOR_B);
    expect(result.mentors[0].cap).toBe(3);
    expect(result.mentors[0].active_count).toBe(1);
    expect(result.mentors[0].free_slots).toBe(2);
    expect(result.mentors[0].full_name).toBe("Mentor B");

    // Capacity counts everyone who confirmed, not only those with room left.
    expect(result.totals.capacityTotal).toBe(4);
    expect(result.totals.freeSlots).toBe(2);
  });

  it("ignores mentors who did not confirm", async () => {
    const { client } = makeClient({
      matches: [makeChain({ data: [] })],
      applications: [makeChain({ data: [] })],
      // The query already filters on confirmed; an empty answer must not be
      // turned into capacity by the caller.
      mentor_season_confirmations: [makeChain({ data: [] })]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await getMatchingGaps({ seasonId: SEASON });

    expect(result.mentors).toHaveLength(0);
    expect(result.totals.capacityTotal).toBe(0);
  });
});

describe("getMatchingGaps — mentors asking for another place", () => {
  it("lists refusals with the row needed to grant the extra place", async () => {
    const { client } = makeClient({
      matches: [makeChain({ data: [{ id: "m1", mentor_person_id: MENTOR_A, mentee_person_id: "x1" }] })],
      applications: [makeChain({ data: [] }), makeChain({ data: [{ id: APP_WAITING, full_name: "Ứng viên A" }] })],
      mentor_season_confirmations: [
        makeChain({
          data: [
            { id: "conf-a", person_id: MENTOR_A, status: "confirmed", max_mentees: 1, extra_slots: 0, agree_to_interview: true }
          ]
        })
      ],
      people: [makeChain({ data: [{ id: MENTOR_A, full_name: "Mentor A", email_primary: "a@example.com" }] })],
      mentor_mentee_selections: [
        makeChain({
          data: [
            {
              id: "sel-1",
              created_at: "2026-08-18T02:00:00.000Z",
              outcome: "blocked_cap",
              mentor_person_id: MENTOR_A,
              application_id: APP_WAITING,
              cap_at_decision: 1,
              active_count_at_decision: 1
            }
          ]
        })
      ]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await getMatchingGaps({ seasonId: SEASON });

    expect(result.blocked).toHaveLength(1);
    const [row] = result.blocked;
    expect(row.mentor_name).toBe("Mentor A");
    expect(row.candidate_name).toBe("Ứng viên A");
    expect(row.confirmation_id).toBe("conf-a");
    expect(row.extra_slots).toBe(0);
    expect(row.cap_at_decision).toBe(1);
  });

  it("still renders the rest of the page when the log table is unavailable", async () => {
    const { client } = makeClient({
      matches: [makeChain({ data: [] })],
      applications: [makeChain({ data: [] })],
      mentor_season_confirmations: [makeChain({ data: [] })],
      mentor_mentee_selections: [
        makeChain({ data: null, error: { code: "42P01", message: "relation does not exist" } })
      ]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await getMatchingGaps({ seasonId: SEASON });

    expect(result.ok).toBe(true);
    expect(result.blocked).toEqual([]);
  });
});
