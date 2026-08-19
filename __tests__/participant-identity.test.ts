/**
 * Direct production tests for the identity layer: who a login belongs to, which
 * programmes they may enter, and which season each programme is running.
 *
 * The refusals are the point. An address matching two people must stop rather
 * than pick one, a disabled account must read as disabled rather than as absent,
 * and only a super admin may change who gets in.
 *
 * Classification: DIRECT PRODUCTION TESTS (call actual production exports).
 */
import { vi, describe, it, expect, beforeEach, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: (fn: any) => fn }));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({
  getCurrentAdminUser: vi.fn(),
  getCurrentSupabaseAuthUser: vi.fn()
}));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { resolveParticipantForAuthUser } from "@/lib/participant-auth";
import { getProgramsForPerson, setProgramMembership } from "@/lib/participant-programs";
import { getCurrentSeasonForProgram, setCurrentSeason } from "@/lib/current-season";

// ── Mock helpers ──────────────────────────────────────────────────────────────

type ChainResult = { data?: unknown; error?: unknown };

function makeChain(result: ChainResult = {}, capture?: { payloads: unknown[] }) {
  const resolved = Promise.resolve({ data: null, error: null, ...result });
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const method of ["select", "eq", "neq", "in", "is", "or", "ilike", "order", "limit"]) {
    chain[method] = self;
  }
  const record = (payload: unknown) => {
    capture?.payloads.push(payload);
    return chain;
  };
  chain.insert = record;
  chain.update = record;
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

const AUTH = "auth-user-1";
const PERSON = "00000000-0000-4000-8000-000000000d01";
const PROGRAM = "00000000-0000-4000-8000-000000000c01";
const SEASON = "00000000-0000-4000-8000-000000000b01";
const ADMIN = "00000000-0000-4000-8000-000000000a01";

const user = { id: AUTH, email: "an@vam.vn" } as any;

