/**
 * Direct production tests for lib/post-match-emails.ts — the four sends that
 * close recruitment.
 *
 * Three rules are worth more than the rest, and each has its own case: a send
 * needs an APPROVED template, nobody is written to TWICE, and stage two WAITS
 * until every selected mentee has a mentor.
 *
 * Classification: DIRECT PRODUCTION TESTS (call actual production exports).
 */
import { vi, describe, it, expect, beforeEach, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(),
  canOperateSeason: vi.fn(),
  canReadSeason: vi.fn()
}));
vi.mock("@/lib/email", () => ({ sendTemplatedEmail: vi.fn() }));
vi.mock("@/lib/email-templates", () => ({ getApprovedTemplate: vi.fn() }));
vi.mock("@/lib/program-documents", () => ({ getDocumentLinks: vi.fn() }));
vi.mock("@/lib/mentee-dossier", () => ({
  ensureDossierLinks: vi.fn(),
  getDossierLinksForMentor: vi.fn()
}));
vi.mock("@/lib/ai-provider", () => ({ callProvider: vi.fn(), getProviderConfig: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canOperateSeason, canReadSeason, getAdminScopeContext } from "@/lib/program-scope";
import { sendTemplatedEmail } from "@/lib/email";
import { getApprovedTemplate } from "@/lib/email-templates";
import { getDocumentLinks } from "@/lib/program-documents";
import { ensureDossierLinks, getDossierLinksForMentor } from "@/lib/mentee-dossier";
import {
  getCommunicationReadiness,
  MAX_PER_BATCH,
  sendMenteeMentorIntroBatch,
  sendMenteeSelectedBatch,
  sendMentorPackageBatch
} from "@/lib/post-match-emails";

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
const MENTOR = "00000000-0000-4000-8000-000000000c01";
const MENTEE_A = "00000000-0000-4000-8000-000000000c02";
const MENTEE_B = "00000000-0000-4000-8000-000000000c03";
const APP_A = "00000000-0000-4000-8000-000000000d01";
const APP_B = "00000000-0000-4000-8000-000000000d02";

const READY_LINKS = {
  codeOfConduct: "https://vam.example.vn/documents/uehm-s12-mentee-quy-tac-ung-xu",
  tips: "https://vam.example.vn/documents/uehm-s12-mentee-cam-nang",
  missing: [] as never[]
};

function approvedTemplate(kind: string) {
  const bodies: Record<string, { subject: string; body: string }> = {
    mentee_selected: {
      subject: "Chúc mừng {{ten_mentee}}",
      body: "Chào {{ten_mentee}}, mùa {{mua}}.\n{{link_quy_tac_ung_xu}}\n{{link_cam_nang}}"
    },
    mentee_mentor_intro: {
      subject: "Mentor của bạn — {{mua}}",
      body:
        "Chào {{ten_mentee}}, mentor của bạn là {{ten_mentor}}.\n{{gioi_thieu_mentor}}\n{{link_quy_tac_ung_xu}}\n{{link_cam_nang}}"
    },
    mentor_mentee_package: {
      subject: "{{so_luong_mentee}} mentee của anh/chị",
      body:
        "Kính gửi {{ten_mentor}}, mùa {{mua}}: {{danh_sach_mentee}}.\n{{link_ho_so}}\n{{link_quy_tac_ung_xu}}\n{{link_cam_nang}}"
    }
  };
  return { id: `tpl-${kind}`, kind, status: "approved", ...bodies[kind] };
}

/** The season row, the mentee applications and the send log. */
function stageOneTables(options: {
  applications?: unknown[];
  alreadySent?: unknown[];
  batchInsert?: { payloads: unknown[] };
}) {
  return {
    seasons: [makeChain({ data: { code: "UEHM-S12", name: "Mùa 12" } })],
    applications: [
      makeChain({
        data:
          options.applications ?? [
            { id: APP_A, full_name: "Nguyễn Văn A", email_primary: "a@example.com" },
            { id: APP_B, full_name: "Lê Thị B", email_primary: "b@example.com" }
          ]
      })
    ],
    outbound_emails: [makeChain({ data: options.alreadySent ?? [] })],
    email_batches: [makeChain({ data: { id: "batch-1" } }, options.batchInsert), makeChain({})]
  };
}

/** The five reads getCommunicationReadiness makes, in one place. */
function readinessTables(options: {
  matches?: unknown[];
  applications?: unknown[];
  confirmations?: unknown[];
  sent?: unknown[];
}) {
  return {
    seasons: [makeChain({ data: { code: "UEHM-S12", name: "Mùa 12" } })],
    matches: [
      makeChain({
        data: options.matches ?? [{ mentor_person_id: MENTOR, mentee_person_id: MENTEE_A }]
      })
    ],
    applications: [
      makeChain({
        data:
          options.applications ?? [
            { id: APP_A, person_id: MENTEE_A, status: "approved_as_mentee" }
          ]
      })
    ],
    mentor_season_confirmations: [
      makeChain({ data: options.confirmations ?? [{ person_id: MENTOR, bio_short: "8 năm tài chính." }] })
    ],
    outbound_emails: [makeChain({ data: options.sent ?? [] })]
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  (getCurrentAdminUser as Mock).mockResolvedValue({
    id: ACTOR,
    email: "ops@example.com",
    full_name: "Ops",
    role: "core_team",
    status: "active"
  });
  (getAdminScopeContext as Mock).mockResolvedValue({ isSuperAdmin: true });
  (canOperateSeason as Mock).mockResolvedValue(true);
  (canReadSeason as Mock).mockResolvedValue(true);
  (getDocumentLinks as Mock).mockResolvedValue(READY_LINKS);
  (getApprovedTemplate as Mock).mockImplementation(async ({ kind }: { kind: string }) =>
    approvedTemplate(kind).subject ? approvedTemplate(kind) : null
  );
  (sendTemplatedEmail as Mock).mockResolvedValue({ ok: true, skipped: false });
  (ensureDossierLinks as Mock).mockResolvedValue({ ok: true, message: "ok", created: 0 });
  (getDossierLinksForMentor as Mock).mockResolvedValue([
    { url: "https://vam.example.vn/mentee-dossier/abc", applicationId: APP_A }
  ]);
});

// ── Authorization ─────────────────────────────────────────────────────────────

describe("sendMenteeSelectedBatch — who may send", () => {
  it("refuses support_team: mailing a cohort is not a phone-call task", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({
      id: ACTOR,
      email: "s@example.com",
      role: "support_team"
    });
    const { client, tables } = makeClient({});
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await sendMenteeSelectedBatch({ seasonId: SEASON });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("không có quyền");
    expect(tables).toHaveLength(0);
    expect(sendTemplatedEmail).not.toHaveBeenCalled();
  });

  it("refuses an operator without scope on the season", async () => {
    (canOperateSeason as Mock).mockResolvedValue(false);
    const { client } = makeClient({});
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await sendMenteeSelectedBatch({ seasonId: SEASON });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("vận hành mùa này");
  });

  it("rejects a malformed season id", async () => {
    const { client, tables } = makeClient({});
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await sendMenteeSelectedBatch({ seasonId: "not-a-uuid" });
    expect(result.ok).toBe(false);
    expect(tables).toHaveLength(0);
  });
});

// ── An approved template or nothing ──────────────────────────────────────────

describe("sendMenteeSelectedBatch — preconditions", () => {
  it("refuses when no template has been approved", async () => {
    (getApprovedTemplate as Mock).mockResolvedValue(null);
    const { client } = makeClient(stageOneTables({}));
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await sendMenteeSelectedBatch({ seasonId: SEASON });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("mẫu thư đã duyệt");
    expect(sendTemplatedEmail).not.toHaveBeenCalled();
  });

  it("refuses when the documents the letter links to are not published", async () => {
    (getDocumentLinks as Mock).mockResolvedValue({
      codeOfConduct: null,
      tips: null,
      missing: ["code_of_conduct", "tips"]
    });
    const { client } = makeClient(stageOneTables({}));
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await sendMenteeSelectedBatch({ seasonId: SEASON });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Tài liệu cho mentee");
    expect(sendTemplatedEmail).not.toHaveBeenCalled();
  });
});

// ── The send itself ──────────────────────────────────────────────────────────

describe("sendMenteeSelectedBatch — sending", () => {
  it("sends one filled-in message per mentee, addressed to their application", async () => {
    const { client } = makeClient(stageOneTables({}));
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await sendMenteeSelectedBatch({ seasonId: SEASON });

    expect(result.ok).toBe(true);
    expect(result.sent).toBe(2);
    expect(sendTemplatedEmail).toHaveBeenCalledTimes(2);

    const [first] = (sendTemplatedEmail as Mock).mock.calls[0] as [Record<string, unknown>];
    expect(first.kind).toBe("mentee_selected");
    expect(first.toEmail).toBe("a@example.com");
    expect(first.subject).toBe("Chúc mừng Nguyễn Văn A");
    expect(String(first.body)).toContain("UEHM-S12");
    expect(String(first.body)).toContain(READY_LINKS.codeOfConduct);
    // No placeholder survives into a message.
    expect(String(first.body)).not.toContain("{{");
    expect(first.relation).toEqual({ table: "applications", id: APP_A });
    expect(first.batchId).toBe("batch-1");
  });

  it("does not write to somebody who already received this letter", async () => {
    const { client } = makeClient(
      stageOneTables({ alreadySent: [{ related_id: APP_A }] })
    );
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await sendMenteeSelectedBatch({ seasonId: SEASON });

    expect(result.sent).toBe(1);
    const [only] = (sendTemplatedEmail as Mock).mock.calls[0] as [Record<string, unknown>];
    expect(only.toEmail).toBe("b@example.com");
  });

  it("says so when everybody has already been written to", async () => {
    const { client } = makeClient(
      stageOneTables({ alreadySent: [{ related_id: APP_A }, { related_id: APP_B }] })
    );
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await sendMenteeSelectedBatch({ seasonId: SEASON });

    expect(result.ok).toBe(true);
    expect(result.sent).toBe(0);
    expect(result.message).toContain("đã nhận thư");
    expect(sendTemplatedEmail).not.toHaveBeenCalled();
  });

  it("stops at the requested size and reports what is left", async () => {
    const { client } = makeClient(stageOneTables({}));
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await sendMenteeSelectedBatch({ seasonId: SEASON, limit: 1 });

    expect(result.sent).toBe(1);
    expect(result.remaining).toBe(1);
    expect(result.message).toContain("còn 1 người");
  });

  it("never sends more than the batch ceiling, whatever is asked for", async () => {
    const many = Array.from({ length: MAX_PER_BATCH + 5 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      full_name: `Ứng viên ${index}`,
      email_primary: `c${index}@example.com`
    }));
    const { client } = makeClient(stageOneTables({ applications: many }));
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await sendMenteeSelectedBatch({ seasonId: SEASON, limit: 500 });

    expect(result.sent).toBe(MAX_PER_BATCH);
    expect(result.remaining).toBe(5);
  });

  it("counts a send suppressed by configuration separately from a failure", async () => {
    (sendTemplatedEmail as Mock)
      .mockResolvedValueOnce({ ok: true, skipped: true, reason: "VAM_OS_EMAIL_ENABLED chưa bật" })
      .mockResolvedValueOnce({ ok: false, skipped: false, reason: "bounce" });
    const { client } = makeClient(stageOneTables({}));
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await sendMenteeSelectedBatch({ seasonId: SEASON });

    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(1);
  });
});

