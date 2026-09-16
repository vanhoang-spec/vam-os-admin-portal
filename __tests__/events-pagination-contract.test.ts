/**
 * Boundary and failure tests for the multi-row reads in `lib/events.ts`.
 *
 * ---------------------------------------------------------------------------
 * WHAT THESE TESTS ARE FOR
 * ---------------------------------------------------------------------------
 * PostgREST caps a response at `db-max-rows` and does it SILENTLY: `200 OK`,
 * `error: null`, and a truncated array that is indistinguishable from a
 * complete one. Nothing in the application can notice. So the only way to prove
 * these reads are complete is to run them against a server that ACTUALLY caps,
 * with more rows than the cap, and assert on the answer.
 *
 * `makeFakeClient` below is therefore not a stub that returns canned arrays —
 * it is a small PostgREST emulator that enforces a row cap, applies the same
 * filters the real server would, and refuses to return more than `maxRows` per
 * request. A read that does not page CANNOT pass these tests, and a read that
 * pages incorrectly (dropped filter, unstable order, stop-on-short-page) fails
 * them for the right reason.
 *
 * Two classes of test appear for each read:
 *
 *   BOUNDARY   — more rows than the cap. Asserts the complete set reached the
 *                decision, not the first page of it.
 *   LATER-PAGE — page 1 succeeds, page 2 errors. Asserts the caller reports
 *                failure and performs NO WRITE. A partial prefix treated as a
 *                complete result is the exact defect being guarded against, and
 *                it is strictly worse than an error because it looks like data.
 *
 * Classification: DIRECT PRODUCTION TESTS (call actual production exports).
 */
import { vi, describe, it, expect, beforeEach, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(),
  canOperateAnyScope: vi.fn(),
  canOperateSeason: vi.fn(),
  getAllowedSeasonIds: vi.fn(),
  canAccessSeason: vi.fn(),
}));
vi.mock("@/lib/data", () => ({
  getMenteeProfiles: vi.fn(),
  getMentorProfiles: vi.fn(),
  getPeople: vi.fn(),
  getSeasons: vi.fn(),
}));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getAdminScopeContext, canOperateAnyScope, canOperateSeason } from "@/lib/program-scope";
import { getMenteeProfiles, getMentorProfiles, getPeople, getSeasons } from "@/lib/data";
import {
  bulkAddEventParticipants,
  checkInForEvent,
  confirmEventRegistration,
  getEventDetailData,
  getEventListData,
  registerForEvent,
} from "@/lib/events";
import { SELECT_PAGE_SIZE } from "@/lib/paged-read";

// ── A PostgREST emulator that actually caps rows ──────────────────────────────

type Row = Record<string, any>;

type FakeOptions = {
  /** Server-side `db-max-rows`. No request may return more rows than this. */
  maxRows?: number;
  /** Make the Nth (1-based) select against `table` fail, to test later pages. */
  failSelect?: { table: string; call: number };
};

type FakeClient = {
  from: (table: string) => any;
  inserts: Array<{ table: string; rows: Row[] }>;
  updates: Array<{ table: string; values: Row; matched: number }>;
  selectCalls: Record<string, number>;
};