function asSuperAdmin() {
  (getCurrentAdminUser as Mock).mockResolvedValue({
    id: ADMIN,
    email: "sa@vam.vn",
    full_name: "Super",
    role: "super_admin"
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ── Identity ──────────────────────────────────────────────────────────────────

describe("resolveParticipantForAuthUser", () => {
  it("returns the linked person when the account already exists", async () => {
    const { client } = makeClient({
      participant_accounts: [
        makeChain({
          data: {
            id: "acc-1",
            auth_user_id: AUTH,
            person_id: PERSON,
            status: "active",
            link_source: "invite"
          }
        })
      ],
      people: [makeChain({ data: { full_name: "Nguyễn Văn A", email_primary: "an@vam.vn" } })]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await resolveParticipantForAuthUser(user);

    expect(result.state).toBe("participant");
    if (result.state !== "participant") return;
    expect(result.account.personId).toBe(PERSON);
    expect(result.account.fullName).toBe("Nguyễn Văn A");
  });

  it("reads a disabled account as disabled, not as missing", async () => {
    const { client } = makeClient({
      participant_accounts: [
        makeChain({
          data: {
            id: "acc-1",
            auth_user_id: AUTH,
            person_id: PERSON,
            status: "disabled",
            link_source: "invite"
          }
        })
      ]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    expect((await resolveParticipantForAuthUser(user)).state).toBe("disabled");
  });

  it("links on first sign-in when the address matches exactly one person", async () => {
    const inserts = { payloads: [] as unknown[] };
    const { client } = makeClient({
      participant_accounts: [
        makeChain({ data: null }),
        makeChain({ data: { id: "acc-new" } }, inserts)
      ],
      people: [makeChain({ data: [{ id: PERSON, full_name: "A", email_primary: "an@vam.vn" }] })]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await resolveParticipantForAuthUser(user);

    expect(result.state).toBe("participant");
    expect(inserts.payloads[0]).toMatchObject({
      auth_user_id: AUTH,
      person_id: PERSON,
      link_source: "self_register"
    });
  });

  it("refuses rather than guessing when the address matches two people", async () => {
    const { client, tables } = makeClient({
      participant_accounts: [makeChain({ data: null })],
      people: [
        makeChain({
          data: [
            { id: PERSON, full_name: "A", email_primary: "an@vam.vn" },
            { id: "other", full_name: "A khác", email_primary: "AN@vam.vn" }
          ]
        })
      ]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await resolveParticipantForAuthUser(user);

    expect(result.state).toBe("ambiguous");
    // Nothing was written — a wrong link is not recoverable by the visitor.
    expect(tables.filter((table) => table === "participant_accounts")).toHaveLength(1);
  });

  it("says the address is not in the data when nobody matches", async () => {
    const { client } = makeClient({
      participant_accounts: [makeChain({ data: null })],
      people: [makeChain({ data: [] })]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await resolveParticipantForAuthUser(user);
    expect(result.state).toBe("unmatched");
    if (result.state !== "unmatched") return;
    expect(result.message).toContain("liên hệ ban tổ chức");
  });

  it("does not treat a database failure as a genuine non-participant", async () => {
    const { client } = makeClient({
      participant_accounts: [makeChain({ error: { code: "500", message: "boom" } })]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    expect((await resolveParticipantForAuthUser(user)).state).toBe("error");
  });
});

// ── Programmes ────────────────────────────────────────────────────────────────

describe("getProgramsForPerson", () => {
  it("returns the active memberships with each programme's season", async () => {
    const { client } = makeClient({
      person_program_memberships: [
        makeChain({ data: [{ program_id: PROGRAM, role: "mentor" }] })
      ],
      programs: [
        makeChain({
          data: [
            { id: PROGRAM, code: "UEHM", name: "UEH Mentoring", is_active: true, current_season_id: SEASON }
          ]
        })
      ],
      seasons: [makeChain({ data: [{ id: SEASON, code: "UEHM-S12", name: "Mùa 12" }] })]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const programs = await getProgramsForPerson(PERSON);

    expect(programs).toHaveLength(1);
    expect(programs[0]).toMatchObject({
      programCode: "UEHM",
      role: "mentor",
      currentSeasonCode: "UEHM-S12",
      currentSeasonName: "Mùa 12"
    });
  });

  it("drops an archived programme even for somebody who was in it", async () => {
    const { client } = makeClient({
      person_program_memberships: [
        makeChain({ data: [{ program_id: PROGRAM, role: "mentee" }] })
      ],
      programs: [
        makeChain({
          data: [
            { id: PROGRAM, code: "OLD", name: "Cũ", is_active: false, current_season_id: null }
          ]
        })
      ]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    expect(await getProgramsForPerson(PERSON)).toEqual([]);
  });

  it("refuses an id that is not an id, without touching the database", async () => {
    expect(await getProgramsForPerson("khong-phai-uuid")).toEqual([]);
    expect(getSupabaseServiceRoleClient).not.toHaveBeenCalled();
  });
});

describe("setProgramMembership", () => {
  it("refuses anybody who is not a super admin", async () => {
    for (const role of ["admin", "core_team", "support_team", "reviewer", "viewer", "vam_admin"]) {
      (getCurrentAdminUser as Mock).mockResolvedValue({ id: ADMIN, role });

      const result = await setProgramMembership({
        personId: PERSON,
        programId: PROGRAM,
        role: "mentor",
        status: "active"
      });

      expect(result.ok, role).toBe(false);
      expect(result.message, role).toContain("super admin");
    }
    expect(getSupabaseServiceRoleClient).not.toHaveBeenCalled();
  });

  it("validates before it authorises, so a bad payload never reaches the database", async () => {
    const bad = [
      { personId: "x", programId: PROGRAM, role: "mentor", status: "active" },
      { personId: PERSON, programId: "x", role: "mentor", status: "active" },
      { personId: PERSON, programId: PROGRAM, role: "coreteam", status: "active" },
      { personId: PERSON, programId: PROGRAM, role: "mentor", status: "deleted" }
    ];

    for (const input of bad) {
      const result = await setProgramMembership(input);
      expect(result.ok, JSON.stringify(input)).toBe(false);
    }
    expect(getCurrentAdminUser).not.toHaveBeenCalled();
  });

  it("creates a membership and writes the change to the log", async () => {
    asSuperAdmin();
    const logs = { payloads: [] as unknown[] };
    const { client } = makeClient({
      person_program_memberships: [makeChain({ data: null }), makeChain({ data: { id: "m-1" } })],
      person_program_membership_log: [makeChain({}, logs)]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await setProgramMembership({
      personId: PERSON,
      programId: PROGRAM,
      role: "mentor",
      status: "active"
    });

    expect(result.ok).toBe(true);
    expect(logs.payloads[0]).toMatchObject({
      person_id: PERSON,
      program_id: PROGRAM,
      role: "mentor",
      old_status: null,
      new_status: "active",
      transition_type: "created",
      changed_by: ADMIN
    });
  });

  it("reactivates the row that already exists rather than creating a second", async () => {
    asSuperAdmin();
    const updates = { payloads: [] as unknown[] };
    const logs = { payloads: [] as unknown[] };
    const { client } = makeClient({
      person_program_memberships: [
        makeChain({ data: { id: "m-1", status: "inactive" } }),
        makeChain({}, updates)
      ],
      person_program_membership_log: [makeChain({}, logs)]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await setProgramMembership({
      personId: PERSON,
      programId: PROGRAM,
      role: "mentor",
      status: "active"
    });

    expect(result.ok).toBe(true);
    expect(updates.payloads[0]).toEqual({ status: "active" });
    expect(logs.payloads[0]).toMatchObject({
      old_status: "inactive",
      new_status: "active",
      transition_type: "activated"
    });
  });

  it("does nothing, and says so, when the status is already what was asked for", async () => {
    asSuperAdmin();
    const { client } = makeClient({
      person_program_memberships: [makeChain({ data: { id: "m-1", status: "active" } })]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await setProgramMembership({
      personId: PERSON,
      programId: PROGRAM,
      role: "mentor",
      status: "active"
    });

    expect(result).toEqual({ ok: true, message: "Không có gì thay đổi." });
  });
});

// ── Seasons ───────────────────────────────────────────────────────────────────

describe("getCurrentSeasonForProgram", () => {
  it("uses the season somebody chose", async () => {
    const { client } = makeClient({
      programs: [makeChain({ data: { id: PROGRAM, code: "UEHM", current_season_id: SEASON } })],
      seasons: [makeChain({ data: { id: SEASON, code: "UEHM-S12", name: "Mùa 12" } })]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const season = await getCurrentSeasonForProgram("UEHM");

    expect(season).toMatchObject({ code: "UEHM-S12", explicit: true });
  });

  it("falls back to the highest season code, and says the answer was inferred", async () => {
    const { client } = makeClient({
      programs: [makeChain({ data: { id: PROGRAM, code: "UEHM", current_season_id: null } })],
      seasons: [
        makeChain({
          data: [
            { id: "s11", code: "UEHM-S11", name: "Mùa 11", program_id: PROGRAM },
            { id: "s12", code: "UEHM-S12", name: "Mùa 12", program_id: PROGRAM }
          ]
        })
      ]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const season = await getCurrentSeasonForProgram("UEHM");

    // The picker has to work on day one, before anybody has used the new screen.
    expect(season).toMatchObject({ code: "UEHM-S12", explicit: false });
  });

  it("returns nothing for a programme with no seasons at all", async () => {
    const { client } = makeClient({
      programs: [makeChain({ data: { id: PROGRAM, code: "BAM", current_season_id: null } })],
      seasons: [makeChain({ data: [] })]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    expect(await getCurrentSeasonForProgram("BAM")).toBeNull();
  });
});

describe("setCurrentSeason", () => {
  it("refuses a season belonging to a different programme", async () => {
    asSuperAdmin();
    const { client } = makeClient({
      seasons: [
        makeChain({ data: { code: "BK-S11", name: "Mùa 11", program_id: "another-program" } })
      ]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await setCurrentSeason({ programId: PROGRAM, seasonId: SEASON });

    // Getting this wrong would put UEH's mentors into BK's season with nothing
    // visibly broken.
    expect(result.ok).toBe(false);
    expect(result.message).toContain("thuộc chương trình khác");
  });

  it("refuses anybody who is not a super admin", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: ADMIN, role: "admin" });

    const result = await setCurrentSeason({ programId: PROGRAM, seasonId: SEASON });

    expect(result.ok).toBe(false);
    expect(getSupabaseServiceRoleClient).not.toHaveBeenCalled();
  });

  it("allows clearing the choice, falling back to the inferred season", async () => {
    asSuperAdmin();
    const updates = { payloads: [] as unknown[] };
    const { client } = makeClient({ programs: [makeChain({}, updates)] });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await setCurrentSeason({ programId: PROGRAM, seasonId: "" });

    expect(result.ok).toBe(true);
    expect(updates.payloads[0]).toEqual({ current_season_id: null });
  });
});