// ── Stage two waits ──────────────────────────────────────────────────────────

describe("stage two is locked until everybody has a mentor", () => {
  it("refuses the mentor introduction while a mentee is still unmatched", async () => {
    const { client } = makeClient(
      readinessTables({
        matches: [{ mentor_person_id: MENTOR, mentee_person_id: MENTEE_A }],
        applications: [
          { id: APP_A, person_id: MENTEE_A, status: "approved_as_mentee" },
          { id: APP_B, person_id: MENTEE_B, status: "interview_completed" }
        ]
      })
    );
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await sendMenteeMentorIntroBatch({ seasonId: SEASON });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("chưa có mentor");
    expect(sendTemplatedEmail).not.toHaveBeenCalled();
  });

  it("refuses the mentor package for the same reason", async () => {
    const { client } = makeClient(
      readinessTables({
        applications: [
          { id: APP_A, person_id: MENTEE_A, status: "approved_as_mentee" },
          { id: APP_B, person_id: MENTEE_B, status: "approved_as_mentee" }
        ]
      })
    );
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await sendMentorPackageBatch({ seasonId: SEASON });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("chưa có mentor");
    expect(ensureDossierLinks).not.toHaveBeenCalled();
  });
});

// ── Readiness ────────────────────────────────────────────────────────────────