function makeFakeClient(tables: Record<string, Row[]>, options: FakeOptions = {}): FakeClient {
  const maxRows = options.maxRows ?? SELECT_PAGE_SIZE;
  const client: FakeClient = {
    inserts: [],
    updates: [],
    selectCalls: {},
    from(table: string) {
      const source = tables[table] ?? [];
      const filters: Array<(row: Row) => boolean> = [];
      const orderKeys: string[] = [];
      let rowLimit = Infinity;
      let mode: "select" | "insert" | "update" | "delete" = "select";
      let payload: Row[] = [];

      const matching = () => source.filter((row) => filters.every((keep) => keep(row)));

      function resolveSelect() {
        client.selectCalls[table] = (client.selectCalls[table] ?? 0) + 1;
        const fail = options.failSelect;
        if (fail && fail.table === table && client.selectCalls[table] === fail.call) {
          return { data: null, error: { message: `injected failure on ${table} select #${fail.call}` } };
        }
        let rows = matching();
        for (const key of [...orderKeys].reverse()) {
          rows = [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
        }
        // The cap is the whole point: a request never returns more than this,
        // and says nothing about having truncated.
        return { data: rows.slice(0, Math.min(rowLimit, maxRows)), error: null };
      }

      function resolve() {
        if (mode === "insert") {
          client.inserts.push({ table, rows: payload });
          const stamped = payload.map((row, index) => ({ id: `inserted-${index}`, ...row }));
          source.push(...stamped);
          return { data: stamped, error: null };
        }
        if (mode === "update") {
          const hit = matching();
          const values = payload[0] ?? {};
          for (const row of hit) Object.assign(row, values);
          client.updates.push({ table, values, matched: hit.length });
          return { data: hit, error: null };
        }
        if (mode === "delete") {
          return { data: matching(), error: null };
        }
        return resolveSelect();
      }

      const query: any = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters.push((row) => String(row[column] ?? "") === String(value));
          return query;
        },
        neq: (column: string, value: unknown) => {
          filters.push((row) => String(row[column] ?? "") !== String(value));
          return query;
        },
        gt: (column: string, value: unknown) => {
          filters.push((row) => String(row[column] ?? "") > String(value));
          return query;
        },
        in: (column: string, values: unknown[]) => {
          const allowed = new Set(values.map(String));
          filters.push((row) => allowed.has(String(row[column] ?? "")));
          return query;
        },
        ilike: (column: string, value: unknown) => {
          const needle = String(value).toLowerCase();
          filters.push((row) => String(row[column] ?? "").toLowerCase() === needle);
          return query;
        },
        order: (column: string) => {
          orderKeys.push(column);
          return query;
        },
        range: (from: number, to: number) => {
          filters.push(() => true);
          rowLimit = to - from + 1;
          return query;
        },
        limit: (n: number) => {
          rowLimit = n;
          return query;
        },
        insert: (rows: Row | Row[]) => {
          mode = "insert";
          payload = Array.isArray(rows) ? rows : [rows];
          return query;
        },
        update: (values: Row) => {
          mode = "update";
          payload = [values];
          return query;
        },
        delete: () => {
          mode = "delete";
          return query;
        },
        maybeSingle: () => {
          const result = resolve();
          const rows = (result.data ?? []) as Row[];
          return Promise.resolve({ data: rows[0] ?? null, error: result.error });
        },
        then: (onOk: any, onErr: any) => Promise.resolve(resolve()).then(onOk, onErr),
        catch: (onErr: any) => Promise.resolve(resolve()).catch(onErr),
      };
      return query;
    },
  };
  return client;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const EVENT_ID = "00000000-0000-4000-8000-0000000000e1";
const SEASON_ID = "00000000-0000-4000-8000-0000000000e2";
const TOKEN = "00000000-0000-4000-8000-0000000000e3";
const LINK_ID = "00000000-0000-4000-8000-0000000000e4";
const BATCH_ID = "00000000-0000-4000-8000-0000000000e5";
const TARGET_REG_ID = "00000000-0000-4000-8000-0000000000e6";

/** Ids are zero-padded so lexicographic keyset ordering matches creation order. */
const pad = (n: number) => String(n).padStart(7, "0");

/**
 * `bulkAddEventParticipants` drops any candidate whose person_id is not a valid
 * UUID, so these fixtures must be real UUIDs — a `person-0001` placeholder would
 * be filtered out before paging is ever exercised and the test would pass vacuously.
 */
const personUuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

function makeRegistrations(count: number, overrides: (index: number) => Row = () => ({})): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `reg-${pad(index)}`,
    event_id: EVENT_ID,
    email: `person${index}@example.com`,
    full_name: `Person ${index}`,
    registration_status: "registered",
    attendance_status: "pending",
    linked_person_id: null,
    is_walk_in: false,
    review_status: "not_required",
    registered_at: new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString(),
    ...overrides(index),
  }));
}

function makeParticipations(count: number, overrides: (index: number) => Row = () => ({})): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `par-${pad(index)}`,
    event_id: EVENT_ID,
    season_id: SEASON_ID,
    person_id: personUuid(index),
    role_at_event: "mentee",
    registration_status: "registered",
    attendance_status: "unknown",
    ...overrides(index),
  }));
}

