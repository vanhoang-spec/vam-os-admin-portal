/**
 * Thư mời tài khoản: lời thư, đường dẫn, chỗ giữ, và hai phép đọc sổ thư.
 *
 * Phân loại: DIRECT PRODUCTION TESTS (gọi thẳng export thật, chỉ giả database
 * và fetch).
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { buildParticipantInviteEmail } from "@/lib/email-core";
import {
  claimParticipantInviteSend,
  expireStaleParticipantInviteClaims,
  releaseOutboundEmailClaim,
  sendParticipantInvite
} from "@/lib/email";
import { countOutboundEmailsSince, readParticipantInviteSends } from "@/lib/outbound-emails";
import { createFakeDb, fakeClient, requestsFor } from "./support/fake-postgrest";

const CLAIM_ID = "00000000-0000-4000-8000-00000000c1a1";
const PERSON_ID = "00000000-0000-4000-8000-000000000001";

type Update = { table: string; payload: Record<string, unknown>; filters: Array<[string, string, unknown]> };

function recordingClient(options: { insertData?: unknown; insertError?: { code?: string; message?: string } | null } = {}) {
  const inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const updates: Update[] = [];
  const from = vi.fn((table: string) => ({
    insert: (payload: Record<string, unknown>) => {
      inserts.push({ table, payload });
      const result = { data: options.insertData ?? null, error: options.insertError ?? null };
      return {
        select: () => ({ maybeSingle: () => Promise.resolve(result) }),
        then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject)
      };
    },
    update: (payload: Record<string, unknown>) => {
      const filters: Array<[string, string, unknown]> = [];
      const chain: any = {
        eq: (column: string, value: unknown) => (filters.push(["eq", column, value]), chain),
        lt: (column: string, value: unknown) => (filters.push(["lt", column, value]), chain),
        then: (resolve: any, reject: any) => {
          updates.push({ table, payload, filters });
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        }
      };
      return chain;
    }
  }));
  return { client: { from }, inserts, updates };
}

const TOUCHED_ENV = [
  "VAM_OS_EMAIL_ENABLED",
  "VERCEL_ENV",
  "VAM_OS_EMAIL_PROVIDER",
  "BREVO_API_KEY",
  "VAM_OS_EMAIL_FROM",
  "VAM_OS_EMAIL_REPLY_TO",
  "VAM_OS_PUBLIC_BASE_URL"
] as const;
const ORIGINAL_ENV = new Map<string, string | undefined>();
let fetchMock: Mock;

beforeEach(() => {
  ORIGINAL_ENV.clear();
  for (const key of TOUCHED_ENV) ORIGINAL_ENV.set(key, process.env[key]);
  process.env.VAM_OS_EMAIL_ENABLED = "true";
  process.env.VERCEL_ENV = "production";
  process.env.VAM_OS_EMAIL_PROVIDER = "brevo";
  process.env.BREVO_API_KEY = "xkeysib-test";
  process.env.VAM_OS_EMAIL_FROM = "UEH Mentoring <hello@alumni-mentoring.edu.vn>";
  process.env.VAM_OS_PUBLIC_BASE_URL = "https://os.example.org";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const key of TOUCHED_ENV) {
    const value = ORIGINAL_ENV.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("lời thư", () => {
  const letter = (linkType: "invite" | "recovery") =>
    buildParticipantInviteEmail({
      recipientName: "Nguyễn Văn An",
      linkUrl: "https://os.example.org/reset-password#token_hash=abc&type=invite",
      linkType,
      loginUrl: "https://os.example.org/login",
      loginEmail: "An@Example.com"
    });

  it("không hứa những thứ trang /ct không có", () => {
    for (const type of ["invite", "recovery"] as const) {
      const { text, html } = letter(type);
      for (const promise of ["ghép cặp", "quy tắc ứng xử", "cẩm nang", "hỏi anh/chị muốn vào"]) {
        expect(text, `${type}: ${promise}`).not.toContain(promise);
        expect(html, `${type}: ${promise}`).not.toContain(promise);
      }
    }
  });

  it("nói rõ hai bước: đặt mật khẩu, rồi đăng nhập ở đâu bằng email nào", () => {
    const { text } = letter("invite");
    expect(text).toContain("Bước 1");
    expect(text).toContain("https://os.example.org/reset-password#token_hash=abc&type=invite");
    expect(text).toContain("Bước 2 — Đăng nhập tại https://os.example.org/login bằng email an@example.com");
  });

  it("thư khôi phục có tiêu đề riêng và nói link cũ hết dùng", () => {
    const invite = letter("invite");
    const recovery = letter("recovery");
    expect(recovery.subject).not.toBe(invite.subject);
    expect(recovery.text).toContain("không còn dùng được");
  });
});

describe("gửi thư", () => {
  const input = {
    toEmail: "an@example.com",
    recipientName: "Nguyễn Văn An",
    linkType: "invite" as const,
    tokenHash: "hash-1",
    personId: PERSON_ID,
    claimedRowId: CLAIM_ID
  };

  it("dựng link về /reset-password của chính hệ thống, và chốt lên đúng chỗ đã giữ", async () => {
    const db = recordingClient();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db.client as never);
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ messageId: "<m@brevo>" }) });

    const result = await sendParticipantInvite(input);

    expect(result).toMatchObject({ ok: true, skipped: false });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.textContent).toContain("https://os.example.org/reset-password#token_hash=hash-1&type=invite");
    expect(db.inserts).toEqual([]);
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].payload).toMatchObject({ status: "sent" });
    expect(db.updates[0].filters).toEqual([
      ["eq", "id", CLAIM_ID],
      ["eq", "status", "queued"]
    ]);
  });

  it("địa chỉ gốc không an toàn: không gọi nhà cung cấp, và chỗ giữ được chốt thành failed", async () => {
    process.env.VAM_OS_PUBLIC_BASE_URL = "http://os.example.org";
    const db = recordingClient();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db.client as never);

    const result = await sendParticipantInvite(input);

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.updates[0].payload).toMatchObject({ status: "failed" });
    expect(db.updates[0].filters).toContainEqual(["eq", "id", CLAIM_ID]);
  });

  it("cổng thư tắt: chỗ giữ chốt thành skipped, không gọi nhà cung cấp", async () => {
    delete process.env.VAM_OS_EMAIL_ENABLED;
    const db = recordingClient();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db.client as never);

    const result = await sendParticipantInvite(input);

    expect(result.skipped).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.updates[0].payload).toMatchObject({ status: "skipped" });
  });

  it("Brevo hết hạn mức: kết quả mang mã 429 để lượt gửi biết mà dừng", async () => {
    const db = recordingClient();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db.client as never);
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({ code: "too_many_requests" }) });

    const result = await sendParticipantInvite(input);

    expect(result).toMatchObject({ ok: false, providerStatus: 429 });
  });
});

describe("chỗ giữ", () => {
  it("giữ chỗ bằng một dòng queued gắn với người", async () => {
    const db = recordingClient({ insertData: { id: CLAIM_ID } });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db.client as never);

    const claim = await claimParticipantInviteSend({ personId: PERSON_ID, toEmail: "an@example.com" });

    expect(claim).toEqual({ ok: true, claimId: CLAIM_ID });
    expect(db.inserts[0]).toEqual({
      table: "outbound_emails",
      payload: {
        kind: "participant_invite",
        to_email: "an@example.com",
        subject: null,
        status: "queued",
        provider: "brevo",
        related_table: "people",
        related_id: PERSON_ID
      }
    });
  });

  it("23505 là một lượt khác đang gửi", async () => {
    const db = recordingClient({ insertError: { code: "23505", message: "trùng" } });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db.client as never);
    expect(await claimParticipantInviteSend({ personId: PERSON_ID, toEmail: "an@example.com" })).toEqual({
      ok: false,
      reason: "in_flight"
    });
  });

  it("huỷ chỗ giữ chỉ chạm dòng còn đang queued", async () => {
    const db = recordingClient();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db.client as never);

    await releaseOutboundEmailClaim(CLAIM_ID, "generateLink: error");

    expect(db.updates[0].filters).toEqual([
      ["eq", "id", CLAIM_ID],
      ["eq", "status", "queued"]
    ]);
    expect(db.updates[0].payload).toMatchObject({ status: "failed" });
  });

  it("dọn chỗ giữ quá hạn chỉ chạm thư mời, chỉ dòng queued, chỉ dòng cũ", async () => {
    const db = recordingClient();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db.client as never);
    const now = Date.parse("2026-09-11T03:00:00.000Z");

    await expireStaleParticipantInviteClaims(now);

    expect(db.updates[0].filters).toEqual([
      ["eq", "kind", "participant_invite"],
      ["eq", "status", "queued"],
      ["lt", "created_at", new Date(now - 15 * 60_000).toISOString()]
    ]);
  });
});

describe("đọc sổ thư", () => {
  it("chỉ lấy thư mời tài khoản gắn với người, gom theo người", async () => {
    const db = createFakeDb();
    db.tables.outbound_emails = [
      { id: "e1", kind: "participant_invite", related_table: "people", related_id: "p1", status: "sent", created_at: "2026-09-10T01:00:00Z", error: null },
      { id: "e2", kind: "general_announcement", related_table: "people", related_id: "p1", status: "sent", created_at: "2026-09-10T02:00:00Z", error: null },
      { id: "e3", kind: "participant_invite", related_table: "applications", related_id: "p1", status: "sent", created_at: "2026-09-10T03:00:00Z", error: null },
      { id: "e4", kind: "participant_invite", related_table: "people", related_id: "p2", status: "failed", created_at: "2026-09-10T04:00:00Z", error: "Brevo HTTP 500" }
    ];
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fakeClient(db) as never);

    const result = await readParticipantInviteSends(["p1", "p2"]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.byPersonId.get("p1")).toEqual([{ status: "sent", createdAt: "2026-09-10T01:00:00Z", error: null }]);
    expect(result.byPersonId.get("p2")?.[0]).toMatchObject({ status: "failed", error: "Brevo HTTP 500" });
  });

  it("đọc hỏng thì báo hỏng, không trả rỗng", async () => {
    const db = createFakeDb();
    db.errors.outbound_emails = { code: "57014", message: "timeout" };
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fakeClient(db) as never);
    expect(await readParticipantInviteSends(["p1"])).toEqual({ ok: false });
  });

  it("đếm thư 24 giờ KHÔNG lọc theo loại thư — hạn mức Brevo là của cả tài khoản", async () => {
    const db = createFakeDb();
    db.tables.outbound_emails = [];
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fakeClient(db) as never);

    await countOutboundEmailsSince("2026-09-10T03:00:00.000Z");

    const [request] = requestsFor(db, "outbound_emails");
    expect(request.filters).not.toContain('"column":"kind"');
    expect(request.filters).toContain('"column":"status"');
    expect(request.filters).toContain('"column":"created_at"');
  });
});
