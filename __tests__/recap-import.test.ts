/**
 * Direct production tests for lib/recap-import.ts — receiving collected posts,
 * identifying the mentee, and turning approved posts into recaps.
 *
 * The cases that matter are the ones that decide whether the record stays
 * trustworthy: a post never enters twice, a guess never becomes a match, and
 * nothing reaches `mentoring_recaps` without a person approving it.
 *
 * Classification: DIRECT PRODUCTION TESTS (call actual production exports).
 */
import { vi, describe, it, expect, beforeEach, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(),
  canOperateAnyScope: vi.fn()
}));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canOperateAnyScope, getAdminScopeContext } from "@/lib/program-scope";
import {
  approveImportItems,
  assignImportItem,
  getRecapImportView,
  receiveImportBatch,
  skipImportItems
} from "@/lib/recap-import";

// ── Mock helpers ──────────────────────────────────────────────────────────────

type ChainResult = { data?: unknown; error?: unknown };

function makeChain(result: ChainResult = {}, capture?: { payloads: unknown[] }) {
  const resolved = Promise.resolve({ data: null, error: null, ...result });
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const method of ["select", "eq", "neq", "in", "is", "order", "limit"]) chain[method] = self;
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

const ACTOR = "00000000-0000-4000-8000-000000000a01";
const BATCH = "00000000-0000-4000-8000-000000000b01";
const SEASON = "00000000-0000-4000-8000-000000000b02";
const MATCH = "00000000-0000-4000-8000-000000000b03";
const MENTEE = "00000000-0000-4000-8000-000000000d01";
const MENTOR = "00000000-0000-4000-8000-000000000d02";
const ITEM = "00000000-0000-4000-8000-000000000e01";
const RECAP = "00000000-0000-4000-8000-000000000f01";

const POST = "https://www.facebook.com/groups/123456789/posts/1";

const CONTENT = [
  "#UEHEM11104 #mentoring",
  "[RECAP BUỔI 3 - 14/03/2026]",
  "Mentor: Nguyễn Văn A",
  "Mentee: Trần Thị B",
  "Nội dung buổi gặp..."
].join("\n");

function payload(items: Array<Record<string, unknown>>) {
  return { group_id: "123456789", items };
}

function onePost(permalink = POST, content = CONTENT) {
  return { permalink, content, author_name: "Trần Thị B", posted_at: "2026-03-16T12:00:00Z" };
}

function asOperator(role = "core_team") {
  (getCurrentAdminUser as Mock).mockResolvedValue({
    id: ACTOR,
    email: "btc@vam.vn",
    full_name: "Điều phối viên",
    role
  });
  (getAdminScopeContext as Mock).mockResolvedValue({ role, entries: [] });
  (canOperateAnyScope as Mock).mockReturnValue(true);
}

beforeEach(() => {
  vi.resetAllMocks();
  asOperator();
});

// ── Receiving ─────────────────────────────────────────────────────────────────

