/**
 * The two endpoints a program calls rather than a person: the collector's
 * upload and the twice-monthly reminder.
 *
 * Both are reachable without a session, so the tests that matter are the
 * refusals — no secret configured, wrong secret, wrong day — and the proof that
 * a refused request never reaches the database.
 *
 * Classification: DIRECT PRODUCTION TESTS (call actual production exports).
 */
import { vi, describe, it, expect, beforeEach, afterEach, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/recap-import", () => ({ receiveImportBatch: vi.fn() }));
vi.mock("@/lib/apply-abuse", () => ({
  guardPublicSubmission: vi.fn(),
  recordAcceptedSubmission: vi.fn()
}));
vi.mock("@/lib/email", () => ({ sendRecapPeriodReminder: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { receiveImportBatch } from "@/lib/recap-import";
import { guardPublicSubmission, recordAcceptedSubmission } from "@/lib/apply-abuse";
import { sendRecapPeriodReminder } from "@/lib/email";
import { readBearerToken, secretsMatch } from "@/lib/machine-auth";
import { POST as importPost, GET as importGet } from "@/app/api/recap-import/route";
import { GET as reminderGet } from "@/app/api/cron/recap-reminder/route";

const IMPORT_TOKEN = "collector-token-9f2c";
const CRON_SECRET = "cron-secret-4a71";

const PAYLOAD = {
  group_id: "123456789",
  items: [{ permalink: "https://www.facebook.com/groups/123456789/posts/1", content: "nội dung" }]
};

function importRequest(options: { token?: string | null; body?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  return new Request("https://vam.example.vn/api/recap-import", {
    method: "POST",
    headers,
    body: JSON.stringify(options.body ?? PAYLOAD)
  });
}

function cronRequest(secret?: string | null) {
  const headers: Record<string, string> = {};
  if (secret) headers.authorization = `Bearer ${secret}`;
  return new Request("https://vam.example.vn/api/cron/recap-reminder", { headers });
}

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.resetAllMocks();
  process.env.VAM_OS_RECAP_IMPORT_TOKEN = IMPORT_TOKEN;
  process.env.CRON_SECRET = CRON_SECRET;
  (guardPublicSubmission as Mock).mockResolvedValue({ allowed: true, ipHash: "hash" });
});

afterEach(() => {
  vi.useRealTimers();
  process.env = { ...originalEnv };
});

// ── The shared secret ─────────────────────────────────────────────────────────

describe("machine-auth", () => {
  it("reads a bearer token, and nothing else", () => {
    expect(readBearerToken(new Request("https://x.vn", { headers: { authorization: "Bearer abc" } }))).toBe("abc");
    expect(readBearerToken(new Request("https://x.vn", { headers: { authorization: "bearer  abc " } }))).toBe("abc");
    expect(readBearerToken(new Request("https://x.vn", { headers: { authorization: "Basic abc" } }))).toBeNull();
    expect(readBearerToken(new Request("https://x.vn"))).toBeNull();
  });

  it("compares secrets without leaking their length", () => {
    expect(secretsMatch("abc", "abc")).toBe(true);
    expect(secretsMatch("abc", "abcd")).toBe(false);
    expect(secretsMatch("", "abc")).toBe(false);
    expect(secretsMatch("abc", "")).toBe(false);
  });
});

// ── POST /api/recap-import ────────────────────────────────────────────────────

describe("POST /api/recap-import", () => {
  it("stages a batch when the token is right", async () => {
    (receiveImportBatch as Mock).mockResolvedValue({
      ok: true,
      batchId: "batch-1",
      received: 1,
      duplicates: 0,
      matched: 1,
      needsReview: 0,
      skipped: [],
      message: "Đã nhận 1 bài mới."
    });

    const response = await importPost(importRequest({ token: IMPORT_TOKEN }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.batch_id).toBe("batch-1");
    expect(recordAcceptedSubmission).toHaveBeenCalledWith("recap_import", "hash");
  });

  it("refuses a wrong token without doing any work", async () => {
    const response = await importPost(importRequest({ token: "wrong" }));

    expect(response.status).toBe(401);
    expect(receiveImportBatch).not.toHaveBeenCalled();
    expect(guardPublicSubmission).not.toHaveBeenCalled();
  });

  it("refuses a missing token", async () => {
    const response = await importPost(importRequest({ token: null }));
    expect(response.status).toBe(401);
    expect(receiveImportBatch).not.toHaveBeenCalled();
  });

  it("closes itself when no token is configured, rather than opening", async () => {
    delete process.env.VAM_OS_RECAP_IMPORT_TOKEN;

    const response = await importPost(importRequest({ token: IMPORT_TOKEN }));

    expect(response.status).toBe(503);
    expect(receiveImportBatch).not.toHaveBeenCalled();
  });

  it("refuses a body that is not JSON", async () => {
    const request = new Request("https://vam.example.vn/api/recap-import", {
      method: "POST",
      headers: { authorization: `Bearer ${IMPORT_TOKEN}` },
      body: "khong-phai-json"
    });

    const response = await importPost(request);

    expect(response.status).toBe(400);
    expect(receiveImportBatch).not.toHaveBeenCalled();
  });

  it("refuses an oversized payload before parsing it", async () => {
    const request = new Request("https://vam.example.vn/api/recap-import", {
      method: "POST",
      headers: {
        authorization: `Bearer ${IMPORT_TOKEN}`,
        "content-length": String(5 * 1024 * 1024)
      },
      body: JSON.stringify(PAYLOAD)
    });

    const response = await importPost(request);

    expect(response.status).toBe(413);
    expect(receiveImportBatch).not.toHaveBeenCalled();
  });

  it("stops a looping collector at the rate limit", async () => {
    (guardPublicSubmission as Mock).mockResolvedValue({
      allowed: false,
      message: "Bạn đã gửi quá nhiều lần.",
      ipHash: "hash"
    });

    const response = await importPost(importRequest({ token: IMPORT_TOKEN }));

    expect(response.status).toBe(429);
    expect(receiveImportBatch).not.toHaveBeenCalled();
  });

  it("passes a refusal from the staging layer straight back", async () => {
    (receiveImportBatch as Mock).mockResolvedValue({
      ok: false,
      message: "Tất cả 3 bài trong lượt này đã được thu thập trước đó."
    });

    const response = await importPost(importRequest({ token: IMPORT_TOKEN }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.message).toContain("đã được thu thập");
    expect(recordAcceptedSubmission).not.toHaveBeenCalled();
  });

  it("answers a GET with a refusal, not an HTML error page", async () => {
    const response = await importGet();
    expect(response.status).toBe(405);
    expect((await response.json()).ok).toBe(false);
  });
});

// ── GET /api/cron/recap-reminder ──────────────────────────────────────────────

describe("GET /api/cron/recap-reminder", () => {
  /** 09:00 in Vietnam on the given calendar day. */
  function atVietnamMorning(day: string) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${day}T09:00:00+07:00`));
  }

  function withAdmins(rows: Array<Record<string, unknown>>) {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const method of ["select", "eq", "in"]) chain[method] = self;
    const resolved = Promise.resolve({ data: rows, error: null });
    chain.then = (f: unknown, r: unknown) => resolved.then(f as never, r as never);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue({ from: vi.fn(() => chain) });
  }

  it("sends to every organiser on the 15th", async () => {
    atVietnamMorning("2026-03-15");
    withAdmins([
      { email: "a@vam.vn", full_name: "Anh A" },
      { email: "b@vam.vn", full_name: "Chị B" }
    ]);
    (sendRecapPeriodReminder as Mock).mockResolvedValue({ ok: true, skipped: false });

    const response = await reminderGet(cronRequest(CRON_SECRET));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.due).toBe(true);
    expect(body.sent).toBe(2);
    expect(sendRecapPeriodReminder).toHaveBeenCalledTimes(2);
    expect((sendRecapPeriodReminder as Mock).mock.calls[0][0]).toMatchObject({
      periodLabel: "Kỳ 1 tháng 03/2026",
      periodStart: "2026-03-01",
      periodEnd: "2026-03-15"
    });
  });

  it("sends on the last day of the month, whatever day that is", async () => {
    atVietnamMorning("2026-04-30");
    withAdmins([{ email: "a@vam.vn", full_name: "Anh A" }]);
    (sendRecapPeriodReminder as Mock).mockResolvedValue({ ok: true, skipped: false });

    const body = await (await reminderGet(cronRequest(CRON_SECRET))).json();

    expect(body.due).toBe(true);
    expect((sendRecapPeriodReminder as Mock).mock.calls[0][0]).toMatchObject({
      periodStart: "2026-04-16",
      periodEnd: "2026-04-30"
    });
  });

  it("does nothing on every other day", async () => {
    atVietnamMorning("2026-03-20");

    const body = await (await reminderGet(cronRequest(CRON_SECRET))).json();

    expect(body.due).toBe(false);
    expect(body.sent).toBe(0);
    expect(sendRecapPeriodReminder).not.toHaveBeenCalled();
    expect(getSupabaseServiceRoleClient).not.toHaveBeenCalled();
  });

  it("decides the date in Vietnam, not wherever the server thinks it is", async () => {
    // 23:00 UTC on the 14th is already the 15th in Ho Chi Minh City.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T23:00:00Z"));
    withAdmins([{ email: "a@vam.vn", full_name: "Anh A" }]);
    (sendRecapPeriodReminder as Mock).mockResolvedValue({ ok: true, skipped: false });

    const body = await (await reminderGet(cronRequest(CRON_SECRET))).json();

    expect(body.today).toBe("2026-03-15");
    expect(body.due).toBe(true);
  });

  it("refuses a wrong secret before reading anything", async () => {
    atVietnamMorning("2026-03-15");

    const response = await reminderGet(cronRequest("wrong"));

    expect(response.status).toBe(401);
    expect(getSupabaseServiceRoleClient).not.toHaveBeenCalled();
    expect(sendRecapPeriodReminder).not.toHaveBeenCalled();
  });

  it("closes itself when no secret is configured", async () => {
    delete process.env.CRON_SECRET;
    atVietnamMorning("2026-03-15");

    const response = await reminderGet(cronRequest(CRON_SECRET));

    expect(response.status).toBe(503);
    expect(sendRecapPeriodReminder).not.toHaveBeenCalled();
  });

  it("counts a deliberately skipped send as skipped, not as a failure", async () => {
    atVietnamMorning("2026-03-15");
    withAdmins([{ email: "a@vam.vn", full_name: "Anh A" }]);
    // What lib/email.ts returns on a preview deploy, or with email disabled.
    (sendRecapPeriodReminder as Mock).mockResolvedValue({ ok: false, skipped: true });

    const body = await (await reminderGet(cronRequest(CRON_SECRET))).json();

    expect(body.sent).toBe(0);
    expect(body.failed).toBe(0);
  });
});
