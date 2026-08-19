/**
 * Direct production tests for lib/mentee-dossier.ts — a mentor's expiring link
 * to their mentee's application.
 *
 * This is the alternative to putting a student's answers in an email body, so
 * the cases that matter are the refusals: a wrong token, an expired link, a
 * revoked one. Plus the counter, which is what makes "who opened this" a
 * question with an answer.
 *
 * Classification: DIRECT PRODUCTION TESTS (call actual production exports).
 */
import { vi, describe, it, expect, beforeEach, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(),
  canOperateSeason: vi.fn()
}));
vi.mock("@/lib/email", () => ({ resolveEmailBaseUrl: vi.fn(() => "https://vam.example.vn") }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { resolveEmailBaseUrl } from "@/lib/email";
import {
  buildDossierUrl,
  ensureDossierLinks,
  getDossierByToken,
  getDossierLinksForMentor,
  revokeDossierLink
} from "@/lib/mentee-dossier";

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
const SEASON = "00000000-0000-4000-8000-000000000b01";
const TOKEN = "00000000-0000-4000-8000-000000000c01";
const LINK = "00000000-0000-4000-8000-000000000c02";
const MENTOR = "00000000-0000-4000-8000-000000000d01";
const MENTEE = "00000000-0000-4000-8000-000000000d02";
const APP = "00000000-0000-4000-8000-000000000e01";

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

function linkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LINK,
    season_id: SEASON,
    mentor_person_id: MENTOR,
    mentee_application_id: APP,
    expires_at: FUTURE,
    revoked_at: null,
    view_count: 3,
    ...overrides
  };
}

function applicationRow() {
  return {
    id: APP,
    full_name: "Nguyễn Văn A",
    email_primary: "a@example.com",
    phone_primary: "0900000000",
    gender: "male",
    status: "approved_as_mentee",
    submitted_at: "2026-08-01",
    raw_payload: {
      target_industry: "Tài chính",
      mentoring_goals_text: "Muốn hiểu nghề",
      website: "bot-trap",
      apply_token: "secret-token"
    }
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  (getCurrentAdminUser as Mock).mockResolvedValue({
    id: ACTOR,
    email: "ops@example.com",
    role: "core_team",
    status: "active"
  });
  (getAdminScopeContext as Mock).mockResolvedValue({ isSuperAdmin: true });
  (canOperateSeason as Mock).mockResolvedValue(true);
  // resetAllMocks clears the factory implementation, so re-arm it here.
  (resolveEmailBaseUrl as Mock).mockReturnValue("https://vam.example.vn");
});

describe("buildDossierUrl", () => {
  it("builds the address the email carries", () => {
    expect(buildDossierUrl("https://vam.example.vn/", TOKEN)).toBe(
      `https://vam.example.vn/mentee-dossier/${TOKEN}`
    );
  });
});

// ── The public read ──────────────────────────────────────────────────────────