describe("receiveImportBatch — one post, one row", () => {
  it("stages new posts and reports what it did", async () => {
    const batchInserts = { payloads: [] as unknown[] };
    const itemInserts = { payloads: [] as unknown[] };

    const { client } = makeClient({
      // Dedupe: nothing known yet, from either source.
      recap_import_items: [
        makeChain({ data: [] }), // dedupe lookup
        makeChain({}, itemInserts), // insert
        makeChain({ data: [{ id: ITEM, mssv_raw: "UEHEM11104", meeting_date: "2026-03-14" }] }), // matching load
        makeChain({}) // matching update
      ],
      mentoring_recaps: [makeChain({ data: [] })],
      recap_import_batches: [makeChain({ data: { id: BATCH } }, batchInserts), makeChain({})],
      mentee_profiles: [makeChain({ data: [{ person_id: MENTEE, mssv: "UEHEM11104", mentee_code: null }] })],
      matches: [
        makeChain({
          data: [{ id: MATCH, season_id: SEASON, mentor_person_id: MENTOR, mentee_person_id: MENTEE }]
        })
      ]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await receiveImportBatch({ payload: payload([onePost()]) });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.received).toBe(1);
    expect(result.duplicates).toBe(0);
    expect(result.matched).toBe(1);

    const staged = (itemInserts.payloads[0] as Array<Record<string, unknown>>)[0];
    expect(staged.permalink).toBe(POST);
    // Staged, never imported — approval is a separate, human step.
    expect(staged.status).toBe("pending");
    // The date in the header wins over the day it was posted.
    expect(staged.meeting_date).toBe("2026-03-14");
  });

  it("refuses a batch whose posts have all been collected before", async () => {
    const { client, tables } = makeClient({
      recap_import_items: [makeChain({ data: [{ permalink: POST }] })],
      mentoring_recaps: [makeChain({ data: [] })]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await receiveImportBatch({ payload: payload([onePost()]) });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("đã được thu thập");
    // Nothing was opened, so a repeated scan leaves no empty batches behind.
    expect(tables).not.toContain("recap_import_batches");
  });

  it("treats a post already imported as a recap as collected", async () => {
    const { client, tables } = makeClient({
      recap_import_items: [makeChain({ data: [] })],
      mentoring_recaps: [makeChain({ data: [{ recap_url: POST }] })]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await receiveImportBatch({ payload: payload([onePost()]) });

    expect(result.ok).toBe(false);
    expect(tables).not.toContain("recap_import_batches");
  });

  it("rejects a malformed payload before touching the database", async () => {
    const { client } = makeClient({});
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await receiveImportBatch({ payload: { group_id: "", items: [] } });

    expect(result.ok).toBe(false);
    expect(getSupabaseServiceRoleClient).not.toHaveBeenCalled();
  });
});

// ── Matching ──────────────────────────────────────────────────────────────────

describe("matching — the student id, or a person", () => {
  async function receiveWith(options: {
    profiles: unknown[];
    matches: unknown[];
    mssv?: string | null;
  }) {
    const updates = { payloads: [] as unknown[] };
    const { client } = makeClient({
      recap_import_items: [
        makeChain({ data: [] }),
        makeChain({}),
        // "in" rather than ??: passing mssv: null must mean "the post had none".
        makeChain({
          data: [
            {
              id: ITEM,
              mssv_raw: "mssv" in options ? options.mssv : "UEHEM11104",
              meeting_date: "2026-03-14"
            }
          ]
        }),
        makeChain({}, updates)
      ],
      mentoring_recaps: [makeChain({ data: [] })],
      recap_import_batches: [makeChain({ data: { id: BATCH } }), makeChain({})],
      mentee_profiles: [makeChain({ data: options.profiles })],
      matches: [makeChain({ data: options.matches })]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await receiveImportBatch({ payload: payload([onePost()]) });
    return { result, update: updates.payloads[0] as Record<string, unknown> | undefined };
  }

  it("matches on the student id and files the recap in the pair's own season", async () => {
    const { result, update } = await receiveWith({
      profiles: [{ person_id: MENTEE, mssv: "UEHEM11104", mentee_code: null }],
      matches: [{ id: MATCH, season_id: SEASON, mentor_person_id: MENTOR, mentee_person_id: MENTEE }]
    });

    expect(result.ok && result.matched).toBe(1);
    expect(update).toMatchObject({
      status: "matched",
      match_confidence: "mssv",
      season_id: SEASON,
      mentee_person_id: MENTEE,
      mentor_person_id: MENTOR,
      match_id: MATCH
    });
  });

  it("accepts the programme code as well as the student id", async () => {
    const { result } = await receiveWith({
      profiles: [{ person_id: MENTEE, mssv: null, mentee_code: "UEHEM11104" }],
      matches: [{ id: MATCH, season_id: SEASON, mentor_person_id: MENTOR, mentee_person_id: MENTEE }]
    });

    expect(result.ok && result.matched).toBe(1);
  });

  it("asks a person when the post carries no student id", async () => {
    const { result, update } = await receiveWith({
      profiles: [{ person_id: MENTEE, mssv: "UEHEM11104", mentee_code: null }],
      matches: [{ id: MATCH, season_id: SEASON, mentor_person_id: MENTOR, mentee_person_id: MENTEE }],
      mssv: null
    });

    expect(result.ok && result.needsReview).toBe(1);
    expect(update).toMatchObject({ status: "needs_review", match_confidence: "none" });
    expect(update).not.toHaveProperty("match_id");
  });

  it("refuses to choose when a mentee has two active pairs", async () => {
    const { result, update } = await receiveWith({
      profiles: [{ person_id: MENTEE, mssv: "UEHEM11104", mentee_code: null }],
      matches: [
        { id: MATCH, season_id: SEASON, mentor_person_id: MENTOR, mentee_person_id: MENTEE },
        { id: "other", season_id: SEASON, mentor_person_id: "someone", mentee_person_id: MENTEE }
      ]
    });

    expect(result.ok && result.needsReview).toBe(1);
    expect(update).toMatchObject({ status: "needs_review" });
  });

  it("still surfaces a known mentee who has no pair on file", async () => {
    const { result, update } = await receiveWith({
      profiles: [{ person_id: MENTEE, mssv: "UEHEM11104", mentee_code: null }],
      matches: []
    });

    expect(result.ok && result.needsReview).toBe(1);
    expect(update).toMatchObject({ status: "needs_review", mentee_person_id: MENTEE });
  });
});

// ── Approving ─────────────────────────────────────────────────────────────────

describe("approveImportItems — the only path into mentoring_recaps", () => {
  function stagedItem(overrides: Record<string, unknown> = {}) {
    return {
      id: ITEM,
      batch_id: BATCH,
      permalink: POST,
      meeting_date: "2026-03-14",
      meeting_type: "1on1_primary",
      content_full: CONTENT,
      season_id: SEASON,
      mentee_person_id: MENTEE,
      mentor_person_id: MENTOR,
      match_id: MATCH,
      status: "matched",
      ...overrides
    };
  }

  it("writes a recap carrying the real permalink", async () => {
    const recapInserts = { payloads: [] as unknown[] };
    const { client } = makeClient({
      recap_import_items: [
        makeChain({ data: [stagedItem()] }),
        makeChain({}),
        makeChain({ data: [{ status: "imported" }] })
      ],
      mentoring_recaps: [makeChain({ data: { id: RECAP } }, recapInserts)],
      recap_import_batches: [makeChain({})]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await approveImportItems({ itemIds: [ITEM] });

    expect(result.ok).toBe(true);
    const recap = recapInserts.payloads[0] as Record<string, unknown>;
    // The whole point of this work package: the link back to the post survives.
    expect(recap.recap_url).toBe(POST);
    expect(recap.recap_source).toBe("facebook_group");
    expect(recap.meeting_month).toBe("2026-03");
    expect(recap.meeting_type).toBe("1on1_primary");
    expect(recap.status).toBe("submitted");
    expect(recap.captured_by).toBe("Điều phối viên");
  });

  it("refuses an item with no meeting date rather than inventing one", async () => {
    const { client, tables } = makeClient({
      recap_import_items: [makeChain({ data: [stagedItem({ meeting_date: null })] })],
      recap_import_batches: [makeChain({})]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await approveImportItems({ itemIds: [ITEM] });

    expect(result.ok).toBe(false);
    expect(tables).not.toContain("mentoring_recaps");
  });

  it("refuses an item whose mentee is still unknown", async () => {
    const { client, tables } = makeClient({
      recap_import_items: [makeChain({ data: [stagedItem({ mentee_person_id: null })] })],
      recap_import_batches: [makeChain({})]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await approveImportItems({ itemIds: [ITEM] });

    expect(result.ok).toBe(false);
    expect(tables).not.toContain("mentoring_recaps");
  });

  it("skips an item that was already imported", async () => {
    const { client, tables } = makeClient({
      recap_import_items: [makeChain({ data: [stagedItem({ status: "imported" })] })],
      recap_import_batches: [makeChain({})]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await approveImportItems({ itemIds: [ITEM] });

    expect(result.ok).toBe(false);
    expect(tables).not.toContain("mentoring_recaps");
  });

  it("ignores anything that is not an id", async () => {
    const result = await approveImportItems({ itemIds: ["", "not-a-uuid", "  "] });
    expect(result.ok).toBe(false);
    expect(getSupabaseServiceRoleClient).not.toHaveBeenCalled();
  });
});

// ── Who may do this ───────────────────────────────────────────────────────────

describe("authorization", () => {
  const guarded: Array<[string, () => Promise<{ ok: boolean; message: string }>]> = [
    ["approve", () => approveImportItems({ itemIds: [ITEM] })],
    ["skip", () => skipImportItems({ itemIds: [ITEM] })],
    ["assign", () => assignImportItem({ itemId: ITEM, menteePersonId: MENTEE })]
  ];

  it.each(guarded)("refuses %s to a viewer", async (_label, call) => {
    asOperator("viewer");
    const { client } = makeClient({});
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await call();

    expect(result.ok).toBe(false);
    expect(result.message).toContain("không có quyền");
    expect(getSupabaseServiceRoleClient).not.toHaveBeenCalled();
  });

  it.each(guarded)("refuses %s to a signed-out visitor", async (_label, call) => {
    (getCurrentAdminUser as Mock).mockResolvedValue(null);
    const result = await call();
    expect(result.ok).toBe(false);
    expect(getSupabaseServiceRoleClient).not.toHaveBeenCalled();
  });

  it.each(guarded)("refuses %s to an admin with no operating scope", async (_label, call) => {
    asOperator("core_team");
    (canOperateAnyScope as Mock).mockReturnValue(false);

    const result = await call();

    expect(result.ok).toBe(false);
    expect(getSupabaseServiceRoleClient).not.toHaveBeenCalled();
  });

  it("hides the review screen from a role that cannot edit recaps", async () => {
    asOperator("reviewer");
    const view = await getRecapImportView({ batchId: null });
    expect(view.ok).toBe(false);
    expect(view.batches).toEqual([]);
  });
});

// ── Manual assignment ─────────────────────────────────────────────────────────

describe("assignImportItem — when a person decides", () => {
  it("records the decision as manual, never as a match the code found", async () => {
    const updates = { payloads: [] as unknown[] };
    const { client } = makeClient({
      matches: [
        makeChain({
          data: [{ id: MATCH, season_id: SEASON, mentor_person_id: MENTOR, mentee_person_id: MENTEE }]
        })
      ],
      recap_import_items: [makeChain({}, updates)]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await assignImportItem({ itemId: ITEM, menteePersonId: MENTEE });

    expect(result.ok).toBe(true);
    expect(updates.payloads[0]).toMatchObject({
      mentee_person_id: MENTEE,
      match_id: MATCH,
      match_confidence: "manual",
      status: "matched"
    });
  });

  it("says so plainly when the mentee has no pair to attach", async () => {
    const { client } = makeClient({
      matches: [makeChain({ data: [] })],
      seasons: [makeChain({ data: { id: SEASON } })],
      recap_import_items: [makeChain({})]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await assignImportItem({ itemId: ITEM, menteePersonId: MENTEE });

    expect(result.ok).toBe(true);
    expect(result.message).toContain("chưa có cặp ghép");
  });

  it("refuses an id that is not an id", async () => {
    const result = await assignImportItem({ itemId: "nope", menteePersonId: MENTEE });
    expect(result.ok).toBe(false);
    expect(getSupabaseServiceRoleClient).not.toHaveBeenCalled();
  });
});