function eventRow(overrides: Row = {}): Row {
  return {
    id: EVENT_ID,
    season_id: SEASON_ID,
    intake_batch_id: BATCH_ID,
    status: "scheduled",
    event_name: "Plenary",
    event_type: "workshop",
    starts_at: "2026-03-01T00:00:00.000Z",
    capacity_limit_enabled: false,
    capacity_limit: null,
    checkin_mode: "open",
    allow_walk_in: true,
    approval_required: false,
    waitlist_enabled: false,
    ...overrides,
  };
}

function linkRow(overrides: Row = {}): Row {
  return {
    id: LINK_ID,
    event_id: EVENT_ID,
    link_type: "registration",
    token: TOKEN,
    is_active: true,
    opens_at: null,
    closes_at: null,
    ...overrides,
  };
}

const emptyScopedLookup = { data: [], error: null };

beforeEach(() => {
  vi.resetAllMocks();
  (getCurrentAdminUser as Mock).mockResolvedValue({ id: "admin-1", email: "a@b.c", role: "super_admin" });
  (getAdminScopeContext as Mock).mockResolvedValue({ scope: "all" });
  (canOperateAnyScope as Mock).mockReturnValue(true);
  (canOperateSeason as Mock).mockResolvedValue(true);
  (getSeasons as Mock).mockResolvedValue(emptyScopedLookup);
  (getPeople as Mock).mockResolvedValue(emptyScopedLookup);
  (getMentorProfiles as Mock).mockResolvedValue(emptyScopedLookup);
  (getMenteeProfiles as Mock).mockResolvedValue(emptyScopedLookup);
});

// ── 0. The emulator itself must cap, or every assertion below is vacuous ──────

describe("test harness fidelity", () => {
  it("a single request never returns more rows than the server cap", async () => {
    const client = makeFakeClient({ event_registrations: makeRegistrations(2500) });
    const { data } = await client.from("event_registrations").select("*").eq("event_id", EVENT_ID);
    expect(data).toHaveLength(SELECT_PAGE_SIZE);
  });

  it("caps at a LOWER db-max-rows too, so stop-on-short-page cannot pass", async () => {
    const client = makeFakeClient({ event_registrations: makeRegistrations(2500) }, { maxRows: 400 });
    const { data } = await client.from("event_registrations").select("*").eq("event_id", EVENT_ID);
    expect(data).toHaveLength(400);
  });
});

// ── 1. Workspace registration totals across event ids ─────────────────────────

describe("getEventListData — registration totals across event ids", () => {
  it("BOUNDARY: totals span every event, not the first 1000 rows", async () => {
    const events = Array.from({ length: 3 }, (_, index) => ({
      ...eventRow(),
      id: `event-${pad(index)}`,
      legacy_event_temp_id: null,
      source_notes: null,
    }));
    const registrations = events.flatMap((event, eventIndex) =>
      Array.from({ length: 900 }, (_, index) => ({
        id: `reg-${pad(eventIndex * 1000 + index)}`,
        event_id: event.id,
        registration_status: "registered",
      }))
    );
    const client = makeFakeClient({ events, event_registrations: registrations, seasons: [], people: [] });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await getEventListData();

    expect(result.ok).toBe(true);
    expect(result.registrationRows).toHaveLength(2700);
    for (const event of events) {
      expect(result.registrationRows.filter((row) => row.event_id === event.id)).toHaveLength(900);
    }
  });

  it("BOUNDARY: a total of exactly the cap is not mistaken for exhaustion", async () => {
    const events = [{ ...eventRow(), id: "event-0000000", legacy_event_temp_id: null, source_notes: null }];
    const registrations = Array.from({ length: SELECT_PAGE_SIZE }, (_, index) => ({
      id: `reg-${pad(index)}`,
      event_id: "event-0000000",
      registration_status: "registered",
    }));
    const client = makeFakeClient({ events, event_registrations: registrations, seasons: [], people: [] });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await getEventListData();

    expect(result.ok).toBe(true);
    expect(result.registrationRows).toHaveLength(SELECT_PAGE_SIZE);
  });

  it("LATER-PAGE: a page-2 failure surfaces as an error, not a short list", async () => {
    const events = [{ ...eventRow(), id: "event-0000000", legacy_event_temp_id: null, source_notes: null }];
    const client = makeFakeClient(
      { events, event_registrations: makeRegistrations(2500, () => ({ event_id: "event-0000000" })), seasons: [], people: [] },
      { failSelect: { table: "event_registrations", call: 2 } }
    );
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await getEventListData();

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.registrationRows).toEqual([]);
  });
});

