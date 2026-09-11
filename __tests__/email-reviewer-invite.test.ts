/**
 * Thư mời reviewer qua Brevo: lời thư, đường dẫn, sổ thư, và phép kiểm "vừa gửi
 * cho người này chưa".
 *
 * Phân loại: DIRECT PRODUCTION TESTS (gọi thẳng export thật, chỉ giả database
 * và fetch).
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { buildReviewerInviteEmail } from "@/lib/email-core";
import { sendReviewerInvite } from "@/lib/email";
import { hasRecentSentEmail } from "@/lib/outbound-emails";
import { createFakeDb, fakeClient, requestsFor } from "./support/fake-postgrest";

function insertRecorder() {
  const inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const client = {
    from: (table: string) => ({
      insert: (payload: Record<string, unknown>) => {
        inserts.push({ table, payload });
        return Promise.resolve({ data: null, error: null });
      }
    })
  };
  return { client, inserts };
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
    buildReviewerInviteEmail({
      mentorName: "Trần Văn B",
      seasonLabel: "Mùa 12",
      linkUrl: "https://os.example.org/reset-password#token_hash=abc&type=invite",
      linkType,
      loginUrl: "https://os.example.org/login",
      loginEmail: "B@Example.com"
    });

  it("hai bước: đặt mật khẩu, rồi đăng nhập ở đâu bằng email nào, vào mục Đánh giá", () => {
    const { subject, text } = letter("invite");
    expect(subject).toBe("[UEH Mentoring] Tài khoản chấm hồ sơ Mùa 12");
    expect(text).toContain("Bước 1");
    expect(text).toContain("https://os.example.org/reset-password#token_hash=abc&type=invite");
    expect(text).toContain("Bước 2 — Đăng nhập tại https://os.example.org/login bằng email b@example.com và mật khẩu vừa đặt");
    expect(text).toContain("“Đánh giá”");
  });

  it("thư gửi lại nói link cũ đã hết dùng", () => {
    expect(letter("recovery").text).toContain("không còn dùng được");
    expect(letter("invite").text).not.toContain("không còn dùng được");
  });
});

describe("gửi thư", () => {
  const input = {
    toEmail: "b@example.com",
    mentorName: "Trần Văn B",
    seasonLabel: "Mùa 12",
    linkType: "invite" as const,
    tokenHash: "hash-1",
    adminUserId: "admin-user-1"
  };

  it("link về /reset-password của chính hệ thống; sổ thư ghi đúng loại và đúng người", async () => {
    const db = insertRecorder();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db.client as never);
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ messageId: "<m@brevo>" }) });

    const result = await sendReviewerInvite(input);

    expect(result).toMatchObject({ ok: true, skipped: false });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.textContent).toContain("https://os.example.org/reset-password#token_hash=hash-1&type=invite");
    expect(db.inserts[0].payload).toMatchObject({
      kind: "reviewer_invite",
      status: "sent",
      related_table: "admin_users",
      related_id: "admin-user-1"
    });
  });

  it("địa chỉ gốc không an toàn: không gọi nhà cung cấp, sổ thư ghi failed", async () => {
    process.env.VAM_OS_PUBLIC_BASE_URL = "http://os.example.org";
    const db = insertRecorder();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db.client as never);

    const result = await sendReviewerInvite(input);

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.inserts[0].payload).toMatchObject({ kind: "reviewer_invite", status: "failed" });
  });

  it("cổng thư tắt: skipped, không gọi nhà cung cấp", async () => {
    delete process.env.VAM_OS_EMAIL_ENABLED;
    const db = insertRecorder();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db.client as never);

    const result = await sendReviewerInvite(input);

    expect(result.skipped).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.inserts[0].payload).toMatchObject({ status: "skipped" });
  });
});

describe("vừa gửi cho người này chưa", () => {
  const SINCE = "2026-09-11T02:00:00.000Z";

  function seeded(rows: Array<Record<string, unknown>>) {
    const db = createFakeDb();
    db.tables.outbound_emails = rows;
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fakeClient(db) as never);
    return db;
  }

  it("một thư đã đi, đúng loại, đúng địa chỉ, trong khoảng: có", async () => {
    seeded([{ id: "e1", kind: "reviewer_invite", to_email: "b@example.com", status: "sent", created_at: "2026-09-11T02:30:00.000Z" }]);
    expect(await hasRecentSentEmail({ kind: "reviewer_invite", toEmail: " B@Example.com ", sinceIso: SINCE })).toEqual({
      ok: true,
      found: true
    });
  });

  it("thư hỏng, thư cũ, thư loại khác, hay thư cho người khác: không tính", async () => {
    const db = seeded([
      { id: "e1", kind: "reviewer_invite", to_email: "b@example.com", status: "failed", created_at: "2026-09-11T02:30:00.000Z" },
      { id: "e2", kind: "reviewer_invite", to_email: "b@example.com", status: "sent", created_at: "2026-09-11T01:00:00.000Z" },
      { id: "e3", kind: "participant_invite", to_email: "b@example.com", status: "sent", created_at: "2026-09-11T02:30:00.000Z" },
      { id: "e4", kind: "reviewer_invite", to_email: "c@example.com", status: "sent", created_at: "2026-09-11T02:30:00.000Z" }
    ]);

    expect(await hasRecentSentEmail({ kind: "reviewer_invite", toEmail: "b@example.com", sinceIso: SINCE })).toEqual({
      ok: true,
      found: false
    });
    expect(requestsFor(db, "outbound_emails")[0].filters).toContain('"column":"status","value":"sent"');
  });

  it("đọc hỏng thì báo hỏng, không trả 'không có'", async () => {
    const db = createFakeDb();
    db.errors.outbound_emails = { code: "57014", message: "timeout" };
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fakeClient(db) as never);
    expect(await hasRecentSentEmail({ kind: "reviewer_invite", toEmail: "b@example.com", sinceIso: SINCE })).toEqual({
      ok: false
    });
  });
});