describe("getCommunicationReadiness", () => {
  it("reports the gate as open when every selected mentee has a mentor", async () => {
    const { client } = makeClient(readinessTables({}));
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const readiness = await getCommunicationReadiness({ seasonId: SEASON });

    expect(readiness.ok).toBe(true);
    expect(readiness.everybodyMatched).toBe(true);
    expect(readiness.menteesWaiting).toBe(0);
    expect(readiness.activePairs).toBe(1);
    expect(readiness.seasonLabel).toBe("UEHM-S12");
  });

  it("names the blockers instead of only disabling a button", async () => {
    (getApprovedTemplate as Mock).mockResolvedValue(null);
    (getDocumentLinks as Mock).mockResolvedValue({
      codeOfConduct: null,
      tips: null,
      missing: ["tips"]
    });
    const { client } = makeClient(
      readinessTables({
        applications: [
          { id: APP_A, person_id: MENTEE_A, status: "approved_as_mentee" },
          { id: APP_B, person_id: MENTEE_B, status: "interview_completed" }
        ],
        confirmations: [{ person_id: MENTOR, bio_short: null }]
      })
    );
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const readiness = await getCommunicationReadiness({ seasonId: SEASON });

    expect(readiness.everybodyMatched).toBe(false);
    expect(readiness.menteesWaiting).toBe(1);
    expect(readiness.mentorsMissingBio).toBe(1);

    const intro = readiness.kinds.find((kind) => kind.kind === "mentee_mentor_intro");
    const blockers = (intro?.blockers ?? []).join(" ");
    expect(blockers).toContain("chưa có mentor");
    expect(blockers).toContain("Mẫu thư chưa được duyệt");
    expect(blockers).toContain("Tài liệu cho mentee");
    expect(blockers).toContain("giới thiệu ngắn");
  });

  it("counts who has already been written to per letter", async () => {
    const { client } = makeClient(
      readinessTables({ sent: [{ kind: "mentee_selected", related_id: APP_A }] })
    );
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const readiness = await getCommunicationReadiness({ seasonId: SEASON });
    const selected = readiness.kinds.find((kind) => kind.kind === "mentee_selected");

    expect(selected?.recipients).toBe(1);
    expect(selected?.alreadySent).toBe(1);
    expect(selected?.pending).toBe(0);
  });

  it("refuses a role that may not see it", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: ACTOR, email: "r@example.com", role: "reviewer" });
    const { client, tables } = makeClient({});
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const readiness = await getCommunicationReadiness({ seasonId: SEASON });

    expect(readiness.ok).toBe(false);
    expect(tables).toHaveLength(0);
  });
});