// ── 2 & 3. Per-event participations and registrations ─────────────────────────

describe("getEventDetailData — per-event participations and registrations", () => {
  it("BOUNDARY: the full roster and the full registration list are returned", async () => {
    const client = makeFakeClient({
      events: [eventRow()],
      event_participations: makeParticipations(1500),
      event_registrations: makeRegistrations(2500),
      event_links: [linkRow(), linkRow({ id: "link-checkin", link_type: "checkin" })],
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await getEventDetailData(EVENT_ID);

    expect(result.ok).toBe(true);
    expect(result.participations).toHaveLength(1500);
    expect(result.registrations).toHaveLength(2500);
    expect(result.registrationLink?.link_type).toBe("registration");
    expect(result.checkinLink?.link_type).toBe("checkin");
  });

  it("BOUNDARY: newest-first display order holds ACROSS pages, not within them", async () => {
    const client = makeFakeClient({
      events: [eventRow()],
      event_participations: [],
      event_registrations: makeRegistrations(2500),
      event_links: [],
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await getEventDetailData(EVENT_ID);

    // Newest row is the last-created one (index 2499), which keyset paging would
    // otherwise leave on the FINAL page. If ordering were re-applied per page,
    // the head of the list would be row 999 instead.
    expect(result.registrations[0]?.id).toBe(`reg-${pad(2499)}`);
    expect(result.registrations[result.registrations.length - 1]?.id).toBe(`reg-${pad(0)}`);
    const times = result.registrations.map((row) => Date.parse(String(row.registered_at)));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("BOUNDARY: the event filter is re-applied on every page", async () => {
    const client = makeFakeClient({
      events: [eventRow()],
      event_participations: [],
      event_registrations: [
        ...makeRegistrations(1500),
        ...makeRegistrations(1500, (index) => ({ id: `other-${pad(index)}`, event_id: "some-other-event" })),
      ],
      event_links: [],
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await getEventDetailData(EVENT_ID);

    expect(result.registrations).toHaveLength(1500);
    expect(result.registrations.every((row) => row.event_id === EVENT_ID)).toBe(true);
  });

  it("LATER-PAGE: a failed registrations page fails the load instead of shortening it", async () => {
    const client = makeFakeClient(
      {
        events: [eventRow()],
        event_participations: [],
        event_registrations: makeRegistrations(2500),
        event_links: [],
      },
      { failSelect: { table: "event_registrations", call: 2 } }
    );
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await getEventDetailData(EVENT_ID);

    expect(result.ok).toBe(false);
    expect(result.registrations).toEqual([]);
  });

  it("LATER-PAGE: a failed participations page fails the load", async () => {
    const client = makeFakeClient(
      {
        events: [eventRow()],
        event_participations: makeParticipations(2500),
        event_registrations: [],
        event_links: [],
      },
      { failSelect: { table: "event_participations", call: 2 } }
    );
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await getEventDetailData(EVENT_ID);

    expect(result.ok).toBe(false);
    expect(result.participations).toEqual([]);
  });
});

// ── 4. Public duplicate detection and capacity ────────────────────────────────

describe("registerForEvent — duplicate detection over the complete set", () => {
  function publicClient(registrations: Row[], event: Row = eventRow(), options: FakeOptions = {}) {
    return makeFakeClient(
      {
        event_links: [{ ...linkRow(), events: event }],
        event_registrations: registrations,
        people: [],
      },
      options
    );
  }

  const input = {
    token: TOKEN,
    full_name: "Late Comer",
    email: "person2400@example.com",
    consent_given: true,
  };

  it("BOUNDARY: a duplicate sitting past the cap is still detected — now overwritten, never re-inserted", async () => {
    // 16/09/2026 luật đổi: nộp lại là GHI ĐÈ đăng ký cũ, không còn là "đã đăng
    // ký rồi". Điều ca này canh vẫn y nguyên: đọc thiếu trang thì dòng cũ biến
    // mất khỏi phép kiểm, và hệ thống tạo thêm một dòng trùng cho cùng một người.
    const client = publicClient(makeRegistrations(2500));
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await registerForEvent(input);

    expect(result.status).toBe("success");
    expect(result.updated).toBe(true);
    expect(client.inserts).toEqual([]);
    expect(client.updates.some((write) => write.table === "event_registrations")).toBe(true);
  });

  it("BOUNDARY: capacity counts every seat, so a full event past the cap is refused", async () => {
    const client = publicClient(
      makeRegistrations(1500),
      eventRow({ capacity_limit_enabled: true, capacity_limit: 1200, waitlist_enabled: false })
    );
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await registerForEvent({ ...input, email: "brand-new@example.com" });

    expect(result.status).toBe("capacity_full");
    expect(client.inserts).toEqual([]);
  });

  it("BOUNDARY: a genuinely open event past the cap still accepts the registration", async () => {
    const client = publicClient(
      makeRegistrations(1500),
      eventRow({ capacity_limit_enabled: true, capacity_limit: 5000 })
    );
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await registerForEvent({ ...input, email: "brand-new@example.com" });

    expect(result.status).toBe("success");
    expect(client.inserts).toHaveLength(1);
  });

  it("LATER-PAGE: a failed page refuses the registration rather than writing on a prefix", async () => {
    const client = publicClient(makeRegistrations(2500), eventRow(), {
      failSelect: { table: "event_registrations", call: 2 },
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await registerForEvent({ ...input, email: "brand-new@example.com" });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("server_error");
    expect(client.inserts).toEqual([]);
  });
});

// ── 5. Public check-in over the complete registration list ────────────────────

describe("checkInForEvent — registrant lookup over the complete set", () => {
  function checkinClient(registrations: Row[], event: Row, options: FakeOptions = {}) {
    return makeFakeClient(
      {
        event_links: [{ ...linkRow(), link_type: "checkin", events: event }],
        events: [event],
        event_registrations: registrations,
        event_participations: [],
        people: [],
      },
      options
    );
  }

  it("BOUNDARY: a registrant past the cap is checked in, NOT recreated as a walk-in", async () => {
    const event = eventRow({ checkin_mode: "registration_required" });
    const client = checkinClient(makeRegistrations(2500), event);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await checkInForEvent({ token: TOKEN, email: "person2400@example.com" });

    expect(result.status).toBe("success");
    // A truncated read would have fallen through to the walk-in branch, which is
    // blocked in registration_required mode — so this would read "not_registered".
    expect(client.inserts).toEqual([]);
    expect(client.updates.some((write) => write.table === "event_registrations")).toBe(true);
  });

  it("BOUNDARY: walk-in capacity counts every active registration", async () => {
    const event = eventRow({ checkin_mode: "open", allow_walk_in: true, capacity_limit_enabled: true, capacity_limit: 1200 });
    const client = checkinClient(makeRegistrations(1500), event);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await checkInForEvent({ token: TOKEN, email: "walkin@example.com", full_name: "Walk In" });

    expect(result.status).toBe("event_full");
    expect(client.inserts).toEqual([]);
  });

  it("LATER-PAGE: a failed page refuses check-in and writes nothing", async () => {
    const event = eventRow({ checkin_mode: "open", allow_walk_in: true });
    const client = checkinClient(makeRegistrations(2500), event, {
      failSelect: { table: "event_registrations", call: 2 },
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await checkInForEvent({ token: TOKEN, email: "walkin@example.com", full_name: "Walk In" });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("server_error");
    expect(client.inserts).toEqual([]);
    expect(client.updates).toEqual([]);
  });
});

// ── 6. Admin confirmation capacity enforcement ────────────────────────────────

describe("confirmEventRegistration — capacity enforced on the complete count", () => {
  function confirmClient(consuming: number, capacity: number, options: FakeOptions = {}) {
    const registrations = [
      {
        id: TARGET_REG_ID,
        event_id: EVENT_ID,
        registration_status: "waitlisted",
        payment_status: null,
        proof_status: null,
        review_status: "pending",
        confirmed_at: null,
      },
      ...makeRegistrations(consuming, (index) => ({ id: `seat-${pad(index)}`, registration_status: "confirmed" })),
    ];
    return makeFakeClient(
      {
        event_registrations: registrations,
        events: [eventRow({ capacity_limit_enabled: true, capacity_limit: capacity })],
      },
      options
    );
  }

  const input = { event_id: EVENT_ID, registration_id: TARGET_REG_ID };

  it("BOUNDARY: 1500 confirmed seats against a 1200 limit is refused", async () => {
    const client = confirmClient(1500, 1200);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await confirmEventRegistration(input);

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/đủ chỗ/);
    expect(client.updates).toEqual([]);
  });

  it("BOUNDARY: genuine headroom past the cap still confirms", async () => {
    const client = confirmClient(1500, 5000);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await confirmEventRegistration(input);

    expect(result.ok).toBe(true);
    expect(client.updates.some((write) => write.table === "event_registrations")).toBe(true);
  });

  it("LATER-PAGE: a failed page refuses the confirmation and writes nothing", async () => {
    // Call #1 is the single-row registration lookup, #2 is capacity page 1.
    const client = confirmClient(1500, 5000, { failSelect: { table: "event_registrations", call: 3 } });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await confirmEventRegistration(input);

    expect(result.ok).toBe(false);
    expect(client.updates).toEqual([]);
  });
});

// ── 7 & 8. Bulk add: candidates and existing members ──────────────────────────

describe("bulkAddEventParticipants — candidates and existing members", () => {
  function bulkClient(profileCount: number, existing: Row[], options: FakeOptions = {}) {
    const profiles = Array.from({ length: profileCount }, (_, index) => ({
      id: `prof-${pad(index)}`,
      person_id: personUuid(index),
      intake_batch_id: BATCH_ID,
    }));
    return makeFakeClient(
      {
        events: [eventRow()],
        mentee_profiles: profiles,
        event_participations: existing,
      },
      options
    );
  }

  const input = { event_id: EVENT_ID, group: "approved_mentees_in_batch" };

  it("BOUNDARY: every candidate in a batch larger than the cap is added", async () => {
    const client = bulkClient(2200, []);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await bulkAddEventParticipants(input);

    expect(result.ok).toBe(true);
    expect(result.addedCount).toBe(2200);
    expect(client.inserts[0]?.rows).toHaveLength(2200);
  });

  it("BOUNDARY: an existing member past the cap is skipped, not re-inserted", async () => {
    // 1800 existing members; only the first 1000 would survive a truncated read.
    const existing = makeParticipations(1800);
    const client = bulkClient(1800, existing);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await bulkAddEventParticipants(input);

    expect(result.ok).toBe(true);
    expect(result.addedCount).toBe(0);
    expect(result.skippedCount).toBe(1800);
    // event_participations has no unique(event_id, person_id) constraint, so a
    // truncated read here would have silently duplicated 800 roster rows.
    expect(client.inserts).toEqual([]);
  });

  it("BOUNDARY: the new members past the cap are added and the old ones are not", async () => {
    const client = bulkClient(2000, makeParticipations(1500));
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await bulkAddEventParticipants(input);

    expect(result.addedCount).toBe(500);
    expect(result.skippedCount).toBe(1500);
    const inserted = (client.inserts[0]?.rows ?? []).map((row) => row.person_id);
    expect(inserted).toHaveLength(500);
    expect(inserted).toContain(personUuid(1999));
    expect(inserted).not.toContain(personUuid(0));
  });

  it("LATER-PAGE: a failed candidates page aborts before any insert", async () => {
    const client = bulkClient(2200, [], { failSelect: { table: "mentee_profiles", call: 2 } });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await bulkAddEventParticipants(input);

    expect(result.ok).toBe(false);
    expect(client.inserts).toEqual([]);
  });

  it("LATER-PAGE: a failed existing-members page aborts before any insert", async () => {
    const client = bulkClient(2200, makeParticipations(1800), {
      failSelect: { table: "event_participations", call: 2 },
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await bulkAddEventParticipants(input);

    expect(result.ok).toBe(false);
    expect(client.inserts).toEqual([]);
  });
});