describe("getDossierByToken", () => {
  it("refuses a token that is not a token, without asking the database", async () => {
    const { client, tables } = makeClient({});
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    expect(await getDossierByToken("../../etc/passwd")).toEqual({ state: "not_found" });
    expect(await getDossierByToken("")).toEqual({ state: "not_found" });
    expect(tables).toHaveLength(0);
  });

  it("says not found for a token nobody issued", async () => {
    const { client } = makeClient({ mentee_dossier_links: [makeChain({ data: null })] });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    expect(await getDossierByToken(TOKEN)).toEqual({ state: "not_found" });
  });

  it("refuses a revoked link", async () => {
    const { client } = makeClient({
      mentee_dossier_links: [makeChain({ data: linkRow({ revoked_at: PAST }) })]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    expect(await getDossierByToken(TOKEN)).toEqual({ state: "revoked" });
  });

  it("refuses an expired link and says when it expired", async () => {
    const { client } = makeClient({
      mentee_dossier_links: [makeChain({ data: linkRow({ expires_at: PAST }) })]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const view = await getDossierByToken(TOKEN);
    expect(view.state).toBe("expired");
    if (view.state !== "expired") return;
    expect(view.expiresAt).toBe(PAST);
  });

  it("returns the dossier, names the mentor, and counts the visit", async () => {
    const touch = { payloads: [] as unknown[] };
    const { client } = makeClient({
      mentee_dossier_links: [makeChain({ data: linkRow() }), makeChain({}, touch)],
      applications: [makeChain({ data: applicationRow() })],
      people: [makeChain({ data: { full_name: "Trần Thị B" } })],
      seasons: [makeChain({ data: { code: "UEHM-S12", name: "Mùa 12" } })]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const view = await getDossierByToken(TOKEN);

    expect(view.state).toBe("ready");
    if (view.state !== "ready") return;
    expect(view.mentorName).toBe("Trần Thị B");
    expect(view.seasonLabel).toBe("UEHM-S12");
    expect(view.application.full_name).toBe("Nguyễn Văn A");

    const update = touch.payloads[0] as Record<string, unknown>;
    expect(update.view_count).toBe(4);
    expect(update.last_viewed_at).toBeTruthy();
  });

  it("leaves the form plumbing out of the dossier", async () => {
    const { client } = makeClient({
      mentee_dossier_links: [makeChain({ data: linkRow() }), makeChain({})],
      applications: [makeChain({ data: applicationRow() })],
      people: [makeChain({ data: { full_name: "Trần Thị B" } })],
      seasons: [makeChain({ data: { code: "UEHM-S12", name: null } })]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const view = await getDossierByToken(TOKEN);
    expect(view.state).toBe("ready");
    if (view.state !== "ready") return;

    const keys = view.application.answers.map(([key]) => key);
    expect(keys).toContain("target_industry");
    // The honeypot and the apply token are not part of what a mentor reads.
    expect(keys).not.toContain("website");
    expect(keys).not.toContain("apply_token");
  });
});

// ── Issuing the links ────────────────────────────────────────────────────────

describe("ensureDossierLinks", () => {
  it("refuses a reviewer", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: ACTOR, email: "m@example.com", role: "reviewer" });
    const { client, tables } = makeClient({});
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await ensureDossierLinks({ seasonId: SEASON });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("không có quyền");
    expect(tables).toHaveLength(0);
  });

  it("refuses an operator without scope on the season", async () => {
    (canOperateSeason as Mock).mockResolvedValue(false);
    const { client } = makeClient({});
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await ensureDossierLinks({ seasonId: SEASON });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("vận hành mùa này");
  });

  it("creates one link per pair, with an expiry", async () => {
    const insert = { payloads: [] as unknown[] };
    const { client } = makeClient({
      matches: [makeChain({ data: [{ id: "m1", mentor_person_id: MENTOR, mentee_person_id: MENTEE }] })],
      applications: [makeChain({ data: [{ id: APP, person_id: MENTEE, submitted_at: "2026-08-01" }] })],
      mentee_dossier_links: [makeChain({ data: [] }), makeChain({}, insert)]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await ensureDossierLinks({ seasonId: SEASON, ttlDays: 30 });

    expect(result.ok).toBe(true);
    expect(result.created).toBe(1);

    const rows = insert.payloads[0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].mentor_person_id).toBe(MENTOR);
    expect(rows[0].mentee_application_id).toBe(APP);
    expect(new Date(String(rows[0].expires_at)).getTime()).toBeGreaterThan(Date.now());
  });

  it("does not create a second link for a pair that already has one", async () => {
    const insert = { payloads: [] as unknown[] };
    const { client } = makeClient({
      matches: [makeChain({ data: [{ id: "m1", mentor_person_id: MENTOR, mentee_person_id: MENTEE }] })],
      applications: [makeChain({ data: [{ id: APP, person_id: MENTEE }] })],
      mentee_dossier_links: [
        makeChain({ data: [{ mentor_person_id: MENTOR, mentee_application_id: APP }] }),
        makeChain({}, insert)
      ]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await ensureDossierLinks({ seasonId: SEASON });

    expect(result.ok).toBe(true);
    expect(result.created).toBe(0);
    expect(insert.payloads).toHaveLength(0);
  });

  it("reports the pairs whose mentee has no application to show", async () => {
    const { client } = makeClient({
      matches: [makeChain({ data: [{ id: "m1", mentor_person_id: MENTOR, mentee_person_id: MENTEE }] })],
      applications: [makeChain({ data: [] })],
      mentee_dossier_links: [makeChain({ data: [] })]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await ensureDossierLinks({ seasonId: SEASON });

    expect(result.ok).toBe(true);
    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("says so when the season has no active pair yet", async () => {
    const { client } = makeClient({ matches: [makeChain({ data: [] })] });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await ensureDossierLinks({ seasonId: SEASON });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("chưa có cặp ghép");
  });
});

describe("getDossierLinksForMentor", () => {
  it("returns usable links only", async () => {
    const { client } = makeClient({
      mentee_dossier_links: [
        makeChain({
          data: [
            { token: TOKEN, mentee_application_id: APP, expires_at: FUTURE },
            { token: "00000000-0000-4000-8000-0000000000ff", mentee_application_id: "other", expires_at: PAST }
          ]
        })
      ]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const links = await getDossierLinksForMentor({ seasonId: SEASON, mentorPersonId: MENTOR });

    expect(links).toHaveLength(1);
    expect(links[0].url).toContain(TOKEN);
  });
});

describe("revokeDossierLink", () => {
  it("stops the link working, and says so when it was already revoked", async () => {
    const update = { payloads: [] as unknown[] };
    const { client } = makeClient({
      mentee_dossier_links: [
        makeChain({ data: { id: LINK, season_id: SEASON, revoked_at: null } }),
        makeChain({}, update)
      ]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await revokeDossierLink({ linkId: LINK });
    expect(result.ok).toBe(true);
    expect((update.payloads[0] as Record<string, unknown>).revoked_at).toBeTruthy();

    const { client: second } = makeClient({
      mentee_dossier_links: [makeChain({ data: { id: LINK, season_id: SEASON, revoked_at: PAST } })]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(second);
    const again = await revokeDossierLink({ linkId: LINK });
    expect(again.ok).toBe(true);
    expect(again.message).toContain("đã được thu hồi");
  });

  it("refuses a reviewer", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: ACTOR, email: "m@example.com", role: "reviewer" });
    const { client } = makeClient({
      mentee_dossier_links: [makeChain({ data: { id: LINK, season_id: SEASON, revoked_at: null } })]
    });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await revokeDossierLink({ linkId: LINK });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("không có quyền");
  });
});
